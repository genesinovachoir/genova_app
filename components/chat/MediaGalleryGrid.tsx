'use client';

import { useState, useEffect } from 'react';
import { Loader2, Image as ImageIcon } from 'lucide-react';
import { fetchRoomMedia } from '@/lib/chat';
import type { ChatMessage } from '@/lib/chat';
import { ImageGalleryViewer } from './ImageGalleryViewer';

interface MediaGalleryGridProps {
  roomId: string;
  onGoToMessage: (messageId: string) => void;
}

export function MediaGalleryGrid({ roomId, onGoToMessage }: MediaGalleryGridProps) {
  const [images, setImages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Gallery state
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);

  useEffect(() => {
    async function loadMedia() {
      try {
        const data = await fetchRoomMedia(roomId);
        // Flatten messages that contain multiple images into separate "virtual" messages for the gallery
        const flattened: ChatMessage[] = [];
        for (const msg of data) {
          const meta = msg.metadata_json as any;
          if (meta?.urls && Array.isArray(meta.urls)) {
            meta.urls.forEach((url: string, idx: number) => {
              flattened.push({
                ...msg,
                metadata_json: { url, originalIndex: idx }
              });
            });
          } else if (meta?.url) {
            flattened.push(msg);
          }
        }
        setImages(flattened);
      } catch (err) {
        console.error('Failed to load room media:', err);
      } finally {
        setIsLoading(false);
      }
    }
    void loadMedia();
  }, [roomId]);

  if (isLoading) {
    return (
      <div className="flex p-8 justify-center">
        <Loader2 className="animate-spin text-[var(--color-accent)]" size={24} />
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="flex p-8 flex-col items-center justify-center text-center">
        <ImageIcon size={32} className="text-[var(--color-text-low)] mb-2 opacity-50" />
        <p className="text-sm text-[var(--color-text-low)]">
          Bu odada henüz fotoğraf paylaşılmadı.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-1 p-1">
        {images.map((msg, index) => {
          const url = (msg.metadata_json as any)?.url;
          if (!url) return null;
          
          return (
            <div 
              key={`${msg.id}-${index}`}
              onClick={() => setGalleryIndex(index)}
              className="aspect-square cursor-pointer overflow-hidden bg-[var(--color-surface)] relative group"
            >
              <img
                src={url}
                alt="Media"
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
            </div>
          );
        })}
      </div>

      {galleryIndex !== null && (
        <ImageGalleryViewer
          images={images}
          initialIndex={galleryIndex}
          onClose={() => setGalleryIndex(null)}
          onGoToMessage={onGoToMessage}
        />
      )}
    </>
  );
}
