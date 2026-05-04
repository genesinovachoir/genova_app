'use client';

import { Globe, X } from 'lucide-react';
import type { LinkPreviewData } from '@/lib/chat';

interface LinkPreviewCardProps {
  preview: LinkPreviewData;
  variant: 'input' | 'bubble';
  isOwn?: boolean;
  onDismiss?: () => void;
  onClick?: () => void;
}

function openInNewTab(url: string, onClick?: () => void) {
  onClick?.();
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function LinkPreviewCard({
  preview,
  variant,
  isOwn = false,
  onDismiss,
  onClick,
}: LinkPreviewCardProps) {
  const hasImage = variant === 'bubble' && Boolean(preview.image);

  if (variant === 'input') {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => openInNewTab(preview.url, onClick)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openInNewTab(preview.url, onClick);
          }
        }}
        className="group relative flex cursor-pointer items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2"
      >
        <div className="h-8 w-0.5 rounded-full bg-[var(--color-accent)]" />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-1.5">
            {preview.favicon ? (
              <img
                src={preview.favicon}
                alt="Site icon"
                className="h-3.5 w-3.5 shrink-0 rounded-sm object-cover"
                loading="lazy"
              />
            ) : (
              <Globe size={13} className="shrink-0 text-[var(--color-text-low)]" />
            )}
            <p className="truncate text-[0.7rem] text-[var(--color-text-low)]">
              {preview.domain}
            </p>
          </div>
          <p className="truncate text-xs font-medium text-[var(--color-text-high)]">
            {preview.title || preview.url}
          </p>
        </div>
        {onDismiss && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="shrink-0 rounded-full p-1 text-[var(--color-text-low)] hover:bg-[var(--color-surface-hover)]"
            aria-label="Önizlemeyi kaldır"
          >
            <X size={14} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openInNewTab(preview.url, onClick)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openInNewTab(preview.url, onClick);
        }
      }}
      className={`mt-2 overflow-hidden rounded-2xl border transition-colors ${
        isOwn
          ? 'border-white/20 bg-white/10 hover:bg-white/15'
          : 'border-[var(--color-border)] bg-[var(--color-background)] hover:bg-[var(--color-surface)]'
      }`}
    >
      {hasImage && (
        <div className="max-h-40 w-full overflow-hidden border-b border-[var(--color-border)]">
          <img
            src={preview.image ?? ''}
            alt={preview.title ?? preview.domain}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      )}
      <div className="p-2.5">
        <p
          className={`line-clamp-2 text-xs font-semibold ${
            isOwn ? 'text-white' : 'text-[var(--color-text-high)]'
          }`}
        >
          {preview.title || preview.url}
        </p>
        {preview.description && (
          <p
            className={`mt-1 line-clamp-2 text-[0.7rem] ${
              isOwn ? 'text-white/75' : 'text-[var(--color-text-medium)]'
            }`}
          >
            {preview.description}
          </p>
        )}
        <div className="mt-2 flex items-center gap-1.5">
          {preview.favicon ? (
            <img
              src={preview.favicon}
              alt="Site icon"
              className="h-3.5 w-3.5 rounded-sm object-cover"
              loading="lazy"
            />
          ) : (
            <Globe size={13} className={isOwn ? 'text-white/70' : 'text-[var(--color-text-low)]'} />
          )}
          <p className={`truncate text-[0.65rem] ${isOwn ? 'text-white/70' : 'text-[var(--color-text-low)]'}`}>
            {preview.domain}
          </p>
        </div>
      </div>
    </div>
  );
}
