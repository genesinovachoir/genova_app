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
  updateRoomAvatar,
  updateMemberRole,
} from '@/lib/chat';
import type { ChatRoomMember } from '@/lib/chat';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { MediaGalleryGrid } from './MediaGalleryGrid';
import { StarredMessagesPanel } from './StarredMessagesPanel';
import { MemberActionSheet } from './MemberActionSheet';

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

  const [activeTab, setActiveTab] = useState<'members' | 'media' | 'starred'>('members');
  const [selectedMember, setSelectedMember] = useState<ChatRoomMember | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex flex-col items-center border-b border-[var(--color-border)] px-4 py-6">
                <div 
                  className="relative mx-auto mb-4 flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-surface)] shadow-md group"
                  onClick={() => {
                    if (isAdmin && !isDm) {
                      fileInputRef.current?.click();
                    }
                  }}
                >
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    ref={fileInputRef} 
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file && member?.id && isAdmin) {
                        try {
                          await updateRoomAvatar(roomId, member.id, file);
                        } catch (err) {
                          console.error('Failed to update avatar', err);
                        }
                      }
                      if (e.target) e.target.value = '';
                    }} 
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
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Pencil size={20} className="text-white" />
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
      
      {selectedMember && (
        <MemberActionSheet
          isOpen={!!selectedMember}
          member={selectedMember}
          onClose={() => setSelectedMember(null)}
          onMakeAdmin={async () => {
            if (!member?.id) return;
            try {
              await updateMemberRole(roomId, member.id, selectedMember.member_id, 'admin');
              onMembersChange(roomMembers.map(m => m.id === selectedMember.id ? { ...m, role: 'admin' } : m));
            } catch (err) {
              console.error('Failed to make admin:', err);
            }
          }}
          onRemoveAdmin={async () => {
            if (!member?.id) return;
            try {
              await updateMemberRole(roomId, member.id, selectedMember.member_id, 'member');
              onMembersChange(roomMembers.map(m => m.id === selectedMember.id ? { ...m, role: 'member' } : m));
            } catch (err) {
              console.error('Failed to remove admin:', err);
            }
          }}
          onRemoveMember={() => void handleRemoveMember(selectedMember.member_id)}
        />
      )}
    </AnimatePresence>
  );
}
