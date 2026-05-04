'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Download, MessageCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ChatMessage } from '@/lib/chat';

interface ImageGalleryViewerProps {
  images: ChatMessage[];
  initialIndex: number;
  onClose: () => void;
  onGoToMessage?: (messageId: string) => void;
}

export function ImageGalleryViewer({
  images,
  initialIndex,
  onClose,
  onGoToMessage,
}: ImageGalleryViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % images.length);
  }, [images.length]);

  const handlePrev = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
  }, [images.length]);

  const handleDownload = useCallback(async (url: string, fileName: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName || 'download.jpg';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error('Download failed:', error);
    }
  }, []);

  if (!images || images.length === 0) return null;

  const currentMessage = images[currentIndex];
  const metadata = currentMessage?.metadata_json as Record<string, unknown> | undefined;
  
  // Extract URLs safely handling both single and multi-photo structures
  let imageUrls: string[] = [];
  if (metadata) {
    if (Array.isArray(metadata.urls)) {
      imageUrls = metadata.urls as string[];
    } else if (typeof metadata.url === 'string') {
      imageUrls = [metadata.url];
    }
  }

  // If there are multiple urls in a single message, we will just show the first one for simplicity in this top-level gallery, 
  // or we could flatten the images list before passing it to this component. 
  // We'll assume the parent component flattens the images so each item in `images` here represents ONE image URL to display.
  // Actually, to make it easier, let's just use the first URL here if it's not flattened.
  const currentUrl = imageUrls[0] || '';

  const senderName = currentMessage?.sender?.first_name 
    || currentMessage?.choir_members?.first_name 
    || 'Bilinmeyen Kullanıcı';
    
  const dateStr = currentMessage 
    ? new Date(currentMessage.created_at).toLocaleString('tr-TR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex flex-col bg-black/95 backdrop-blur-md"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 pt-[calc(env(safe-area-inset-top,0px)+16px)]">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-full p-2 text-white/80 hover:bg-white/10"
            >
              <X size={24} />
            </button>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-white">{senderName}</span>
              <span className="text-xs text-white/60">{dateStr}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onGoToMessage && (
              <button
                onClick={() => {
                  onGoToMessage(currentMessage.id);
                  onClose();
                }}
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
              >
                <MessageCircle size={14} />
                Mesaja Git
              </button>
            )}
            <button
              onClick={() => void handleDownload(currentUrl, `photo-${currentMessage.id}.jpg`)}
              className="rounded-full p-2 text-white/80 hover:bg-white/10"
            >
              <Download size={20} />
            </button>
          </div>
        </div>

        {/* Image Area */}
        <div className="relative flex-1 overflow-hidden">
          {images.length > 1 && (
            <button
              onClick={handlePrev}
              className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/80 hover:bg-black/70 hover:text-white"
            >
              <ChevronLeft size={24} />
            </button>
          )}

          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="flex h-full w-full items-center justify-center p-4"
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={(e, { offset, velocity }) => {
              const swipe = Math.abs(offset.x) * velocity.x;
              if (swipe < -100) handleNext();
              else if (swipe > 100) handlePrev();
            }}
          >
            <img
              src={currentUrl}
              alt="Gallery"
              className="max-h-full max-w-full object-contain"
            />
          </motion.div>

          {images.length > 1 && (
            <button
              onClick={handleNext}
              className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/80 hover:bg-black/70 hover:text-white"
            >
              <ChevronRight size={24} />
            </button>
          )}
        </div>

        {/* Footer info (optional description) */}
        {currentMessage?.content && (
          <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/80 to-transparent p-6 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
            <p className="text-center text-sm text-white/90">{currentMessage.content}</p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
