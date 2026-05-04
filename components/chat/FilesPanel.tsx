'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, Loader2, MessageCircle } from 'lucide-react';
import { fetchRoomFiles } from '@/lib/chat';
import type { ChatRoomFile } from '@/lib/chat';

interface FilesPanelProps {
  roomId: string;
  onGoToMessage: (messageId: string) => void;
}

function formatFileSize(sizeBytes: number | null): string {
  if (sizeBytes == null || sizeBytes <= 0) return 'Bilinmiyor';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFileDate(value: string): string {
  return new Date(value).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function FilesPanel({ roomId, onGoToMessage }: FilesPanelProps) {
  const [files, setFiles] = useState<ChatRoomFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadFiles() {
      try {
        const data = await fetchRoomFiles(roomId);
        setFiles(data);
      } catch (err) {
        console.error('Failed to load room files:', err);
      } finally {
        setIsLoading(false);
      }
    }
    void loadFiles();
  }, [roomId]);

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin text-[var(--color-accent)]" size={24} />
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <FileText size={32} className="mb-2 text-[var(--color-text-low)] opacity-50" />
        <p className="text-sm text-[var(--color-text-low)]">
          Bu odada henüz dosya paylaşılmadı.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {files.map((file) => (
        <div
          key={file.id}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
        >
          <div className="mb-2 flex items-start gap-2">
            <FileText size={16} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--color-text-high)]">
                {file.name}
              </p>
              <p className="text-[0.68rem] text-[var(--color-text-low)]">
                {formatFileDate(file.created_at)} · {formatFileSize(file.size_bytes)}
                {file.mime_type ? ` · ${file.mime_type}` : ''}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <a
              href={file.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] py-2 text-xs font-medium text-[var(--color-text-medium)] transition-colors hover:bg-[var(--color-surface)]"
            >
              <Download size={13} />
              Dosyayı Aç
            </a>
            <button
              onClick={() => onGoToMessage(file.message_id)}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent-soft)] py-2 text-xs font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-white"
            >
              <MessageCircle size={13} />
              Mesaja Git
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
