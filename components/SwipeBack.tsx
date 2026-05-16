'use client';

import { useRef, useCallback } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { useNavigationStore } from '@/store/useNavigationStore';
import { useBackOrHome } from '@/hooks/useBackOrHome';

const EDGE_ZONE = 32;         // Sol kenardan başlayan eski hızlı geri swipe davranışı
const THRESHOLD_RATIO = 0.28; // Ekranın %28'ini çekmek yeterli
const VELOCITY_THRESHOLD = 400; // px/s — hızlı fırlatma
const EDGE_ACTIVATION_MIN = 72; // Ortadan başlayan geri swipe için sağ kenara yaklaşma mesafesi
const EDGE_ACTIVATION_MAX = 128;
const EDGE_ACTIVATION_RATIO = 0.18;
const INTENT_DISTANCE = 64;
const DEAD_ZONE = 10;
const HORIZONTAL_DOMINANCE = 1.15;
const MIN_FLING_DISTANCE = 88;

interface SwipeBackProps {
  fallback?: string; // Geri gidecek yer yoksa nereye (ör: '/odevler')
  children: React.ReactNode;
}

/**
 * iOS-style swipe-to-go-back.
 * Sol kenardan başlayan swipe hemen, ortadan başlayan swipe ise parmak sağ kenara yaklaşınca aktifleşir.
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
  const isSwipeCommittedRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const directionLockedRef = useRef<'x' | 'y' | null>(null);

  // Geri gösterge opaklığı — x arttıkça belirginleşir
  const indicatorOpacity = useTransform(x, [0, 60, 120], [0, 0.4, 1]);
  const indicatorScale = useTransform(x, [0, 60, 120], [0.5, 0.8, 1]);

  // Arka plan solma efekti
  const overlayOpacity = useTransform(x, [0, 200], [0, 0.15]);

  const getEdgeActivationZone = useCallback((screenWidth: number) => (
    Math.min(EDGE_ACTIVATION_MAX, Math.max(EDGE_ACTIVATION_MIN, screenWidth * EDGE_ACTIVATION_RATIO))
  ), []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Sadece tek parmak (birincil)
      if (!e.isPrimary) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      isSwipingRef.current = true;
      isSwipeCommittedRef.current = e.clientX <= EDGE_ZONE;
      startXRef.current = e.clientX;
      startYRef.current = e.clientY;
      startTimeRef.current = e.timeStamp;
      directionLockedRef.current = null;

      if (isSwipeCommittedRef.current) {
        // Capture pointer — finger tracking kaçırmasın
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isSwipingRef.current) return;

      const dx = Math.max(0, e.clientX - startXRef.current);
      const rawDx = e.clientX - startXRef.current;
      const dy = e.clientY - startYRef.current;

      if (!directionLockedRef.current) {
        if (Math.abs(rawDx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
        directionLockedRef.current = rawDx > 0 && Math.abs(rawDx) > Math.abs(dy) * HORIZONTAL_DOMINANCE ? 'x' : 'y';
      }

      if (directionLockedRef.current === 'y') return;

      if (!isSwipeCommittedRef.current) {
        const screenWidth = window.innerWidth;
        const activationZone = getEdgeActivationZone(screenWidth);
        const reachedRightEdge = e.clientX >= screenWidth - activationZone;
        const intentionalDrag = rawDx >= INTENT_DISTANCE;

        if (!intentionalDrag || !reachedRightEdge) return;

        isSwipeCommittedRef.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }

      x.set(dx);
    },
    [getEdgeActivationZone, x],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isSwipingRef.current) return;
      isSwipingRef.current = false;

      if (directionLockedRef.current !== 'x' || !isSwipeCommittedRef.current) {
        isSwipeCommittedRef.current = false;
        animate(x, 0, { type: 'spring', stiffness: 400, damping: 28 });
        return;
      }
      isSwipeCommittedRef.current = false;

      const currentX = x.get();
      const screenWidth = window.innerWidth;

      const dx = e.clientX - startXRef.current;
      const elapsed = Math.max(1, (e.timeStamp - startTimeRef.current) / 1000);
      const velocity = dx / elapsed;

      const passedThreshold =
        currentX > screenWidth * THRESHOLD_RATIO ||
        (velocity > VELOCITY_THRESHOLD && currentX > MIN_FLING_DISTANCE);

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
    isSwipeCommittedRef.current = false;
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
