'use client';

import { motion, AnimatePresence } from 'motion/react';
import { Shield, ShieldAlert, Trash2, X } from 'lucide-react';
import type { ChatRoomMember } from '@/lib/chat';

interface MemberActionSheetProps {
  member: ChatRoomMember;
  isOpen: boolean;
  onClose: () => void;
  onMakeAdmin: () => void;
  onRemoveAdmin: () => void;
  onRemoveMember: () => void;
}

export function MemberActionSheet({
  member,
  isOpen,
  onClose,
  onMakeAdmin,
  onRemoveAdmin,
  onRemoveMember,
}: MemberActionSheetProps) {
  const isAdmin = member.role === 'admin';
  const name = member.choir_members?.first_name || 'Üye';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-[201] rounded-t-3xl bg-[var(--color-background)] p-6 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] shadow-xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--color-text-high)]">
                {name} İçin İşlemler
              </h3>
              <button
                onClick={onClose}
                className="rounded-full bg-[var(--color-surface)] p-2 text-[var(--color-text-medium)]"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {isAdmin ? (
                <button
                  onClick={() => {
                    onRemoveAdmin();
                    onClose();
                  }}
                  className="flex items-center gap-3 rounded-2xl bg-[var(--color-surface)] p-4 text-left text-amber-600 transition-colors hover:bg-amber-50"
                >
                  <ShieldAlert size={20} />
                  <div>
                    <p className="font-semibold">Yöneticiliği Al</p>
                    <p className="text-xs opacity-80">Bu kişiyi normal üye yap</p>
                  </div>
                </button>
              ) : (
                <button
                  onClick={() => {
                    onMakeAdmin();
                    onClose();
                  }}
                  className="flex items-center gap-3 rounded-2xl bg-[var(--color-surface)] p-4 text-left text-green-600 transition-colors hover:bg-green-50"
                >
                  <Shield size={20} />
                  <div>
                    <p className="font-semibold">Yönetici Yap</p>
                    <p className="text-xs opacity-80">Oda ayarlarını yönetme yetkisi ver</p>
                  </div>
                </button>
              )}

              <button
                onClick={() => {
                  onRemoveMember();
                  onClose();
                }}
                className="flex items-center gap-3 rounded-2xl bg-[var(--color-surface)] p-4 text-left text-red-500 transition-colors hover:bg-red-50"
              >
                <Trash2 size={20} />
                <div>
                  <p className="font-semibold">Odadan Çıkar</p>
                  <p className="text-xs opacity-80">Kişiyi bu sohbetten sil</p>
                </div>
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
