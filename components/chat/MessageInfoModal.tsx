'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Check, CheckCheck, Clock, Loader2 } from 'lucide-react';
import { fetchMessageStatuses } from '@/lib/chat';

interface MessageInfoModalProps {
  messageId: string;
  onClose: () => void;
}

interface StatusItem {
  delivered_at: string | null;
  read_at: string | null;
  choir_members: {
    first_name: string;
    last_name: string;
    photo_url: string | null;
  };
}

export function MessageInfoModal({ messageId, onClose }: MessageInfoModalProps) {
  const [statuses, setStatuses] = useState<StatusItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchMessageStatuses(messageId);
        setStatuses(data);
      } catch (err) {
        console.error('Failed to load message statuses:', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [messageId]);

  const readBy = statuses.filter((s) => s.read_at).sort((a, b) => 
    new Date(b.read_at!).getTime() - new Date(a.read_at!).getTime()
  );
  
  const deliveredTo = statuses.filter((s) => s.delivered_at && !s.read_at).sort((a, b) => 
    new Date(b.delivered_at!).getTime() - new Date(a.delivered_at!).getTime()
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-[var(--color-background)] overflow-hidden shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <h3 className="font-semibold text-[var(--color-text-high)]">Mesaj Bilgisi</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 hover:bg-[var(--color-surface)]"
          >
            <X size={18} className="text-[var(--color-text-medium)]" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-[var(--color-accent)]" size={24} />
            </div>
          ) : statuses.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--color-text-low)]">
              Henüz bilgi yok
            </div>
          ) : (
            <div className="flex flex-col">
              {/* Read By Section */}
              {readBy.length > 0 && (
                <div className="p-2">
                  <div className="flex items-center gap-2 px-3 py-2 text-[var(--color-accent)]">
                    <CheckCheck size={16} />
                    <span className="text-xs font-bold uppercase tracking-wider">Okuyanlar</span>
                  </div>
                  {readBy.map((s, idx) => (
                    <StatusRow key={idx} item={s} type="read" />
                  ))}
                </div>
              )}

              {/* Delivered To Section */}
              {deliveredTo.length > 0 && (
                <div className="p-2 border-t border-[var(--color-border)]">
                  <div className="flex items-center gap-2 px-3 py-2 text-[var(--color-text-medium)]">
                    <CheckCheck size={16} />
                    <span className="text-xs font-bold uppercase tracking-wider">Teslim Edilenler</span>
                  </div>
                  {deliveredTo.map((s, idx) => (
                    <StatusRow key={idx} item={s} type="delivered" />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function StatusRow({ item, type }: { item: StatusItem; type: 'read' | 'delivered' }) {
  const time = type === 'read' ? item.read_at : item.delivered_at;
  
  return (
    <div className="flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-[var(--color-surface)]">
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-[var(--color-accent-soft)] flex items-center justify-center">
        {item.choir_members.photo_url ? (
          <img src={item.choir_members.photo_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-sm font-bold text-[var(--color-accent)]">
            {item.choir_members.first_name[0]}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--color-text-high)]">
          {item.choir_members.first_name} {item.choir_members.last_name}
        </p>
        <p className="text-[0.65rem] text-[var(--color-text-low)]">
          {time ? new Date(time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '-'}
        </p>
      </div>
    </div>
  );
}
