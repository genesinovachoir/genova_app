'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Music2, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useMiniAudioPlayerStore } from '@/store/useMiniAudioPlayerStore';
import { supabase } from '@/lib/supabase';
import { initSongFolder } from '@/lib/drive';
import { LottieIcon } from './LottieIcon';

interface AddSongModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddSongModal({ isOpen, onClose, onSuccess }: AddSongModalProps) {
  const isPlayerActive = useMiniAudioPlayerStore((state) => state.isActive);
  const [title, setTitle] = useState('');
  const [composer, setComposer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('hide-nav');
    } else {
      document.body.classList.remove('hide-nav');
    }
    return () => document.body.classList.remove('hide-nav');
  }, [isOpen]);

  const handleClose = () => {
    if (!loading) {
      setTitle(''); setComposer(''); setError(null); setSuccess(false);
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('Şarkı adı zorunlu'); return; }
    setLoading(true); setError(null);

    let createdSongId: string | null = null;

    try {
      // 1. DB'ye şarkı ekle
      const { data: song, error: insertErr } = await supabase
        .from('repertoire')
        .insert({ title: title.trim(), composer: composer.trim() || null, is_visible: true })
        .select('id, title')
        .single();

      if (insertErr) throw new Error(insertErr.message);
      createdSongId = song.id;

      // 2. Drive'da klasör oluştur
      await initSongFolder(song.id, song.title);

      setSuccess(true);
      setTimeout(() => { onSuccess(); handleClose(); }, 1200);
    } catch (err) {
      if (createdSongId) {
        const { error: rollbackErr } = await supabase.from('repertoire').delete().eq('id', createdSongId);
        if (rollbackErr) {
          console.error('Repertoire rollback failed:', rollbackErr);
        }
      }
      setError(err instanceof Error ? err.message : 'Bir hata oluştu');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
            style={{ 
              bottom: isPlayerActive ? 'calc(7.2rem + env(safe-area-inset-bottom))' : '0',
              borderRadius: isPlayerActive ? '0 0 24px 24px' : '0',
              transition: 'bottom 0.4s cubic-bezier(0.23, 1, 0.32, 1), border-radius 0.4s'
            }}
          />
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ 
              opacity: 1, 
              y: 0,
              bottom: isPlayerActive ? 'calc(7.2rem + env(safe-area-inset-bottom))' : '0'
            }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ 
              type: 'spring', 
              bounce: 0.12, 
              duration: 0.45,
              bottom: { duration: 0.4, ease: [0.23, 1, 0.32, 1] }
            }}
            className="fixed inset-x-0 top-0 z-[60] flex flex-col bg-[var(--color-surface-solid)] overflow-hidden"
            style={{ 
              borderRadius: isPlayerActive ? '0 0 24px 24px' : '0',
              borderBottom: isPlayerActive ? '1px solid var(--color-border)' : 'none'
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-[max(env(safe-area-inset-top),1.25rem)] pb-4 border-b border-[var(--color-border)] shrink-0">
              <div className="flex items-center gap-2">
                <LottieIcon 
                  path="/lottie/player music.json" 
                  fallback={Music2} 
                  size={24} 
                  autoPlay 
                  loop 
                  interactive={false}
                  className="text-[var(--color-accent)]"
                />
                <h2 className="font-serif text-[1.1rem] tracking-[-0.02em] font-medium">Yeni Şarkı Ekle</h2>
              </div>
              <button
                onClick={handleClose} disabled={loading}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-medium)] hover:text-[var(--color-text-high)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto">
              {success ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center gap-3 py-20"
                >
                  <CheckCircle2 size={40} className="text-emerald-400" />
                  <p className="font-medium text-emerald-400">Şarkı eklendi ve Drive klasörü oluşturuldu!</p>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit} className="px-5 py-5 space-y-5" id="add-song-form">
                  <div>
                    <label className="block text-[0.65rem] uppercase tracking-[0.22em] text-[var(--color-text-medium)] mb-2">
                      Şarkı Adı *
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="ör. O Fortuna"
                      className="editorial-input"
                      disabled={loading}
                    />
                  </div>

                  <div>
                    <label className="block text-[0.65rem] uppercase tracking-[0.22em] text-[var(--color-text-medium)] mb-2">
                      Besteci
                    </label>
                    <input
                      type="text"
                      value={composer}
                      onChange={e => setComposer(e.target.value)}
                      placeholder="ör. Carl Orff"
                      className="editorial-input"
                      disabled={loading}
                    />
                  </div>

                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center gap-2 rounded-[4px] border border-red-500/30 bg-red-500/10 px-4 py-3"
                      >
                        <AlertCircle size={14} className="shrink-0 text-red-400" />
                        <p className="text-xs text-red-400">{error}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </form>
              )}
            </div>

            {/* Sticky Footer */}
            <div className="shrink-0 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-[var(--color-border)]">
              <button
                type="submit"
                form="add-song-form"
                disabled={loading || !title.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-panel)] bg-[var(--color-accent)] py-4 font-sans text-[0.8rem] font-bold uppercase tracking-[0.18em] text-[var(--color-background)] transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? <><Loader2 size={16} className="animate-spin" /> Oluşturuluyor...</> : 'Şarkı Ekle'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
