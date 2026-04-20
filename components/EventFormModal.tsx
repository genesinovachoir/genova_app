'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Search, CheckSquare, Square, Users, Trash2 } from 'lucide-react';
import { useMiniAudioPlayerStore } from '@/store/useMiniAudioPlayerStore';
import { supabase, Rehearsal, ChoirMember } from '@/lib/supabase';
import { useAuth } from './AuthProvider';
import { RichTextEditor } from './RichTextEditor';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  rehearsal?: Rehearsal | null;
  defaultDate?: string;
}

type Invitee = ChoirMember & { selected: boolean };

const VOICE_ORDER = ['Soprano', 'Alto', 'Tenor', 'Bass'];

export function EventFormModal({ open, onClose, onSaved, rehearsal, defaultDate }: Props) {
  const { member } = useAuth();

  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [collectAttendance, setCollectAttendance] = useState(true);
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isEdit = !!rehearsal;

  // ── Load members ──
  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    const { data } = await supabase
      .from('choir_members')
      .select('id, first_name, last_name, voice_group, sub_voice_group, auth_user_id, email, phone, is_active')
      .eq('is_active', true)
      .order('voice_group')
      .order('first_name');

    if (data) {
      let existingInvitees: string[] = [];
      if (rehearsal?.id) {
        const { data: inv } = await supabase
          .from('rehearsal_invitees')
          .select('member_id')
          .eq('rehearsal_id', rehearsal.id);
        existingInvitees = (inv || []).map((i: any) => i.member_id);
      }
      setInvitees(data.map(m => ({
        ...m,
        selected: rehearsal ? existingInvitees.includes(m.id) : true,
      })));
    }
    setLoadingMembers(false);
  }, [rehearsal]);

  useEffect(() => {
    if (open) {
      document.body.classList.add('hide-nav');
    } else {
      document.body.classList.remove('hide-nav');
    }
    return () => document.body.classList.remove('hide-nav');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    loadMembers();
    if (rehearsal) {
      setDate(rehearsal.date);
      setStartTime(rehearsal.start_time.slice(0, 5));
      setEndTime(rehearsal.end_time?.slice(0, 5) ?? '');
      setTitle(rehearsal.title);
      setLocation(rehearsal.location);
      setNotes(rehearsal.notes ?? '');
      setCollectAttendance(rehearsal.collect_attendance);
    } else {
      setDate(defaultDate ?? '');
      setStartTime('');
      setEndTime('');
      setTitle('');
      setLocation('');
      setNotes('');
      setCollectAttendance(true);
    }
    setSearch('');
    setFormError(null);
    setShowDeleteConfirm(false);
  }, [open, rehearsal, defaultDate, loadMembers]);

  const toggleInvitee = (id: string) =>
    setInvitees(prev => prev.map(m => m.id === id ? { ...m, selected: !m.selected } : m));

  const filteredInvitees = () => {
    if (!search.trim()) return invitees;
    const q = search.toLowerCase();
    return invitees.filter(m =>
      `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
      (m.phone ?? '').includes(q)
    );
  };

  const toggleAll = () => {
    const filtered = filteredInvitees();
    const allSelected = filtered.every(m => m.selected);
    const ids = new Set(filtered.map(m => m.id));
    setInvitees(prev => prev.map(m => ids.has(m.id) ? { ...m, selected: !allSelected } : m));
  };

  const grouped = () => {
    const filtered = filteredInvitees();
    const groups: Record<string, Invitee[]> = {};
    // Şef grubu: voice_group null olanlar
    const chefs = filtered.filter(m => !m.voice_group);
    if (chefs.length > 0) groups['Şef'] = chefs;
    for (const v of VOICE_ORDER) {
      const members = filtered.filter(m => m.voice_group === v);
      if (members.length > 0) groups[v] = members;
    }
    return groups;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member || !date) return;
    setFormError(null);
    setSubmitting(true);

    const payload = {
      date,
      start_time: startTime || '19:30',
      end_time: endTime || null,
      title: title || 'Prova',
      location: location || 'Büyük Salon',
      notes: notes || null,
      collect_attendance: collectAttendance,
      attendance_note: notes || null, // notes aynı zamanda swipe ekranında gösterilir
    };

    try {
      let rehearsalId = rehearsal?.id;

      if (isEdit && rehearsalId) {
        const { error } = await supabase.from('rehearsals').update(payload).eq('id', rehearsalId);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase
          .from('rehearsals')
          .insert({ ...payload, created_by: member.id })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        rehearsalId = data?.id;
      }

      if (rehearsalId) {
        const { error: clearInviteeError } = await supabase
          .from('rehearsal_invitees')
          .delete()
          .eq('rehearsal_id', rehearsalId);
        if (clearInviteeError) throw new Error(clearInviteeError.message);

        const selectedIds = invitees
          .filter(m => m.selected)
          .map(m => ({ rehearsal_id: rehearsalId, member_id: m.id }));

        if (selectedIds.length > 0) {
          const { error: insertInviteeError } = await supabase.from('rehearsal_invitees').insert(selectedIds);
          if (insertInviteeError) throw new Error(insertInviteeError.message);
        }
      }

      onSaved();
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : 'Etkinlik kaydedilemedi.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirmed = async () => {
    if (!rehearsal?.id) return;

    setFormError(null);
    setDeleting(true);

    try {
      const rehearsalId = rehearsal.id;

      const { error: attendanceDeleteError } = await supabase
        .from('attendance')
        .delete()
        .eq('rehearsal_id', rehearsalId);
      if (attendanceDeleteError) throw new Error(attendanceDeleteError.message);

      const { error: inviteeDeleteError } = await supabase
        .from('rehearsal_invitees')
        .delete()
        .eq('rehearsal_id', rehearsalId);
      if (inviteeDeleteError) throw new Error(inviteeDeleteError.message);

      const { error: rehearsalDeleteError } = await supabase
        .from('rehearsals')
        .delete()
        .eq('id', rehearsalId);
      if (rehearsalDeleteError) throw new Error(rehearsalDeleteError.message);

      onSaved();
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : 'Etkinlik silinemedi.');
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const filteredList = filteredInvitees();
  const allFilteredSelected = filteredList.length > 0 && filteredList.every(m => m.selected);
  const selectedCount = invitees.filter(m => m.selected).length;

  const isPlayerActive = useMiniAudioPlayerStore((state) => state.isActive);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm"
            onClick={onClose}
            style={{ 
              bottom: isPlayerActive ? 'calc(7.2rem + env(safe-area-inset-bottom))' : '0',
              borderRadius: isPlayerActive ? '0 0 24px 24px' : '0',
              transition: 'bottom 0.4s cubic-bezier(0.23, 1, 0.32, 1), border-radius 0.4s'
            }}
          />
          <motion.div
            initial={{ opacity: 0, y: 60 }}
            animate={{ 
              opacity: 1, 
              y: 0,
              bottom: isPlayerActive ? 'calc(7.2rem + env(safe-area-inset-bottom))' : '0'
            }}
            exit={{ opacity: 0, y: 60 }}
            transition={{ 
              type: 'spring', 
              bounce: 0.15, 
              duration: 0.5,
              bottom: { duration: 0.4, ease: [0.23, 1, 0.32, 1] }
            }}
            className="fixed inset-x-0 top-0 z-[60] max-h-[100dvh] flex flex-col bg-[var(--color-surface-solid)] overflow-hidden"
            style={{ 
              borderRadius: isPlayerActive ? '0 0 24px 24px' : '0',
              borderBottom: isPlayerActive ? '1px solid var(--color-border)' : 'none'
            }}
          >
            {/* Sticky Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] shrink-0">
              <span className="page-kicker">{isEdit ? 'Etkinliği Düzenle' : 'Etkinlik Oluştur'}</span>
              <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-medium)] hover:text-[var(--color-text-high)]">
                <X size={16} />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              <form onSubmit={handleSubmit} className="px-5 py-5 space-y-5" id="event-form">

                {/* Başlık */}
                <div>
                  <label className="mb-2 block text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">Başlık</label>
                  <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="editorial-input"
                  />
                </div>

                {/* Tarih + Saatler */}
                <div className="grid grid-cols-[1fr_1.3fr_1.3fr] gap-3">
                  <div className="col-span-3 sm:col-span-1">
                    <label className="mb-2 block text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">Tarih</label>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} required className="editorial-input" />
                  </div>
                  <div>
                    <label className="mb-2 block text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">Başlangıç</label>
                    <input
                      type="time"
                      value={startTime}
                      onChange={e => setStartTime(e.target.value)}
                      className="editorial-input w-full min-w-0"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">Bitiş</label>
                    <input
                      type="time"
                      value={endTime}
                      onChange={e => setEndTime(e.target.value)}
                      className="editorial-input w-full min-w-0"
                    />
                  </div>
                </div>

                {/* Yer */}
                <div>
                  <label className="mb-2 block text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">Yer</label>
                  <input type="text" value={location} onChange={e => setLocation(e.target.value)} className="editorial-input" />
                </div>

                {/* Açıklama — notes olarak kaydedilir, korist ekranında "Not" kutusunda görünür */}
                <div>
                  <label className="mb-2 block text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">Açıklama</label>
                  <div className="reset-tiptap-styles">
                    <RichTextEditor content={notes} onChange={setNotes} placeholder="" />
                  </div>
                </div>

                {/* Katılım toggle */}
                <div className="rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-white/4 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">Katılım Toplanacak mı?</p>
                    </div>
                    {/* Toggle button — fixed positioning */}
                    <button
                      type="button"
                      onClick={() => setCollectAttendance(c => !c)}
                      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${collectAttendance ? 'bg-[var(--color-accent)]' : 'bg-white/20'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ${collectAttendance ? 'translate-x-[20px]' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </div>

                {/* Davetli Listesi */}
                <div>
                  {/* Header — single line */}
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Users size={13} className="text-[var(--color-accent)] shrink-0" />
                      <span className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-[var(--color-text-medium)] whitespace-nowrap">Davetliler</span>
                      <span className="status-pill text-[0.55rem] py-0.5 px-2 whitespace-nowrap">{selectedCount} seçili</span>
                    </div>
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-[var(--color-accent)] hover:opacity-80 transition-opacity whitespace-nowrap shrink-0"
                    >
                      {allFilteredSelected ? 'Kaldır' : 'Tümünü Seç'}
                    </button>
                  </div>

                  {/* Arama */}
                  <div className="relative mb-3">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-medium)]" />
                    <input
                      type="text"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Ara..."
                      className="editorial-input themed-search-input !pl-9"
                    />
                  </div>

                  {loadingMembers ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="animate-spin text-[var(--color-accent)]" size={20} />
                    </div>
                  ) : (
                    <div className="max-h-[35vh] overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                      {Object.entries(grouped()).map(([voice, members]) => (
                        <div key={voice}>
                          <div className="sticky top-0 bg-[var(--color-surface-solid)]/95 backdrop-blur-sm px-4 py-2">
                            <span className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[var(--color-accent)]">{voice}</span>
                          </div>
                          {members.map(m => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => toggleInvitee(m.id)}
                              className="flex w-full items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors"
                            >
                              {m.selected
                                ? <CheckSquare size={15} className="shrink-0 text-[var(--color-accent)]" />
                                : <Square size={15} className="shrink-0 text-[var(--color-text-medium)]" />
                              }
                              <span className="text-sm text-left">{m.first_name} {m.last_name}</span>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </form>
            </div>

            {/* Sticky Footer */}
            <div className="shrink-0 px-5 pt-1.5 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-[var(--color-border)]">
              {formError && (
                <p className="mb-3 rounded-[var(--radius-panel)] border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {formError}
                </p>
              )}
              <div className={`grid gap-3 ${isEdit ? 'grid-cols-[1fr_1.5fr]' : ''}`}>
                {isEdit && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={submitting || deleting}
                    className="flex items-center justify-center gap-2 rounded-[var(--radius-panel)] border border-rose-400/45 bg-rose-500/10 py-3 font-sans text-[0.72rem] font-bold uppercase tracking-[0.15em] text-rose-400 [.light_&]:text-[#450a0a] transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    {deleting
                      ? <><Loader2 size={15} className="animate-spin" /> Siliniyor...</>
                      : <><Trash2 size={15} /> Sil</>
                    }
                  </button>
                )}
                <button
                  type="submit"
                  form="event-form"
                  disabled={submitting || deleting || !date}
                  className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-panel)] bg-[var(--color-accent)] py-3 font-sans text-[0.8rem] font-bold uppercase tracking-[0.18em] text-[var(--color-background)] transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {submitting
                    ? <><Loader2 size={16} className="animate-spin" /> Kaydediliyor...</>
                    : isEdit ? 'Değişiklikleri Kaydet' : 'Etkinliği Oluştur'
                  }
                </button>
              </div>
            </div>
          </motion.div>

          <AnimatePresence>
            {showDeleteConfirm && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[61] bg-black/70"
                  onClick={() => !deleting && setShowDeleteConfirm(false)}
                />
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 16 }}
                  className="fixed inset-x-5 bottom-6 z-[62] mx-auto max-w-md rounded-[12px] border border-rose-500/35 bg-[var(--color-surface-solid)] p-4"
                >
                  <p className="text-sm text-[var(--color-text-high)]">
                    Bu etkinliği ve bağlı katılım kayıtlarını silmek istiyor musunuz?
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={deleting}
                      className="rounded-[8px] border border-[var(--color-border)] bg-white/5 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-medium)] disabled:opacity-50"
                    >
                      Vazgeç
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteConfirmed()}
                      disabled={deleting}
                      className="inline-flex items-center justify-center gap-2 rounded-[8px] border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-rose-400 [.light_&]:text-[#450a0a] disabled:opacity-50"
                    >
                      {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      Sil
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
}
