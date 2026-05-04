'use client';

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, Loader2 } from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState<'delivered' | 'read'>('delivered');

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

  useEffect(() => {
    if (isLoading) return;
    if (readBy.length > 0) {
      setActiveTab('read');
      return;
    }
    setActiveTab('delivered');
  }, [isLoading, readBy.length]);

  useEffect(() => {
    if (activeTab === 'read' && readBy.length === 0 && deliveredTo.length > 0) {
      setActiveTab('delivered');
      return;
    }
    if (activeTab === 'delivered' && deliveredTo.length === 0 && readBy.length > 0) {
      setActiveTab('read');
    }
  }, [activeTab, deliveredTo.length, readBy.length]);

  const activeList = activeTab === 'read' ? readBy : deliveredTo;

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
              <div className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-background)] p-2">
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--color-surface)] p-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab('delivered')}
                    className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition ${
                      activeTab === 'delivered'
                        ? 'bg-[var(--color-background)] text-[var(--color-text-high)] shadow-sm'
                        : 'text-[var(--color-text-medium)]'
                    }`}
                  >
                    Teslim Edilenler ({deliveredTo.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('read')}
                    className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition ${
                      activeTab === 'read'
                        ? 'bg-[var(--color-background)] text-[var(--color-accent)] shadow-sm'
                        : 'text-[var(--color-text-medium)]'
                    }`}
                  >
                    Okuyanlar ({readBy.length})
                  </button>
                </div>
              </div>

              <div className="p-2">
                {activeList.length > 0 ? (
                  activeList.map((s, idx) => (
                    <StatusRow key={idx} item={s} type={activeTab} />
                  ))
                ) : (
                  <div className="px-2 py-10 text-center text-sm text-[var(--color-text-low)]">
                    {activeTab === 'read' ? 'Henüz okuyan yok' : 'Henüz teslim edilen yok'}
                  </div>
                )}
              </div>
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
