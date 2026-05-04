'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Users,
  Bell,
  BellOff,
  LogOut,
  UserPlus,
  Crown,
  Circle,
  Pencil,
  Check,
  Trash2,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useToast } from '@/components/ToastProvider';
import { useChatStore } from '@/store/useChatStore';
import {
  updateRoom,
  removeMember,
  leaveRoom,
  updateRoomAvatar,
  updateMemberRole,
} from '@/lib/chat';
import type { ChatRoomMember } from '@/lib/chat';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { MediaGalleryGrid } from './MediaGalleryGrid';
import { StarredMessagesPanel } from './StarredMessagesPanel';
import { MemberActionSheet } from './MemberActionSheet';
import { LinksPanel } from './LinksPanel';
import { FilesPanel } from './FilesPanel';

interface RoomInfoDrawerProps {
  roomId: string;
  roomMembers: ChatRoomMember[];
  onMembersChange: (members: ChatRoomMember[]) => void;
  onGoToMessage: (messageId: string) => void;
}

export function RoomInfoDrawer({
  roomId,
  roomMembers,
  onMembersChange,
  onGoToMessage,
}: RoomInfoDrawerProps) {
  const router = useRouter();
  const { member } = useAuth();
  const toast = useToast();
  const { isRoomInfoOpen, setRoomInfoOpen, rooms, updateRoom: updateRoomInStore, onlineUsers } =
    useChatStore();
  const room = rooms.find((r) => r.id === roomId);

  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  const [notificationsOverride, setNotificationsOverride] = useState<boolean | null>(null);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);

  const [activeTab, setActiveTab] = useState<'members' | 'media' | 'links' | 'starred' | 'files'>('members');
  const [selectedMember, setSelectedMember] = useState<ChatRoomMember | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const myMembership = useMemo(
    () => roomMembers.find((m) => m.member_id === member?.id),
    [roomMembers, member?.id]
  );

  const memberId = member?.id ?? null;
  const notificationsEnabled = notificationsOverride ?? myMembership?.notifications_enabled ?? true;
  const isAdmin = myMembership?.role === 'admin';
  const isDm = room?.type === 'dm';

  // Sort members: online first, then admins, then alphabetical
  const sortedMembers = useMemo(() => {
    return [...roomMembers].sort((a, b) => {
      const aOnline = onlineUsers.includes(a.member_id);
      const bOnline = onlineUsers.includes(b.member_id);
      if (aOnline !== bOnline) return aOnline ? -1 : 1;
      if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
      const aName = a.choir_members?.first_name ?? '';
      const bName = b.choir_members?.first_name ?? '';
      return aName.localeCompare(bName, 'tr');
    });
  }, [roomMembers, onlineUsers]);

  const handleSaveName = useCallback(async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === room?.name) {
      setIsEditingName(false);
      return;
    }
    try {
      await updateRoom(roomId, { name: trimmed });
      updateRoomInStore(roomId, { name: trimmed });
      setIsEditingName(false);
    } catch (err) {
      console.error('Failed to update room name:', err);
    }
  }, [editName, roomId, room?.name, updateRoomInStore]);

  const handleSaveDesc = useCallback(async () => {
    const trimmed = editDesc.trim();
    try {
      await updateRoom(roomId, { description: trimmed || undefined });
      updateRoomInStore(roomId, { description: trimmed || undefined });
      setIsEditingDesc(false);
    } catch (err) {
      console.error('Failed to update description:', err);
    }
  }, [editDesc, roomId, updateRoomInStore]);

  const handleToggleNotifications = async () => {
    const newValue = !notificationsEnabled;
    setNotificationsOverride(newValue);
    try {
      await supabase
        .from('chat_room_members')
        .update({ notifications_enabled: newValue })
        .eq('room_id', roomId)
        .eq('member_id', memberId);
    } catch (err) {
      setNotificationsOverride(null); // revert to membership value
      console.error('Failed to toggle notifications:', err);
    }
  };

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      const memberName = roomMembers.find(
        (m) => m.member_id === memberId
      )?.choir_members?.first_name;
      if (
        !window.confirm(
          `${memberName ?? 'Bu üyeyi'} odadan çıkarmak istediğinize emin misiniz?`
        )
      )
        return;
      try {
        await removeMember(roomId, memberId);
        onMembersChange(
          roomMembers.filter((m) => m.member_id !== memberId)
        );
      } catch (err) {
        console.error('Failed to remove member:', err);
      }
    },
    [roomId, roomMembers, onMembersChange]
  );

  const handleLeave = async () => {
    if (!memberId) return;
    if (!window.confirm('Bu odadan ayrılmak istediğinize emin misiniz?'))
      return;
    try {
      await leaveRoom(roomId, memberId);
      setRoomInfoOpen(false);
      router.push('/chat');
    } catch (err) {
      console.error('Failed to leave room:', err);
    }
  };

  const handleAvatarChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const file = input.files?.[0];
      input.value = '';

      if (!file || !member?.id || !isAdmin) return;

      if (!file.type.startsWith('image/')) {
        toast.error('Lütfen geçerli bir görsel dosyası seçin.', 'Oda fotoğrafı');
        return;
      }

      setIsAvatarUploading(true);
      try {
        const publicUrl = await updateRoomAvatar(roomId, file);
        updateRoomInStore(roomId, {
          avatar_url: publicUrl,
          updated_at: new Date().toISOString(),
        });
        toast.success('Oda fotoğrafı güncellendi.');
      } catch (err) {
        console.error('Failed to update avatar', err);
        const message = err instanceof Error ? err.message : 'Fotoğraf güncellenemedi.';
        toast.error(message, 'Oda fotoğrafı');
      } finally {
        setIsAvatarUploading(false);
      }
    },
    [isAdmin, member?.id, roomId, toast, updateRoomInStore]
  );

  if (!room) return null;

  return (
    <>
    <AnimatePresence>
      {isRoomInfoOpen && (
        <motion.div
          key="room-info-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] bg-black/30 backdrop-blur-sm"
          onClick={() => setRoomInfoOpen(false)}
        />
      )}
      {isRoomInfoOpen && (

        <motion.div
          key="room-info-drawer"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 z-[151] flex h-full w-[85%] max-w-sm flex-col bg-[var(--color-background)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3 pt-[calc(env(safe-area-inset-top,0px)+12px)]">
              <h2 className="text-lg font-bold text-[var(--color-text-high)]">
                Oda Bilgisi
              </h2>
              <button
                onClick={() => setRoomInfoOpen(false)}
                className="rounded-full p-1.5 hover:bg-[var(--color-surface)]"
              >
                <X size={20} className="text-[var(--color-text-medium)]" />
              </button>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex flex-col items-center border-b border-[var(--color-border)] px-4 py-6">
                <div 
                  className={`relative mx-auto mb-4 flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-surface)] shadow-md group ${
                    isAvatarUploading ? 'cursor-wait' : ''
                  }`}
                  onClick={() => {
                    if (!isAvatarUploading && isAdmin && !isDm) {
                      fileInputRef.current?.click();
                    }
                  }}
                >
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    ref={fileInputRef} 
                    onChange={handleAvatarChange}
                  />
                  {room.avatar_url ? (
                    <img
                      src={room.avatar_url}
                      alt={room.name}
                      className={`h-full w-full rounded-full object-cover ${isAdmin && !isDm ? 'group-hover:opacity-60 transition-opacity' : ''}`}
                    />
                  ) : (
                    <Users
                      size={36}
                      className="text-[var(--color-accent)]"
                    />
                  )}
                  {isAdmin && !isDm && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                      {isAvatarUploading ? (
                        <Loader2 size={20} className="animate-spin text-white" />
                      ) : (
                        <Pencil size={20} className="text-white" />
                      )}
                    </div>
                  )}
                </div>

                {isEditingName ? (
                  <div className="flex w-full items-center gap-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface)] px-3 py-1.5 text-center text-base font-bold text-[var(--color-text-high)] focus:outline-none"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSaveName();
                        if (e.key === 'Escape') setIsEditingName(false);
                      }}
                    />
                    <button
                      onClick={() => void handleSaveName()}
                      className="rounded-full bg-[var(--color-accent)] p-1.5 text-white"
                    >
                      <Check size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-[var(--color-text-high)]">
                      {room.name}
                    </h3>
                    {isAdmin && !isDm && (
                      <button
                        onClick={() => {
                          setEditName(room.name);
                          setIsEditingName(true);
                        }}
                        className="rounded-full p-1 text-[var(--color-text-low)] hover:bg-[var(--color-surface)]"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                  </div>
                )}

                {/* Description */}
                {!isDm && (
                  <div className="mt-4 w-full">
                    {isEditingDesc ? (
                      <div className="flex flex-col gap-2">
                        <textarea
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-high)] focus:border-[var(--color-accent)] focus:outline-none"
                          rows={3}
                          placeholder="Oda açıklaması ekle..."
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setIsEditingDesc(false);
                          }}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setIsEditingDesc(false)}
                            className="rounded-lg px-3 py-1 text-sm font-medium text-[var(--color-text-low)] hover:bg-[var(--color-surface)]"
                          >
                            İptal
                          </button>
                          <button
                            onClick={() => void handleSaveDesc()}
                            className="rounded-lg bg-[var(--color-accent)] px-3 py-1 text-sm font-medium text-white"
                          >
                            Kaydet
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="group relative flex items-start gap-2">
                        <p className="flex-1 text-center text-sm text-[var(--color-text-medium)]">
                          {room.description || 'Açıklama yok'}
                        </p>
                        {isAdmin && (
                          <button
                            onClick={() => {
                              setEditDesc(room.description ?? '');
                              setIsEditingDesc(true);
                            }}
                            className="absolute -right-2 -top-2 rounded-full p-1.5 text-[var(--color-text-low)] opacity-0 transition-opacity hover:bg-[var(--color-surface)] group-hover:opacity-100"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Tabs */}
              <div className="border-b border-[var(--color-border)]">
                <div className="flex gap-1 overflow-x-auto px-3 no-scrollbar">
                  {([
                    { id: 'members', label: `Üyeler (${roomMembers.length})` },
                    { id: 'media', label: 'Medya' },
                    { id: 'links', label: 'Bağlantılar' },
                    { id: 'starred', label: 'Yıldızlılar' },
                    { id: 'files', label: 'Dosyalar' },
                  ] as const).map((section) => (
                    <button
                      key={section.id}
                      onClick={() => setActiveTab(section.id)}
                      className={`shrink-0 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                        activeTab === section.id
                          ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                          : 'border-transparent text-[var(--color-text-medium)] hover:text-[var(--color-text-high)]'
                      }`}
                    >
                      {section.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-y-auto">
                {activeTab === 'media' ? (
                  <MediaGalleryGrid roomId={roomId} onGoToMessage={onGoToMessage} />
                ) : activeTab === 'links' ? (
                  <LinksPanel roomId={roomId} onGoToMessage={onGoToMessage} />
                ) : activeTab === 'starred' ? (
                  <StarredMessagesPanel roomId={roomId} onGoToMessage={onGoToMessage} />
                ) : activeTab === 'files' ? (
                  <FilesPanel roomId={roomId} onGoToMessage={onGoToMessage} />
                ) : (
                  <div className="flex flex-col gap-1 p-2">
                    {/* Notifications Toggle */}
                    <button
                      onClick={() => void handleToggleNotifications()}
                      className="flex items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-[var(--color-surface)]"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface)]">
                        {notificationsEnabled ? (
                          <Bell size={20} className="text-[var(--color-accent)]" />
                        ) : (
                          <BellOff size={20} className="text-[var(--color-text-medium)]" />
                        )}
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-semibold text-[var(--color-text-high)]">
                          Bildirimler
                        </h4>
                        <p className="text-xs text-[var(--color-text-low)]">
                          {notificationsEnabled ? 'Açık' : 'Kapalı'}
                        </p>
                      </div>
                    </button>

                    {/* Add Member Button */}
                    {isAdmin && !isDm && (
                      <button className="flex items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-[var(--color-surface)]">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
                          <UserPlus size={20} />
                        </div>
                        <span className="text-sm font-semibold text-[var(--color-accent)]">
                          Üye Ekle
                        </span>
                      </button>
                    )}

                    <div className="my-2 h-px bg-[var(--color-border)]" />

                    {/* Members List */}
                    {sortedMembers.map((rm) => {
                      const isSelf = rm.member_id === member?.id;
                      const cm = rm.choir_members;
                      if (!cm) return null;
                      const isOnline = onlineUsers.includes(rm.member_id);

                      return (
                        <div
                          key={rm.id}
                          className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-[var(--color-surface)] cursor-pointer"
                          onClick={() => {
                            if (isAdmin && !isSelf && !isDm) {
                              setSelectedMember(rm);
                            }
                          }}
                        >
                          <div className="relative">
                            {cm.photo_url ? (
                              <img
                                src={cm.photo_url}
                                alt={cm.first_name}
                                className="h-10 w-10 rounded-full object-cover"
                              />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
                                {cm.first_name[0]}
                                {cm.last_name[0]}
                              </div>
                            )}
                            {isOnline && (
                              <div className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--color-background)]">
                                <Circle
                                  size={10}
                                  className="fill-green-500 text-green-500"
                                />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <h4 className="truncate text-sm font-semibold text-[var(--color-text-high)]">
                                {cm.first_name} {cm.last_name}
                                {isSelf && ' (Sen)'}
                              </h4>
                              {rm.role === 'admin' && (
                                <Crown
                                  size={12}
                                  className="shrink-0 text-amber-500"
                                />
                              )}
                            </div>
                            <p className="text-xs text-[var(--color-text-low)]">
                              {cm.voice_group ?? ''}
                            </p>
                          </div>

                          {/* Admin actions */}
                          {isAdmin && !isSelf && !isDm && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleRemoveMember(rm.member_id);
                              }}
                              className="shrink-0 rounded-full p-1.5 text-[var(--color-text-low)] hover:bg-red-50 hover:text-red-500"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Leave button (bottom) */}
            {!isDm && (
              <div className="border-t border-[var(--color-border)] px-4 py-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
                <button
                  onClick={() => void handleLeave()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 py-3 text-sm font-semibold text-red-500 transition-colors hover:bg-red-100"
                >
                  <LogOut size={18} />
                  Odadan Ayrıl
                </button>
              </div>
            )}
          </motion.div>
      )}
    </AnimatePresence>
      
    {selectedMember && (
      <MemberActionSheet
        isOpen={!!selectedMember}
        member={selectedMember}
        onClose={() => setSelectedMember(null)}
        onMakeAdmin={async () => {
          if (!member?.id) return;
          try {
            await updateMemberRole(roomId, selectedMember.member_id, 'admin');
            onMembersChange(roomMembers.map(m => m.id === selectedMember.id ? { ...m, role: 'admin' } : m));
          } catch (err) {
            console.error('Failed to make admin:', err);
          }
        }}
        onRemoveAdmin={async () => {
          if (!member?.id) return;
          try {
            await updateMemberRole(roomId, selectedMember.member_id, 'member');
            onMembersChange(roomMembers.map(m => m.id === selectedMember.id ? { ...m, role: 'member' } : m));
          } catch (err) {
            console.error('Failed to remove admin:', err);
          }
        }}
        onRemoveMember={() => void handleRemoveMember(selectedMember.member_id)}
      />
    )}
    </>
  );
}
