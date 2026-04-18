'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  ClipboardList,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Users,
  CheckSquare,
  Square,
  Search,
} from 'lucide-react';

import { supabase, ChoirMember } from '@/lib/supabase';
import { initAssignmentFolder } from '@/lib/drive';
import { RichTextEditor } from './RichTextEditor';

interface CreateAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  creatorMemberId: string;
  isChef: boolean;
  creatorVoiceGroup: string | null;
}

type AssignmentMode = 'all' | 'group' | 'person' | 'own_group';
type MemberWithSelection = ChoirMember & { selected: boolean };
type RoleName = 'Şef' | 'Partisyon Şefi' | 'Korist' | string;

interface ChoirMemberRoleRow {
  member_id: string;
  roles?: { name?: RoleName } | Array<{ name?: RoleName }> | null;
}

const VOICE_ORDER = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const BLOCKED_ASSIGNMENT_ROLES = new Set<RoleName>(['Şef', 'Partisyon Şefi']);

function hasBlockedAssignmentRole(row: ChoirMemberRoleRow): boolean {
  if (!row.roles) {
    return false;
  }
  const roleEntries = Array.isArray(row.roles) ? row.roles : [row.roles];
  return roleEntries.some((entry) => Boolean(entry?.name && BLOCKED_ASSIGNMENT_ROLES.has(entry.name)));
}

function getVoiceGroupSortKey(voiceGroup: string | null | undefined) {
  const normalized = voiceGroup?.trim() ?? '';
  const index = VOICE_ORDER.indexOf(normalized);
  if (index >= 0) {
    return `${index}`;
  }
  return `z-${normalized.toLowerCase()}`;
}

