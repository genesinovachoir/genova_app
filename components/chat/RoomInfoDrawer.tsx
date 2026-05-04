'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Users,
  Bell,
  BellOff,
  LogOut,
  UserPlus,
  Shield,
  Crown,
  Circle,
  Pencil,
  Check,
  Trash2,
} from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useChatStore } from '@/store/useChatStore';
import {
  updateRoom,
  removeMember,
  leaveRoom,
  fetchRoomMembers,
} from '@/lib/chat';
import type { ChatRoomMember } from '@/lib/chat';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

interface RoomInfoDrawerProps {
  roomId: string;
  roomMembers: ChatRoomMember[];
  onMembersChange: (members: ChatRoomMember[]) => void;
}

export function RoomInfoDrawer({
  roomId,
  roomMembers,
  onMembersChange,
}: RoomInfoDrawerProps) {
  const router = useRouter();
  const { member } = useAuth();
  const { isRoomInfoOpen, setRoomInfoOpen, rooms, updateRoom: updateRoomInStore, onlineUsers } =
    useChatStore();
  const room = rooms.find((r) => r.id === roomId);

  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  const myMembership = useMemo(
    () => roomMembers.find((m) => m.member_id === member?.id),
    [roomMembers, member?.id]
  );

  const isAdmin = myMembership?.role === 'admin';
  const isDm = room?.type === 'dm';

  // Initialize notification state from membership
  useEffect(() => {
    if (myMembership) {
      setNotificationsEnabled(myMembership.notifications_enabled);
    }
  }, [myMembership]);

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

  const handleToggleNotifications = useCallback(async () => {
    const newValue = !notificationsEnabled;
    setNotificationsEnabled(newValue);
    try {
      await supabase
        .from('chat_room_members')
        .update({ notifications_enabled: newValue })
        .eq('room_id', roomId)
        .eq('member_id', member?.id);
    } catch (err) {
      setNotificationsEnabled(!newValue); // revert
      console.error('Failed to toggle notifications:', err);
    }
  }, [notificationsEnabled, roomId, member?.id]);

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

  const handleLeave = useCallback(async () => {
    if (!member?.id) return;
    if (!window.confirm('Bu odadan ayrılmak istediğinize emin misiniz?'))
      return;
    try {
      await leaveRoom(roomId, member.id);
      setRoomInfoOpen(false);
      router.push('/chat');
    } catch (err) {
      console.error('Failed to leave room:', err);
    }
  }, [roomId, member?.id, setRoomInfoOpen, router]);

  if (!room) return null;

  return (
    <AnimatePresence>
      {isRoomInfoOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-black/30 backdrop-blur-sm"
            onClick={() => setRoomInfoOpen(false)}
          />

          {/* Drawer */}
          <motion.div
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

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Room Avatar & Name */}
              <div className="flex flex-col items-center border-b border-[var(--color-border)] px-4 py-6">
                <div className="mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-[var(--color-accent-soft)]">
                  {room.avatar_url ? (
                    <img
                      src={room.avatar_url}
                      alt={room.name}
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : (
                    <Users
                      size={36}
                      className="text-[var(--color-accent)]"
                    />
                  )}
                </div>

                {/* Name (editable for admins) */}
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
                {isEditingDesc ? (
                  <div className="mt-2 flex w-full items-start gap-2">
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      rows={2}
                      className="flex-1 resize-none rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface)] px-3 py-1.5 text-center text-sm text-[var(--color-text-medium)] focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={() => void handleSaveDesc()}
                      className="mt-1 rounded-full bg-[var(--color-accent)] p-1.5 text-white"
                    >
                      <Check size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="mt-1 flex items-center gap-1.5">
                    <p className="text-center text-sm text-[var(--color-text-low)]">
                      {room.description || (isAdmin && !isDm ? 'Açıklama ekle...' : '')}
                    </p>
                    {isAdmin && !isDm && (
                      <button
                        onClick={() => {
                          setEditDesc(room.description ?? '');
                          setIsEditingDesc(true);
                        }}
                        className="rounded-full p-0.5 text-[var(--color-text-low)] hover:bg-[var(--color-surface)]"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                  </div>
                )}

                <p className="mt-2 text-xs text-[var(--color-text-low)]">
                  {roomMembers.length} üye
                </p>
              </div>

              {/* Notifications */}
              <div className="border-b border-[var(--color-border)] px-4 py-3">
                <button
                  onClick={handleToggleNotifications}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--color-surface)]"
                >
                  {notificationsEnabled ? (
                    <Bell
                      size={20}
                      className="text-[var(--color-accent)]"
                    />
                  ) : (
                    <BellOff
                      size={20}
                      className="text-[var(--color-text-low)]"
                    />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--color-text-high)]">
                      Bildirimler
                    </p>
                    <p className="text-xs text-[var(--color-text-low)]">
                      {notificationsEnabled ? 'Açık' : 'Kapalı'}
                    </p>
                  </div>
                  <div
                    className={`h-6 w-11 rounded-full p-0.5 transition-colors ${
                      notificationsEnabled
                        ? 'bg-[var(--color-accent)]'
                        : 'bg-[var(--color-border)]'
                    }`}
                  >
                    <motion.div
                      layout
                      className="h-5 w-5 rounded-full bg-white shadow-sm"
                      animate={{
                        x: notificationsEnabled ? 20 : 0,
                      }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  </div>
                </button>
              </div>

              {/* Members */}
              <div className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-[var(--color-text-medium)]">
                    Üyeler ({roomMembers.length})
                  </h4>
                  {isAdmin && !isDm && (
                    <button className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]">
                      <UserPlus size={14} />
                      Ekle
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-0.5">
                  {sortedMembers.map((rm) => {
                    const cm = rm.choir_members;
                    if (!cm) return null;
                    const isOnline = onlineUsers.includes(rm.member_id);
                    const isSelf = rm.member_id === member?.id;

                    return (
                      <div
                        key={rm.id}
                        className="flex items-center gap-3 rounded-xl px-2 py-2"
                      >
                        {/* Avatar */}
                        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface)]">
                          {cm.photo_url ? (
                            <img
                              src={cm.photo_url}
                              alt={cm.first_name}
                              className="h-full w-full rounded-full object-cover"
                            />
                          ) : (
                            <span className="text-sm font-bold text-[var(--color-accent)]">
                              {cm.first_name[0]}
                            </span>
                          )}
                          {isOnline && (
                            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-background)] bg-green-500" />
                          )}
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-sm font-medium text-[var(--color-text-high)]">
                              {cm.first_name} {cm.last_name}
                              {isSelf && (
                                <span className="text-[var(--color-text-low)]">
                                  {' '}
                                  (sen)
                                </span>
                              )}
                            </p>
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
                            onClick={() =>
                              void handleRemoveMember(rm.member_id)
                            }
                            className="shrink-0 rounded-full p-1.5 text-[var(--color-text-low)] hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
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
        </>
      )}
    </AnimatePresence>
  );
}
