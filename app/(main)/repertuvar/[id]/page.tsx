'use client';

import { useMemo } from 'react';
import { motion } from 'motion/react';
import { use } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { LottieIcon } from '@/components/LottieIcon';
import { useBackOrHome } from '@/hooks/useBackOrHome';
import { createSlugLookup, isUuidLike } from '@/lib/internalPageLinks';
import {
  getRepertoireCatalogCacheScope,
  getRepertoireRoleScope,
  readRepertoireCatalogCache,
} from '@/lib/repertuvar/cache';
import {
  getRepertoireCatalogQueryKey,
  loadRepertoireCatalog,
} from '@/lib/repertuvar/queries';

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
  const handleBack = useBackOrHome();
  const { isAdmin, isSectionLeader, member, isLoading: authLoading } = useAuth();
  const isChef = isAdmin();
  const isLeader = isSectionLeader();
  const isChoristUser = !isLeader;
  const roleScope = getRepertoireRoleScope(isChef, isLeader);
  const catalogCacheScope = useMemo(
    () => getRepertoireCatalogCacheScope(member?.id ?? null, roleScope),
    [member?.id, roleScope],
  );
  const catalogQueryKey = useMemo(
    () => getRepertoireCatalogQueryKey(member?.id ?? null, roleScope),
    [member?.id, roleScope],
  );

  const catalogQuery = useQuery({
    queryKey: catalogQueryKey,
    queryFn: () => loadRepertoireCatalog({ memberId: member?.id ?? null, roleScope }),
    enabled: !authLoading,
    initialData: () => readRepertoireCatalogCache(catalogCacheScope) ?? undefined,
    staleTime: 30_000,
    gcTime: 24 * 60 * 60_000,
  });

  const slugLookup = useMemo(() => {
    if (!catalogQuery.data) {
      return null;
    }

    return createSlugLookup(
      catalogQuery.data.songs.map((song) => ({
        id: song.id,
        title: song.title,
        created_at: song.created_at,
      })),
      'sarki',
    );
  }, [catalogQuery.data]);

  const resolvedSongId = useMemo(() => {
    if (isUuidLike(identifier)) {
      return identifier;
    }

    return slugLookup?.itemBySlug.get(identifier.toLowerCase())?.id ?? null;
  }, [identifier, slugLookup]);

  const song = useMemo(() => {
    if (!catalogQuery.data || !resolvedSongId) {
      return null;
    }

    return catalogQuery.data.songs.find((item) => item.id === resolvedSongId) ?? null;
  }, [catalogQuery.data, resolvedSongId]);

  const assignedSongIds = useMemo(
    () => new Set(catalogQuery.data?.assignedSongIds ?? []),
    [catalogQuery.data?.assignedSongIds],
  );
  const loading = !catalogQuery.data && (authLoading || catalogQuery.isLoading);
  const isRefreshing = Boolean(catalogQuery.data && catalogQuery.isFetching);
  const queryError = catalogQuery.error instanceof Error ? catalogQuery.error.message : null;
  const error = queryError
    ?? (!loading && !resolvedSongId ? 'Şarkı bulunamadı.' : null)
    ?? (!loading && isChoristUser && resolvedSongId && !assignedSongIds.has(resolvedSongId) ? 'Bu şarkı size atanmadı.' : null)
    ?? (!loading && resolvedSongId && !song ? 'Şarkı bulunamadı.' : null);

  return (
    <main className="min-h-screen bg-[var(--color-background)] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-background)]/90 px-5 pb-4 pt-[max(env(safe-area-inset-top),1.25rem)] backdrop-blur-sm">
        <button
          onClick={handleBack}
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
          {isRefreshing && !loading && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/5 px-3 py-1.5 text-[0.6rem] font-bold uppercase tracking-[0.16em] text-[var(--color-text-medium)]">
              <Loader2 size={12} className="animate-spin text-[var(--color-accent)]" />
              Güncelleniyor
            </div>
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
            key={song.id}
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
