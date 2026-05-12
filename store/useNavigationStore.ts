import { create } from 'zustand';

/**
 * Navigasyon yönünü takip eder.
 * 'forward' = ileri navigasyon (link tıklama, push)
 * 'back'    = geri navigasyon (swipe-back, router.back, browser back)
 */

type NavigationDirection = 'forward' | 'back';

interface NavigationState {
  direction: NavigationDirection;
  setDirection: (direction: NavigationDirection) => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  direction: 'forward',
  setDirection: (direction) => set({ direction }),
}));
