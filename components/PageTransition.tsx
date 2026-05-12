'use client';

import { useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigationStore } from '@/store/useNavigationStore';

// Ana sekmeler — tab swipe sıralaması için
const TAB_ORDER = ['/', '/repertuvar', '/chat', '/odevler', '/profil'];

function isTabRoute(path: string) {
  return TAB_ORDER.includes(path);
}

function getTabIndex(path: string) {
  return TAB_ORDER.indexOf(path);
}

/**
 * GPU-accelerated page transition wrapper.
 * Yalnızca transform + opacity kullanır, reflow yapmaz.
 *
 * - Ana sekmeler arası: Yatay slide (sola/sağa)
 * - İleri navigasyon: Sağdan girme + fade
 * - Geri navigasyon: Soldan girme + fade
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const direction = useNavigationStore((s) => s.direction);
  const [prevPath, setPrevPath] = useState(pathname);

  // Tab->tab geçişi mi?
  const isTabNav =
    isTabRoute(pathname) && isTabRoute(prevPath) && pathname !== prevPath;
  const prevTabIdx = getTabIndex(prevPath);
  const currTabIdx = getTabIndex(pathname);

  // Tab geçişinde yön tab sırasına göre belirle, diğer durumlarda store'dan al
  let slideDirection: 1 | -1;
  if (isTabNav) {
    slideDirection = currTabIdx > prevTabIdx ? 1 : -1;
  } else {
    slideDirection = direction === 'forward' ? 1 : -1;
  }

  // Path değiştiyse, derived state'i (prevPath) güncelle
  if (pathname !== prevPath) {
    setPrevPath(pathname);
  }

  const offsetX = 18; // % — kısa ve hızlı hissettiren offset

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={pathname}
        className="page-transition-layer"
        initial={{
          x: `${slideDirection * offsetX}%`,
          opacity: 0,
        }}
        animate={{
          x: '0%',
          opacity: 1,
        }}
        exit={{
          x: `${slideDirection * -offsetX}%`,
          opacity: 0,
        }}
        transition={{
          type: 'spring',
          stiffness: 380,
          damping: 34,
          mass: 0.8,
          opacity: { duration: 0.18, ease: 'easeOut' },
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
