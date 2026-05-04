'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, Check, Users, MessageCircle } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useChatStore } from '@/store/useChatStore';
import { supabase } from '@/lib/supabase';
import { createRoom } from '@/lib/chat';
import type { ChoirMember } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export function CreateRoomModal() {
  const router = useRouter();
  const { member } = useAuth();
  const { isCreateRoomOpen, setCreateRoomOpen } = useChatStore();
  const [step, setStep] = useState<'type' | 'members' | 'details'>('type');
  const [roomType, setRoomType] = useState<'custom' | 'dm'>('custom');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [members, setMembers] = useState<ChoirMember[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isCreateRoomOpen) return;
    setStep('type'); setName(''); setDesc(''); setSearch(''); setSelected([]);
    void supabase.from('choir_members').select('id, first_name, last_name, photo_url, voice_group')
      .eq('is_active', true).order('first_name')
      .then(({ data }) => setMembers((data ?? []).filter(m => m.id !== member?.id) as ChoirMember[]));
  }, [isCreateRoomOpen, member?.id]);

  const filtered = members.filter(m => {
    const q = search.toLowerCase();
    return `${m.first_name} ${m.last_name}`.toLowerCase().includes(q);
  });

  const toggle = (id: string) => {
    if (roomType === 'dm') { setSelected([id]); return; }
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleCreate = async () => {
    if (!member?.id || selected.length === 0) return;
    setLoading(true);
    try {
      const roomName = roomType === 'dm'
        ? members.find(m => m.id === selected[0])?.first_name ?? 'DM'
        : name.trim() || 'Yeni Oda';
      const roomId = await createRoom(roomName, member.id, selected, {
        type: roomType, description: desc.trim() || undefined,
      });
      setCreateRoomOpen(false);
      router.push(`/chat/${roomId}`);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  if (!isCreateRoomOpen) return null;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 backdrop-blur-sm"
        onClick={() => setCreateRoomOpen(false)}>
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
          className="w-full max-w-lg rounded-t-3xl bg-[var(--color-background)] pb-[env(safe-area-inset-bottom,16px)]"
          style={{ maxHeight: '85dvh' }}>

          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-lg font-bold text-[var(--color-text-high)]">
              {step === 'type' ? 'Yeni Sohbet' : step === 'members' ? 'Kişi Seç' : 'Oda Bilgileri'}
            </h2>
            <button onClick={() => setCreateRoomOpen(false)} className="rounded-full p-1.5 hover:bg-[var(--color-surface)]">
              <X size={20} className="text-[var(--color-text-medium)]" />
            </button>
          </div>

          <div className="overflow-y-auto px-4 py-4" style={{ maxHeight: 'calc(85dvh - 60px)' }}>
            {/* Step 1: Type */}
            {step === 'type' && (
              <div className="flex flex-col gap-3">
                {[
                  { type: 'dm' as const, icon: MessageCircle, title: 'Direkt Mesaj', desc: '1-1 sohbet başlat' },
                  { type: 'custom' as const, icon: Users, title: 'Grup Oluştur', desc: 'Birden fazla kişiyle sohbet' },
                ].map(opt => (
                  <button key={opt.type} onClick={() => { setRoomType(opt.type); setStep('members'); }}
                    className="flex items-center gap-4 rounded-2xl border border-[var(--color-border)] p-4 text-left transition-colors hover:bg-[var(--color-surface)]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-accent-soft)]">
                      <opt.icon size={24} className="text-[var(--color-accent)]" />
                    </div>
                    <div>
                      <p className="font-semibold text-[var(--color-text-high)]">{opt.title}</p>
                      <p className="text-sm text-[var(--color-text-low)]">{opt.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Step 2: Members */}
            {step === 'members' && (
              <>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-low)]" size={16} />
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Kişi ara..." className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 pl-9 pr-4 text-sm text-[var(--color-text-high)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]" />
                </div>
                {selected.length > 0 && (
                  <p className="mb-2 text-xs text-[var(--color-text-low)]">{selected.length} kişi seçildi</p>
                )}
                <div className="flex flex-col gap-1">
                  {filtered.map(m => {
                    const isSel = selected.includes(m.id);
                    return (
                      <button key={m.id} onClick={() => toggle(m.id)}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${isSel ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-surface)]'}`}>
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-surface)]">
                          {m.photo_url ? <img src={m.photo_url} className="h-full w-full rounded-full object-cover" /> :
                            <span className="text-sm font-bold text-[var(--color-accent)]">{m.first_name[0]}</span>}
                        </div>
                        <div className="flex-1 text-left">
                          <p className="text-sm font-medium text-[var(--color-text-high)]">{m.first_name} {m.last_name}</p>
                          {m.voice_group && <p className="text-xs text-[var(--color-text-low)]">{m.voice_group}</p>}
                        </div>
                        {isSel && <Check size={18} className="text-[var(--color-accent)]" />}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex gap-2">
                  <button onClick={() => setStep('type')} className="flex-1 rounded-xl border border-[var(--color-border)] py-2.5 text-sm font-medium text-[var(--color-text-medium)]">Geri</button>
                  <button onClick={() => roomType === 'dm' ? handleCreate() : setStep('details')} disabled={selected.length === 0}
                    className="flex-1 rounded-xl bg-[var(--color-accent)] py-2.5 text-sm font-bold text-white disabled:opacity-40">{roomType === 'dm' ? 'Başlat' : 'İleri'}</button>
                </div>
              </>
            )}

            {/* Step 3: Details (group only) */}
            {step === 'details' && (
              <>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Oda adı"
                  className="mb-3 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-high)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]" />
                <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Açıklama (opsiyonel)" rows={2}
                  className="mb-4 w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-high)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]" />
                <p className="mb-4 text-xs text-[var(--color-text-low)]">{selected.length} kişi eklenecek</p>
                <div className="flex gap-2">
                  <button onClick={() => setStep('members')} className="flex-1 rounded-xl border border-[var(--color-border)] py-2.5 text-sm font-medium text-[var(--color-text-medium)]">Geri</button>
                  <button onClick={handleCreate} disabled={loading || !name.trim()}
                    className="flex-1 rounded-xl bg-[var(--color-accent)] py-2.5 text-sm font-bold text-white disabled:opacity-40">{loading ? 'Oluşturuluyor...' : 'Oluştur'}</button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
