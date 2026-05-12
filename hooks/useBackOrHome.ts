import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useNavigationStore } from '@/store/useNavigationStore';

const NOTIFICATION_BACK_PARAM = 'fromNotification';
const RETURN_TO_PARAM = 'returnTo';

function hasSameOriginReferrer() {
  if (typeof window === 'undefined' || !document.referrer) {
    return false;
  }

  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

function canGoBackInHistory() {
  if (typeof window === 'undefined') {
    return false;
  }

  const state = window.history.state as { idx?: number } | null;
  if (typeof state?.idx === 'number') {
    return state.idx > 0;
  }

  if (window.history.length <= 1) {
    return false;
  }

  return hasSameOriginReferrer();
}

function openedFromNotification() {
  if (typeof window === 'undefined') {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  return params.get(NOTIFICATION_BACK_PARAM) === '1';
}

function getInternalReturnToPath() {
  if (typeof window === 'undefined') {
    return null;
  }

  const value = new URLSearchParams(window.location.search).get(RETURN_TO_PARAM);
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return null;
  }

  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function useBackOrHome(homePath = '/') {
  const router = useRouter();
  const setDirection = useNavigationStore((s) => s.setDirection);

  return useCallback(() => {
    setDirection('back');

    const returnToPath = getInternalReturnToPath();
    if (returnToPath) {
      router.replace(returnToPath);
      return;
    }

    if (openedFromNotification() || !canGoBackInHistory()) {
      router.replace(homePath);
      return;
    }

    router.back();
  }, [homePath, router, setDirection]);
}
