'use client';

import { useRef, useCallback, type PointerEvent } from 'react';
import { useMotionValue, animate, type MotionValue } from 'motion/react';
import { useRouter, usePathname } from 'next/navigation';
import { useNavigationStore } from '@/store/useNavigationStore';

const TAB_ORDER = ['/', '/repertuvar', '/chat', '/odevler', '/profil'];

const SWIPE_THRESHOLD = 0.22; // Ekranın %22'si
const VELOCITY_THRESHOLD = 350; // px/s
const EDGE_ACTIVATION_MIN = 72; // Ortadan başlayan swipe için hedef kenara yaklaşma mesafesi
const EDGE_ACTIVATION_MAX = 128;
const EDGE_ACTIVATION_RATIO = 0.18;
const INTENT_DISTANCE = 64; // Küçük orta hareketleri sayfa swipe'ına çevirmemek için
const DEAD_ZONE = 10;
const HORIZONTAL_DOMINANCE = 1.15;
const MIN_FLING_DISTANCE = 72;

interface UseTabSwipeReturn {
  x: MotionValue<number>;
  handlers: {
    onPointerDown: (e: PointerEvent) => void;
    onPointerMove: (e: PointerEvent) => void;
    onPointerUp: (e: PointerEvent) => void;
    onPointerCancel: () => void;
  };
}

/**
 * Ana sekmeler arası yatay swipe hook'u.
 * Sadece ana 5 sekmede aktif, detay sayfalarda tetiklenmez.
 *
 * Performans:
 * - MotionValue → React re-render yok
 * - router.prefetch ile sonraki sekmeyi önceden yükle
 * - Parmağı bırakınca spring fizik ile yerine oturtma
 */
export function useTabSwipe(): UseTabSwipeReturn {
  const x = useMotionValue(0);
  const router = useRouter();
  const pathname = usePathname();
  const setDirection = useNavigationStore((s) => s.setDirection);

  const isSwipingRef = useRef(false);
  const isSwipeCommittedRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const directionLockedRef = useRef<'x' | 'y' | null>(null);
  const startTimeRef = useRef(0);

  const currentTabIndex = TAB_ORDER.indexOf(pathname);
  const isTabPage = currentTabIndex !== -1;

  // Sonraki ve önceki sekmeleri prefetch et
  const prefetchAdjacentTabs = useCallback(() => {
    if (!isTabPage) return;
    const prev = TAB_ORDER[currentTabIndex - 1];
    const next = TAB_ORDER[currentTabIndex + 1];
    if (prev) router.prefetch(prev);
    if (next) router.prefetch(next);
  }, [isTabPage, currentTabIndex, router]);

  const getEdgeActivationZone = useCallback((screenWidth: number) => (
    Math.min(EDGE_ACTIVATION_MAX, Math.max(EDGE_ACTIVATION_MIN, screenWidth * EDGE_ACTIVATION_RATIO))
  ), []);

  const shouldCommitSwipe = useCallback((clientX: number, dx: number, screenWidth: number) => {
    if (Math.abs(dx) < INTENT_DISTANCE) return false;

    const activationZone = getEdgeActivationZone(screenWidth);
    if (dx < 0) return clientX <= activationZone;
    if (dx > 0) return clientX >= screenWidth - activationZone;
    return false;
  }, [getEdgeActivationZone]);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (!isTabPage) return;
      if (!e.isPrimary) return;
      // Sol kenar bölgesi SwipeBack'e ait — çakışmayı önle
      if (e.clientX < 36) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      isSwipingRef.current = true;
      isSwipeCommittedRef.current = false;
      startXRef.current = e.clientX;
      startYRef.current = e.clientY;
      startTimeRef.current = e.timeStamp;
      directionLockedRef.current = null;

      prefetchAdjacentTabs();
    },
    [isTabPage, prefetchAdjacentTabs],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isSwipingRef.current) return;

      const dx = e.clientX - startXRef.current;
      const dy = e.clientY - startYRef.current;

      // İlk hareket — yön kilidi
      if (!directionLockedRef.current) {
        if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
        directionLockedRef.current = Math.abs(dx) > Math.abs(dy) * HORIZONTAL_DOMINANCE ? 'x' : 'y';
      }

      // Dikey scroll — bizi ilgilendirmez
      if (directionLockedRef.current === 'y') return;

      if (!isSwipeCommittedRef.current) {
        const screenWidth = window.innerWidth;
        if (!shouldCommitSwipe(e.clientX, dx, screenWidth)) return;

        isSwipeCommittedRef.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }

      // Tab sınırlarını kontrol et
      const atFirst = currentTabIndex === 0;
      const atLast = currentTabIndex === TAB_ORDER.length - 1;

      let clampedDx = dx;
      // Son tab'da sola çekmeyi (pozitif yöne), ilk tab'da sağa çekmeyi (negatif yöne) sınırla
      if (atLast && dx < 0) clampedDx = dx * 0.2; // Elastik direnç
      if (atFirst && dx > 0) clampedDx = dx * 0.2;

      x.set(clampedDx);
    },
    [x, currentTabIndex, shouldCommitSwipe],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      if (!isSwipingRef.current) return;
      isSwipingRef.current = false;

      if (directionLockedRef.current !== 'x' || !isSwipeCommittedRef.current) {
        isSwipeCommittedRef.current = false;
        animate(x, 0, { type: 'spring', stiffness: 400, damping: 30 });
        return;
      }
      isSwipeCommittedRef.current = false;

      const currentX = x.get();
      const screenWidth = window.innerWidth;
      const elapsed = Math.max(1, (e.timeStamp - startTimeRef.current) / 1000);
      const velocity = Math.abs(currentX) / elapsed;

      const passedThreshold =
        Math.abs(currentX) > screenWidth * SWIPE_THRESHOLD ||
        (velocity > VELOCITY_THRESHOLD && Math.abs(currentX) > MIN_FLING_DISTANCE);

      let targetTabIndex = currentTabIndex;

      if (passedThreshold) {
        if (currentX > 0 && currentTabIndex > 0) {
          // Sağa çekti → önceki tab
          targetTabIndex = currentTabIndex - 1;
        } else if (currentX < 0 && currentTabIndex < TAB_ORDER.length - 1) {
          // Sola çekti → sonraki tab
          targetTabIndex = currentTabIndex + 1;
        }
      }

      if (targetTabIndex !== currentTabIndex) {
        const targetPath = TAB_ORDER[targetTabIndex];
        setDirection(currentX > 0 ? 'back' : 'forward');

        // Animasyonu bitir ve navigate et
        animate(x, currentX > 0 ? screenWidth : -screenWidth, {
          type: 'spring',
          stiffness: 300,
          damping: 30,
          onComplete: () => {
            router.push(targetPath);
            // Navigate sonrası x'i sıfırla — yeni sayfa temiz başlasın
            x.set(0);
          },
        });
      } else {
        // Geri snap
        animate(x, 0, { type: 'spring', stiffness: 400, damping: 30 });
      }
    },
    [x, currentTabIndex, router, setDirection],
  );

  const onPointerCancel = useCallback(() => {
    isSwipingRef.current = false;
    isSwipeCommittedRef.current = false;
    animate(x, 0, { type: 'spring', stiffness: 400, damping: 30 });
  }, [x]);

  return {
    x,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  };
}