export function CreateAssignmentModal({
  isOpen,
  onClose,
  onSuccess,
  creatorMemberId,
  isChef,
  creatorVoiceGroup,
}: CreateAssignmentModalProps) {
  const [form, setForm] = useState({ title: '', description: '', deadline: '' });
  const [members, setMembers] = useState<MemberWithSelection[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>(isChef ? 'all' : 'own_group');
  const [selectedVoiceGroup, setSelectedVoiceGroup] = useState('');

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('hide-nav');
    } else {
      document.body.classList.remove('hide-nav');
    }
    return () => document.body.classList.remove('hide-nav');
  }, [isOpen]);

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    setError(null);

    let query = supabase
      .from('choir_members')
      .select('id, first_name, last_name, voice_group, sub_voice_group, auth_user_id, email, phone, is_active')
      .eq('is_active', true)
      .order('voice_group')
      .order('first_name');

    if (!isChef && creatorVoiceGroup) {
      query = query.eq('voice_group', creatorVoiceGroup);
    }

    const { data, error: membersError } = await query;
    if (membersError) {
      setError(membersError.message);
      setLoadingMembers(false);
      return;
    }

    const fetchedMembers = data ?? [];
    const fetchedMemberIds = fetchedMembers.map((member) => member.id);
    let blockedMemberIds = new Set<string>();

    if (fetchedMemberIds.length > 0) {
      const { data: memberRoleRows, error: memberRolesError } = await supabase
        .from('choir_member_roles')
        .select('member_id, roles(name)')
        .in('member_id', fetchedMemberIds);

      if (memberRolesError) {
        setError(memberRolesError.message);
        setLoadingMembers(false);
        return;
      }

      blockedMemberIds = new Set(
        ((memberRoleRows ?? []) as ChoirMemberRoleRow[])
          .filter((row) => hasBlockedAssignmentRole(row))
          .map((row) => row.member_id),
      );
    }

    const nextMembers = fetchedMembers
      .filter((member) => !blockedMemberIds.has(member.id))
      .map((member) => ({ ...member, selected: false }));
    setMembers(nextMembers);

    if (isChef) {
      const groups = [...new Set(nextMembers.map((member) => member.voice_group).filter(Boolean) as string[])].sort((a, b) => {
        const keyA = getVoiceGroupSortKey(a);
        const keyB = getVoiceGroupSortKey(b);
        return keyA.localeCompare(keyB, 'tr');
      });
      setSelectedVoiceGroup(groups[0] ?? '');
    }

    setLoadingMembers(false);
  }, [creatorVoiceGroup, isChef]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setForm({ title: '', description: '', deadline: '' });
    setError(null);
    setSuccess(false);
    setMemberSearch('');
    setAssignmentMode(isChef ? 'all' : 'own_group');
    void loadMembers();
  }, [isChef, isOpen, loadMembers]);

  const handleClose = () => {
    if (!loading) {
      onClose();
    }
  };

  const allVoiceGroups = useMemo(() => {
    const groups = [...new Set(members.map((member) => member.voice_group).filter(Boolean) as string[])];
    return groups.sort((a, b) => getVoiceGroupSortKey(a).localeCompare(getVoiceGroupSortKey(b), 'tr'));
  }, [members]);

  const shouldShowMemberSelector = assignmentMode === 'person';

  const filteredMembers = useMemo(
    () =>
      members.filter((member) => {
        if (!memberSearch) {
          return true;
        }
        const query = memberSearch.toLowerCase();
        return (
          `${member.first_name} ${member.last_name}`.toLowerCase().includes(query) ||
          member.voice_group?.toLowerCase().includes(query) ||
          member.sub_voice_group?.toLowerCase().includes(query)
        );
      }),
    [memberSearch, members],
  );

  const groupedMembers = useMemo(() => {
    const groups: Record<string, MemberWithSelection[]> = {};
    for (const voice of VOICE_ORDER) {
      const voiceMembers = filteredMembers.filter((member) => member.voice_group === voice);
      if (voiceMembers.length > 0) {
        groups[voice] = voiceMembers;
      }
    }
    const otherMembers = filteredMembers.filter((member) => !member.voice_group || !VOICE_ORDER.includes(member.voice_group));
    if (otherMembers.length > 0) {
      groups['Diğer'] = otherMembers;
    }
    return groups;
  }, [filteredMembers]);

  const selectedCount = members.filter((member) => member.selected).length;

  const estimatedTargetCount = useMemo(() => {
    if (assignmentMode === 'all') {
      return members.length;
    }
    if (assignmentMode === 'group') {
      return members.filter((member) => member.voice_group === selectedVoiceGroup).length;
    }
    if (assignmentMode === 'own_group') {
      return members.length;
    }
    return selectedCount;
  }, [assignmentMode, members, selectedCount, selectedVoiceGroup]);

  const toggleMember = (id: string) => {
    setMembers((previous) => previous.map((member) => (member.id === id ? { ...member, selected: !member.selected } : member)));
  };

  const toggleAllVisible = () => {
    const allVisibleSelected = filteredMembers.length > 0 && filteredMembers.every((member) => member.selected);
    const visibleIds = new Set(filteredMembers.map((member) => member.id));
    setMembers((previous) =>
      previous.map((member) => (visibleIds.has(member.id) ? { ...member, selected: !allVisibleSelected } : member)),
    );
  };

  const getTargetMemberIds = () => {
    if (isChef) {
      if (assignmentMode === 'all') {
        return members.map((member) => member.id);
      }
      if (assignmentMode === 'group') {
        return members.filter((member) => member.voice_group === selectedVoiceGroup).map((member) => member.id);
      }
      return members.filter((member) => member.selected).map((member) => member.id);
    }

    if (!creatorVoiceGroup) {
      throw new Error('Partisyon şefi için ses grubu bilgisi eksik.');
    }

    if (assignmentMode === 'own_group') {
      return members.map((member) => member.id);
    }

    return members.filter((member) => member.selected).map((member) => member.id);
  };

  const getTargetVoiceGroup = () => {
    if (isChef && assignmentMode === 'group') {
      return selectedVoiceGroup || null;
    }
    if (!isChef && assignmentMode === 'own_group') {
      return creatorVoiceGroup;
    }
    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!form.title.trim()) {
      setError('Ödev başlığı zorunlu.');
      return;
    }

    if (isChef && assignmentMode === 'group' && !selectedVoiceGroup) {
      setError('Lütfen bir ses grubu seçin.');
      return;
    }

    setLoading(true);
    setError(null);

    let createdAssignmentId: string | null = null;

    try {
      const targetMemberIds = getTargetMemberIds();
      if (targetMemberIds.length === 0) {
        throw new Error('En az bir hedef korist seçmelisiniz.');
      }

      const { data: targetRoleRows, error: targetRolesError } = await supabase
        .from('choir_member_roles')
        .select('member_id, roles(name)')
        .in('member_id', targetMemberIds);
      if (targetRolesError) {
        throw new Error(targetRolesError.message);
      }

      const blockedTargets = ((targetRoleRows ?? []) as ChoirMemberRoleRow[]).filter((row) => hasBlockedAssignmentRole(row));
      if (blockedTargets.length > 0) {
        throw new Error('Ödev yalnızca koristlere atanabilir. Şef/partisyon şefi hedeflenemez.');
      }

      const { data: assignment, error: insertAssignmentError } = await supabase
        .from('assignments')
        .insert({
          title: form.title.trim(),
          description: form.description.trim() || null,
          deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
          target_voice_group: getTargetVoiceGroup(),
          created_by: creatorMemberId,
          is_active: true,
        })
        .select('id, title')
        .single();

      if (insertAssignmentError || !assignment) {
        throw new Error(insertAssignmentError?.message || 'Ödev oluşturulamadı.');
      }
      createdAssignmentId = assignment.id;

      const { error: targetInsertError } = await supabase.from('assignment_targets').insert(
        targetMemberIds.map((memberId) => ({
          assignment_id: assignment.id,
          member_id: memberId,
        })),
      );
      if (targetInsertError) {
        throw new Error(targetInsertError.message);
      }

      await initAssignmentFolder(assignment.id, assignment.title);

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 900);
    } catch (submitError) {
      if (createdAssignmentId) {
        await supabase.from('assignments').delete().eq('id', createdAssignmentId);
      }
      setError(submitError instanceof Error ? submitError.message : 'Bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  const voiceGroupLabel = creatorVoiceGroup ?? 'Partisyon';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
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
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 pb-4 pt-[max(env(safe-area-inset-top),1.25rem)] shrink-0">
              <div className="flex items-center gap-2">
                <ClipboardList size={16} className="text-[var(--color-accent)]" />
                <h2 className="font-serif text-[1.1rem] font-medium tracking-[-0.02em]">Ödev Oluştur</h2>
              </div>
              <button
                onClick={handleClose}
                disabled={loading}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-medium)] transition-colors hover:text-[var(--color-text-high)]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {success ? (
                <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-3 py-20">
                  <CheckCircle2 size={40} className="text-emerald-400" />
                  <p className="font-medium text-emerald-400">Ödev oluşturuldu.</p>
                  <p className="text-sm text-[var(--color-text-medium)]">Drive klasörü hazırlandı.</p>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5" id="assignment-form">
                  <div>
                    <label className="mb-2 block text-[0.65rem] uppercase tracking-[0.22em] text-[var(--color-text-medium)]">Başlık *</label>
                    <input
                      type="text"
                      value={form.title}
                      onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                      className="editorial-input"
                      disabled={loading}
                    />
                  </div>

                  <div>
                    <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-text-medium)]">Açıklama</p>
                    <div className="reset-tiptap-styles">
                      <RichTextEditor content={form.description} onChange={(value) => setForm((prev) => ({ ...prev, description: value }))} />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-[0.65rem] uppercase tracking-[0.22em] text-[var(--color-text-medium)]">
                      <Calendar size={10} className="mr-1 inline" />
                      Son Tarih
                    </label>
                    <input
                      type="datetime-local"
                      value={form.deadline}
                      onChange={(event) => setForm((prev) => ({ ...prev, deadline: event.target.value }))}
                      className="editorial-input"
                      disabled={loading}
                    />
                  </div>

                  <div className="rounded-[6px] border border-[var(--color-border)] bg-white/5 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Users size={13} className="text-[var(--color-accent)]" />
                      <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-[var(--color-text-medium)]">Atama Modu</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {isChef ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setAssignmentMode('all')}
                            className={`rounded border px-3 py-2 text-[0.66rem] font-bold uppercase tracking-[0.14em] transition-colors ${
                              assignmentMode === 'all'
                                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                                : 'border-[var(--color-border)] text-[var(--color-text-medium)] hover:bg-white/5'
                            }`}
                          >
                            Tüm Koro
                          </button>
                          <button
                            type="button"
                            onClick={() => setAssignmentMode('group')}
                            className={`rounded border px-3 py-2 text-[0.66rem] font-bold uppercase tracking-[0.14em] transition-colors ${
                              assignmentMode === 'group'
                                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                                : 'border-[var(--color-border)] text-[var(--color-text-medium)] hover:bg-white/5'
                            }`}
                          >
                            Ses Grubu
                          </button>
                          <button
                            type="button"
                            onClick={() => setAssignmentMode('person')}
                            className={`col-span-2 rounded border px-3 py-2 text-[0.66rem] font-bold uppercase tracking-[0.14em] transition-colors ${
                              assignmentMode === 'person'
                                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                                : 'border-[var(--color-border)] text-[var(--color-text-medium)] hover:bg-white/5'
                            }`}
                          >
                            Kişi Seç
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setAssignmentMode('own_group')}
                            className={`rounded border px-3 py-2 text-[0.66rem] font-bold uppercase tracking-[0.14em] transition-colors ${
                              assignmentMode === 'own_group'
                                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                                : 'border-[var(--color-border)] text-[var(--color-text-medium)] hover:bg-white/5'
                            }`}
                          >
                            {voiceGroupLabel}
                          </button>
                          <button
                            type="button"
                            onClick={() => setAssignmentMode('person')}
                            className={`rounded border px-3 py-2 text-[0.66rem] font-bold uppercase tracking-[0.14em] transition-colors ${
                              assignmentMode === 'person'
                                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                                : 'border-[var(--color-border)] text-[var(--color-text-medium)] hover:bg-white/5'
                            }`}
                          >
                            Kişi Seç
                          </button>
                        </>
                      )}
                    </div>

                    {assignmentMode === 'group' ? (
                      <div className="mt-3">
                        <label className="mb-1 block text-[0.6rem] uppercase tracking-[0.15em] text-[var(--color-text-medium)]">Ses Grubu</label>
                        <select
                          value={selectedVoiceGroup}
                          onChange={(event) => setSelectedVoiceGroup(event.target.value)}
                          className="editorial-input"
                          disabled={loading || allVoiceGroups.length === 0}
                        >
                          {allVoiceGroups.length === 0 ? <option value="">Ses grubu bulunamadı</option> : null}
                          {allVoiceGroups.map((voiceGroup) => (
                            <option key={voiceGroup} value={voiceGroup}>
                              {voiceGroup}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    <p className="mt-3 text-xs text-[var(--color-text-medium)]">Hedef: {estimatedTargetCount} korist</p>
                  </div>

                  {shouldShowMemberSelector ? (
                    <div>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-[0.62rem] uppercase tracking-[0.18em] text-[var(--color-text-medium)]">Kişi Seçimi</div>
                        <button
                          type="button"
                          onClick={toggleAllVisible}
                          className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-[var(--color-accent)]"
                        >
                          {filteredMembers.length > 0 && filteredMembers.every((member) => member.selected) ? 'Kaldır' : 'Tümünü Seç'}
                        </button>
                      </div>

                      <div className="relative mb-3">
                        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-medium)]" />
                        <input
                          type="text"
                          value={memberSearch}
                          onChange={(event) => setMemberSearch(event.target.value)}
                          placeholder="İsim veya ses grubu ara..."
                          className="editorial-input !pl-9"
                          disabled={loading}
                        />
                      </div>

                      {loadingMembers ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="animate-spin text-[var(--color-accent)]" size={20} />
                        </div>
                      ) : (
                        <div className="max-h-[40vh] overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                          {Object.entries(groupedMembers).map(([voice, voiceMembers]) => (
                            <div key={voice}>
                              <div className="sticky top-0 bg-[var(--color-surface-solid)]/95 px-4 py-2 backdrop-blur-sm">
                                <span className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[var(--color-accent)]">{voice}</span>
                              </div>
                              {voiceMembers.map((member) => (
                                <button
                                  key={member.id}
                                  type="button"
                                  onClick={() => toggleMember(member.id)}
                                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
                                >
                                  {member.selected ? (
                                    <CheckSquare size={15} className="shrink-0 text-[var(--color-accent)]" />
                                  ) : (
                                    <Square size={15} className="shrink-0 text-[var(--color-text-medium)]" />
                                  )}
                                  <span className="flex-1 text-sm">
                                    {member.first_name} {member.last_name}
                                  </span>
                                  <span className="text-[0.6rem] text-[var(--color-text-medium)]">{member.sub_voice_group ?? member.voice_group}</span>
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}

                      <p className="mt-2 text-xs text-[var(--color-text-medium)]">Seçili kişi sayısı: {selectedCount}</p>
                    </div>
                  ) : null}

                  <AnimatePresence>
                    {error ? (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center gap-2 rounded-[4px] border border-red-500/30 bg-red-500/10 px-4 py-3"
                      >
                        <AlertCircle size={14} className="text-red-400" />
                        <p className="text-xs text-red-400">{error}</p>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </form>
              )}
            </div>

            <div className="shrink-0 border-t border-[var(--color-border)] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
              <button
                type="submit"
                form="assignment-form"
                disabled={loading || !form.title.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-panel)] bg-[var(--color-accent)] py-4 text-[0.8rem] font-bold uppercase tracking-[0.18em] text-[var(--color-background)] transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Oluşturuluyor...
                  </>
                ) : (
                  'Ödevi Oluştur'
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
