'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { use } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { supabase, RepertoireSong, RepertoireSongRow, normalizeRepertoireSong } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';
import { LottieIcon } from '@/components/LottieIcon';
import { createSlugLookup, isUuidLike } from '@/lib/internalPageLinks';

const RepertoireWorkspace = dynamic(
  () => import('@/components/repertuvar/RepertoireWorkspace').then((mod) => mod.RepertoireWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="glass-panel flex items-center justify-center p-8">
        <LottieIcon
          path="/lottie/Insider-loading.json"
          fallback={Loader2}
          size={72}
          loop
          autoPlay
          interactive={false}
        />
      </div>
    ),
  },
);

export default function SongDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const identifier = decodeURIComponent(id);
  const router = useRouter();
  const { isAdmin, isSectionLeader, member, isLoading: authLoading } = useAuth();
  const isChef = isAdmin();
  const isLeader = isSectionLeader();
  const isChoristUser = !isLeader;

  const [song, setSong] = useState<RepertoireSong | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSong = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let resolvedSongId: string | null = null;
      if (isUuidLike(identifier)) {
        resolvedSongId = identifier;
      } else {
        const { data: slugRows, error: slugError } = await supabase
          .from('repertoire')
          .select('id, title, created_at');

        if (slugError) {
          throw new Error(slugError.message);
        }

        const slugLookup = createSlugLookup((slugRows ?? []) as Array<{ id: string; title: string | null; created_at: string | null }>, 'sarki');
        resolvedSongId = slugLookup.itemBySlug.get(identifier.toLowerCase())?.id ?? null;
      }

      if (!resolvedSongId) {
        setSong(null);
        setError('Şarkı bulunamadı.');
        return;
      }

      if (isChoristUser && member?.id) {
        const { data: assignmentData, error: assignmentError } = await supabase
          .from('song_assignments')
          .select('song_id')
          .eq('song_id', resolvedSongId)
          .eq('member_id', member.id)
          .limit(1)
          .maybeSingle();

        if (assignmentError) {
          throw new Error(assignmentError.message);
        }

        if (!assignmentData) {
          setSong(null);
          setError('Bu şarkı size atanmadı.');
          return;
        }
      }

      const { data, error: fetchErr } = await supabase
        .from('repertoire')
        .select(`
          id, title, composer, drive_folder_id, is_visible, created_at,
          repertoire_files ( id, file_name, file_type, partition_label, drive_file_id, drive_web_view_link, drive_download_link, mime_type, file_size_bytes, created_at, updated_at, song_id, uploaded_by )
        `)
        .eq('id', resolvedSongId)
        .single();

      if (fetchErr) throw new Error(fetchErr.message);
      setSong(normalizeRepertoireSong(data as RepertoireSongRow));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Şarkı yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [identifier, isChoristUser, member?.id]);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    fetchSong();
  }, [authLoading, fetchSong]);

  return (
    <main className="min-h-screen bg-[var(--color-background)] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-background)]/90 px-5 pb-4 pt-[max(env(safe-area-inset-top),1.25rem)] backdrop-blur-sm">
        <button
          onClick={() => router.back()}
          className="mb-5 inline-flex items-center gap-2 text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)] active:scale-95"
        >
          <ArrowLeft size={18} />
          <span className="text-xs font-medium uppercase tracking-[0.1em]">Geri</span>
        </button>
        <div>
          <span className="page-kicker">Repertuvar</span>
          <div className="flex items-start justify-between gap-4">
            <h1 className="mt-2 font-serif text-3xl leading-tight tracking-[-0.05em]">
              {song?.title || 'Yükleniyor...'}
            </h1>
            {song && !song.is_visible && (
              <span className="mt-3 rounded-full border border-orange-500/30 bg-orange-500/10 px-2.5 py-0.5 text-[0.5rem] font-bold uppercase tracking-[0.2em] text-orange-400">
                Gizli
              </span>
            )}
          </div>
          {song?.composer && (
            <p className="mt-1 text-[0.62rem] font-bold uppercase tracking-[0.2em] italic text-[var(--color-accent)] opacity-80">
              {song.composer}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-6 px-5">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <LottieIcon
              path="/lottie/Insider-loading.json"
              fallback={Loader2}
              size={84}
              loop
              autoPlay
              interactive={false}
            />
          </div>
        ) : error ? (
          <div className="glass-panel flex items-center gap-3 p-6">
            <AlertCircle size={20} className="text-red-400 shrink-0" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : !song ? null : (
        <>
          {isChef && song && !song.drive_folder_id && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-[4px] border border-orange-500/30 bg-orange-500/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="text-orange-400" />
                <p className="text-xs text-orange-400">
                  Bu şarkının Drive klasörü yok. Dosya yüklemek için önce şarkıyı silip Sarki Ekle ile tekrar oluşturun.
                </p>
              </div>
            </motion.div>
          )}

          <RepertoireWorkspace
            song={song}
            memberId={member?.id ?? null}
            voiceGroup={member?.voice_group ?? null}
            isChef={isChef}
            isSectionLeader={isLeader}
          />
        </>
      )}
      </div>
    </main>
  );
}
