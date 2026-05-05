'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, ChoirMember, UserRole } from '@/lib/supabase';
import { clearAssignmentCaches } from '@/lib/assignment-cache';
import { clearChatCaches } from '@/lib/chat-cache';
import { clearRepertoireMetadataCaches } from '@/lib/repertuvar/cache';
import { clearRuntimeDriveFileCache } from '@/lib/repertuvar/offline';
import { REPERTOIRE_QUERY_ROOT_KEY } from '@/lib/repertuvar/queries';

type MemberWithRelations = ChoirMember & {
  schools?: { name: string } | null;
  departments?: { name: string } | null;
  repertoire?: { title: string; composer: string | null } | null;
};

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  member: ChoirMember | null;
  roles: UserRole[];
  isLoading: boolean;
  isAdmin: () => boolean;
  isSectionLeader: () => boolean;
  isChorist: () => boolean;
  getVoiceGroup: () => string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeRoleName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ş/gi, 's')
    .replace(/ı/gi, 'i')
    .toLocaleLowerCase('tr-TR')
    .trim();
}

function toCanonicalRole(value: string): UserRole | null {
  const normalized = normalizeRoleName(value);
  if (normalized === 'sef') return 'Şef';
  if (normalized === 'partisyon sefi') return 'Partisyon Şefi';
  if (normalized === 'korist') return 'Korist';
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<ChoirMember | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMemberData = useCallback(async (userId: string) => {
    const { data: memberData } = await supabase
      .from('choir_members')
      .select(`
        id, first_name, last_name, voice_group, sub_voice_group, auth_user_id,
        email, phone, is_active, photo_url, birth_date, join_date,
        school_id, department_id, favorite_song_id,
        linkedin_url, instagram_url, youtube_url, spotify_url, tiktok_url, x_url,
        schools(name),
        departments(name),
        repertoire:favorite_song_id(title, composer)
      `)
      .eq('auth_user_id', userId)
      .maybeSingle() as { data: MemberWithRelations | null };

    if (memberData) {
      // Flatten ilişkili veriler
      (memberData as any).school_name = (memberData as any).schools?.name ?? null;
      (memberData as any).department_name = (memberData as any).departments?.name ?? null;
      (memberData as any).favorite_song_title = (memberData as any).repertoire?.title ?? null;
      setMember(memberData);

      const { data: rolesData } = await supabase
        .from('choir_member_roles')
        .select('roles(name)')
        .eq('member_id', memberData.id);

      const canonicalRoles = new Set<UserRole>();
      for (const row of rolesData || []) {
        const roleValue = (row as any)?.roles;
        const roleNames = Array.isArray(roleValue)
          ? roleValue.map((entry: any) => entry?.name).filter(Boolean)
          : roleValue?.name
            ? [roleValue.name]
            : [];

        for (const roleName of roleNames) {
          const canonical = toCanonicalRole(String(roleName));
          if (canonical) {
            canonicalRoles.add(canonical);
          }
        }
      }

      setRoles(Array.from(canonicalRoles));
      return;
    }

    setMember(null);
    setRoles([]);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchMemberData(session.user.id).finally(() => setIsLoading(false));
      } else {
        setIsLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchMemberData(session.user.id);
      } else {
        clearAssignmentCaches();
        clearChatCaches();
        clearRepertoireMetadataCaches();
        queryClient.removeQueries({ queryKey: REPERTOIRE_QUERY_ROOT_KEY });
        void clearRuntimeDriveFileCache().catch(() => {});
        setMember(null);
        setRoles([]);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchMemberData, queryClient]);

  const isAdmin = () => roles.includes('Şef');
  const isSectionLeader = () => roles.includes('Partisyon Şefi') || roles.includes('Şef');
  const isChorist = () => !roles.includes('Şef') && !roles.includes('Partisyon Şefi');
  const getVoiceGroup = () => member?.voice_group ?? null;

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signOut = async () => {
    clearAssignmentCaches();
    clearChatCaches();
    clearRepertoireMetadataCaches();
    queryClient.removeQueries({ queryKey: REPERTOIRE_QUERY_ROOT_KEY });
    void clearRuntimeDriveFileCache().catch(() => {
      // Best-effort cleanup; sign-out should not be blocked by Cache API failures.
    });
    await supabase.auth.signOut();
    setMember(null);
    setRoles([]);
  };

  return (
    <AuthContext.Provider value={{
      session, user, member, roles, isLoading,
      isAdmin, isSectionLeader, isChorist, getVoiceGroup,
      signIn, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
