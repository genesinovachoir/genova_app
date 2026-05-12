'use client';

import { useRef, useCallback } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { useNavigationStore } from '@/store/useNavigationStore';
import { useBackOrHome } from '@/hooks/useBackOrHome';

const EDGE_ZONE = 32;         // Swipe sadece sol kenardan (0-32px) başlarsa aktif
const THRESHOLD_RATIO = 0.28; // Ekranın %28'ini çekmek yeterli
const VELOCITY_THRESHOLD = 400; // px/s — hızlı fırlatma

interface SwipeBackProps {
  fallback?: string; // Geri gidecek yer yoksa nereye (ör: '/odevler')
  children: React.ReactNode;
}

/**
 * iOS-style swipe-to-go-back.
 * Ekranın sol kenarından (0–32px) parmakla sağa çekince geri gider.
 *
 * Performans:
 * - MotionValue kullanır → React re-render yok
 * - Sadece transform + opacity → GPU path, reflow yok
 * - touch-action: pan-y → dikey scroll korunur
 */
export function SwipeBack({ fallback = '/', children }: SwipeBackProps) {
  const x = useMotionValue(0);
  const handleBack = useBackOrHome(fallback);
  const setDirection = useNavigationStore((s) => s.setDirection);

  // Swipe aktiflik tracking — React state yerine ref (re-render yok)
  const isSwipingRef = useRef(false);
  const startXRef = useRef(0);

  // Geri gösterge opaklığı — x arttıkça belirginleşir
  const indicatorOpacity = useTransform(x, [0, 60, 120], [0, 0.4, 1]);
  const indicatorScale = useTransform(x, [0, 60, 120], [0.5, 0.8, 1]);

  // Arka plan solma efekti
  const overlayOpacity = useTransform(x, [0, 200], [0, 0.15]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Sadece sol kenar bölgesinden başlayan touch'ları yakala
      if (e.clientX > EDGE_ZONE) return;
      // Sadece tek parmak (birincil)
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      isSwipingRef.current = true;
      startXRef.current = e.clientX;

      // Capture pointer — finger tracking kaçırmasın
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isSwipingRef.current) return;

      const dx = Math.max(0, e.clientX - startXRef.current);
      x.set(dx);
    },
    [x],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isSwipingRef.current) return;
      isSwipingRef.current = false;

      const currentX = x.get();
      const screenWidth = window.innerWidth;

      // Velocity hesapla — basit fark tabanlı
      const dx = e.clientX - startXRef.current;
      const velocity = dx / Math.max(1, (e.timeStamp % 1000) / 1000);

      const passedThreshold =
        currentX > screenWidth * THRESHOLD_RATIO || velocity > VELOCITY_THRESHOLD;

      if (passedThreshold) {
        // Geri git — önce ekranı tamamen kaydır, sonra navigate
        setDirection('back');
        animate(x, screenWidth, {
          type: 'spring',
          stiffness: 300,
          damping: 30,
          onComplete: () => {
            handleBack();
          },
        });
      } else {
        // Geri snap
        animate(x, 0, {
          type: 'spring',
          stiffness: 400,
          damping: 28,
        });
      }
    },
    [x, handleBack, setDirection],
  );

  const onPointerCancel = useCallback(() => {
    if (!isSwipingRef.current) return;
    isSwipingRef.current = false;
    animate(x, 0, { type: 'spring', stiffness: 400, damping: 28 });
  }, [x]);

  return (
    <div
      className="swipe-back-root"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* Sol kenar geri gösterge */}
      <motion.div
        className="pointer-events-none fixed left-0 top-0 z-[60] flex h-full w-8 items-center justify-center"
        style={{ opacity: indicatorOpacity }}
      >
        <motion.div
          className="flex h-12 w-8 items-center justify-center rounded-r-xl bg-[var(--color-accent)]/20 backdrop-blur-sm"
          style={{ scale: indicatorScale }}
        >
          <ChevronLeft size={20} className="text-[var(--color-accent)]" />
        </motion.div>
      </motion.div>

      {/* Arka plan overlay */}
      <motion.div
        className="pointer-events-none fixed inset-0 z-[55] bg-black"
        style={{ opacity: overlayOpacity }}
      />

      {/* Asıl sayfa içeriği */}
      <motion.div style={{ x }} className="swipe-back-content">
        {children}
      </motion.div>
    </div>
  );
}
