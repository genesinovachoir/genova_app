'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, ClipboardList, Loader2, AlertCircle, CheckCircle2,
  Calendar, Users, CheckSquare, Square, Search,
} from 'lucide-react';
import { supabase, ChoirMember } from '@/lib/supabase';
import { initAssignmentFolder } from '@/lib/drive';
import { RichTextEditor } from './RichTextEditor';

interface CreateAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  creatorMemberId: string;
}

const VOICE_ORDER = ['Soprano', 'Alto', 'Tenor', 'Bass'];

type MemberWithSelection = ChoirMember & { selected: boolean };

export function CreateAssignmentModal({ isOpen, onClose, onSuccess, creatorMemberId }: CreateAssignmentModalProps) {
  const [form, setForm] = useState({ title: '', description: '', deadline: '' });
  const [members, setMembers] = useState<MemberWithSelection[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // hide-nav
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('hide-nav');
    } else {
      document.body.classList.remove('hide-nav');
    }
    return () => document.body.classList.remove('hide-nav');
  }, [isOpen]);

  // Load choir members
  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    const { data } = await supabase
      .from('choir_members')
      .select('id, first_name, last_name, voice_group, sub_voice_group, auth_user_id, email, phone, is_active')
      .eq('is_active', true)
      .order('voice_group')
      .order('first_name');
    if (data) {
      setMembers(data.map(m => ({ ...m, selected: true })));
    }
    setLoadingMembers(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadMembers();
      setForm({ title: '', description: '', deadline: '' });
      setError(null);
      setSuccess(false);
      setMemberSearch('');
    }
  }, [isOpen, loadMembers]);

  const handleClose = () => {
    if (!loading) onClose();
  };

  const filteredMembers = members.filter(m =>
    !memberSearch ||
    `${m.first_name} ${m.last_name}`.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.voice_group?.toLowerCase().includes(memberSearch.toLowerCase())
  );

  const grouped = () => {
    const groups: Record<string, MemberWithSelection[]> = {};
    for (const v of VOICE_ORDER) {
      const ms = filteredMembers.filter(m => m.voice_group === v);
      if (ms.length > 0) groups[v] = ms;
    }
    const other = filteredMembers.filter(m => !m.voice_group || !VOICE_ORDER.includes(m.voice_group));
    if (other.length > 0) groups['Diğer'] = other;
    return groups;
  };

  const toggleMember = (id: string) => {
    setMembers(prev => prev.map(m => m.id === id ? { ...m, selected: !m.selected } : m));
  };

  const toggleAll = () => {
    const allSelected = filteredMembers.length > 0 && filteredMembers.every(m => m.selected);
    const ids = new Set(filteredMembers.map(m => m.id));
    setMembers(prev => prev.map(m => ids.has(m.id) ? { ...m, selected: !allSelected } : m));
  };

  const selectedCount = members.filter(m => m.selected).length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setError('Ödev başlığı zorunlu'); return; }
    setLoading(true); setError(null);

    let createdAssignmentId: string | null = null;

    try {
      const { data: assignment, error: insertErr } = await supabase
        .from('assignments')
        .insert({
          title: form.title.trim(),
          description: form.description.trim() || null,
          deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
          target_voice_group: null,
          created_by: creatorMemberId,
          is_active: true,
        })
        .select('id, title')
        .single();

      if (insertErr) throw new Error(insertErr.message);
      createdAssignmentId = assignment.id;

      // Seçili kişileri assignment_targets'a kaydet
      const selectedIds = members.filter(m => m.selected).map(m => m.id);
      if (selectedIds.length > 0) {
        await supabase.from('assignment_targets').insert(
          selectedIds.map(member_id => ({ assignment_id: assignment.id, member_id }))
        );
      }

      // Drive klasörü oluştur
      await initAssignmentFolder(assignment.id, assignment.title);

      setSuccess(true);
      setTimeout(() => { onSuccess(); handleClose(); }, 1200);
    } catch (err) {
      if (createdAssignmentId) {
        await supabase.from('assignments').delete().eq('id', createdAssignmentId);
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
          />
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: 'spring', bounce: 0.12, duration: 0.45 }}
            className="fixed inset-0 z-[60] flex flex-col bg-[var(--color-surface-solid)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-[max(env(safe-area-inset-top),1.25rem)] pb-4 border-b border-[var(--color-border)] shrink-0">
              <div className="flex items-center gap-2">
                <ClipboardList size={16} className="text-[var(--color-accent)]" />
                <h2 className="font-serif text-[1.1rem] tracking-[-0.02em] font-medium">Ödev Oluştur</h2>
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
                  <p className="font-medium text-emerald-400">Ödev oluşturuldu!</p>
                  <p className="text-sm text-[var(--color-text-medium)]">Drive klasörü hazırlandı.</p>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit} className="px-5 py-5 space-y-5" id="assignment-form">

                  {/* Başlık */}
                  <div>
                    <label className="block text-[0.65rem] uppercase tracking-[0.22em] text-[var(--color-text-medium)] mb-2">
                      Başlık *
                    </label>
                    <input
                      type="text" value={form.title}
                      onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                      className="editorial-input" disabled={loading}
                    />
                  </div>

                  {/* Açıklama — RichTextEditor */}
                  <div>
                    <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">
                      Açıklama
                    </p>
                    <div className="reset-tiptap-styles">
                      <RichTextEditor
                        content={form.description}
                        onChange={val => setForm(f => ({ ...f, description: val }))}
                      />
                    </div>
                  </div>

                  {/* Son Tarih */}
                  <div>
                    <label className="block text-[0.65rem] uppercase tracking-[0.22em] text-[var(--color-text-medium)] mb-2">
                      <Calendar size={10} className="inline mr-1" />Son Tarih
                    </label>
                    <input
                      type="datetime-local"
                      value={form.deadline}
                      onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))}
                      className="editorial-input"
                      disabled={loading}
                    />
                  </div>

                  {/* Kişi Ataması */}
                  <div>
                    <div className="flex items-center justify-between mb-3 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Users size={13} className="text-[var(--color-accent)] shrink-0" />
                        <span className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-[var(--color-text-medium)] whitespace-nowrap">
                          Kişi Ataması
                        </span>
                        <span className="status-pill text-[0.55rem] py-0.5 px-2 whitespace-nowrap">
                          {selectedCount} seçili
                        </span>
                      </div>
                      <button
                        type="button" onClick={toggleAll}
                        className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-[var(--color-accent)] hover:opacity-80 transition-opacity whitespace-nowrap shrink-0"
                      >
                        {filteredMembers.length > 0 && filteredMembers.every(m => m.selected) ? 'Kaldır' : 'Tümünü Seç'}
                      </button>
                    </div>

                    {/* Arama */}
                    <div className="relative mb-3">
                      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-medium)]" />
                      <input
                        type="text" value={memberSearch}
                        onChange={e => setMemberSearch(e.target.value)}
                        placeholder="İsim veya ses grubu ara..."
                        className="editorial-input !pl-9"
                      />
                    </div>

                    {loadingMembers ? (
                      <div className="flex justify-center py-6">
                        <Loader2 className="animate-spin text-[var(--color-accent)]" size={20} />
                      </div>
                    ) : (
                      <div className="max-h-[40vh] overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                        {Object.entries(grouped()).map(([voice, ms]) => (
                          <div key={voice}>
                            <div className="sticky top-0 bg-[var(--color-surface-solid)]/95 backdrop-blur-sm px-4 py-2">
                              <span className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[var(--color-accent)]">
                                {voice}
                              </span>
                            </div>
                            {ms.map(m => (
                              <button
                                key={m.id} type="button" onClick={() => toggleMember(m.id)}
                                className="flex w-full items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
                              >
                                {m.selected
                                  ? <CheckSquare size={15} className="shrink-0 text-[var(--color-accent)]" />
                                  : <Square size={15} className="shrink-0 text-[var(--color-text-medium)]" />
                                }
                                <span className="text-sm text-left flex-1">{m.first_name} {m.last_name}</span>
                                <span className="text-[0.6rem] text-[var(--color-text-medium)]">
                                  {m.sub_voice_group ?? m.voice_group}
                                </span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center gap-2 rounded-[4px] border border-red-500/30 bg-red-500/10 px-4 py-3"
                      >
                        <AlertCircle size={14} className="text-red-400" />
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
                form="assignment-form"
                disabled={loading || !form.title.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-panel)] bg-[var(--color-accent)] py-4 font-sans text-[0.8rem] font-bold uppercase tracking-[0.18em] text-[var(--color-background)] transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {loading
                  ? <><Loader2 size={16} className="animate-spin" /> Oluşturuluyor...</>
                  : 'Ödevi Oluştur'
                }
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
