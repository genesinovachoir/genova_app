'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { use } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { supabase, RepertoireSong, RepertoireSongRow, normalizeRepertoireSong } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';

const RepertoireWorkspace = dynamic(
  () => import('@/components/repertuvar/RepertoireWorkspace').then((mod) => mod.RepertoireWorkspace),
  {
    ssr: false,
    loading: () => (
      <div className="glass-panel flex items-center justify-center p-8">
        <Loader2 className="animate-spin text-[var(--color-accent)]" size={24} />
      </div>
    ),
  },
);

export default function SongDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { isAdmin, isSectionLeader, member } = useAuth();
  const isChef = isAdmin();
  const isLeader = isSectionLeader();

  const [song, setSong] = useState<RepertoireSong | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSong = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from('repertoire')
        .select(`
          id, title, composer, drive_folder_id, is_visible, created_at,
          repertoire_files ( id, file_name, file_type, partition_label, drive_file_id, drive_web_view_link, drive_download_link, mime_type, file_size_bytes, created_at, updated_at, song_id, uploaded_by )
        `)
        .eq('id', id)
        .single();

      if (fetchErr) throw new Error(fetchErr.message);
      setSong(normalizeRepertoireSong(data as RepertoireSongRow));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Şarkı yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchSong(); }, [fetchSong]);

  return (
    <main className="page-shell !pt-6 space-y-2">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.22em] text-[var(--color-text-medium)] hover:text-[var(--color-text-high)] transition-colors"
      >
        <ArrowLeft size={14} /> Repertuvar
      </button>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-[var(--color-accent)]" size={28} />
        </div>
      ) : error ? (
        <div className="glass-panel flex items-center gap-3 p-6">
          <AlertCircle size={20} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      ) : !song ? null : (
        <>
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="px-1">
            <div className="flex flex-wrap items-end justify-between gap-6 border-b border-white/5 pb-4">
              <div className="max-w-2xl">
                <span className="page-kicker mb-3">Nota Sehpası</span>
                <h1 className="font-serif italic text-[2.4rem] sm:text-[3.4rem] leading-[1.05] tracking-tight text-white/95">
                  {song.title}
                </h1>
                {song.composer && (
                  <div className="mt-2">
                    <p className="text-[0.68rem] uppercase tracking-[0.25em] font-bold italic text-white opacity-60">
                      {song.composer}
                    </p>
                  </div>
                )}
              </div>
              {!song.is_visible && (
                <span className="rounded-[4px] border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-[0.62rem] font-bold uppercase tracking-[0.2em] text-orange-400">
                  Gizlenmiş
                </span>
              )}
            </div>

            {isChef && !song.drive_folder_id && (
              <div className="mt-4 flex items-center gap-2 rounded-[4px] border border-orange-500/30 bg-orange-500/10 px-4 py-3">
                <AlertCircle size={14} className="text-orange-400" />
                <p className="text-xs text-orange-400">
                  Bu şarkının Drive klasörü yok. Dosya yüklemek için önce şarkıyı silip Sarki Ekle ile tekrar oluşturun.
                </p>
              </div>
            )}
          </motion.div>

          <RepertoireWorkspace
            song={song}
            memberId={member?.id ?? null}
            voiceGroup={member?.voice_group ?? null}
            isChef={isChef}
            isSectionLeader={isLeader}
          />
        </>
      )}
    </main>
  );
}
