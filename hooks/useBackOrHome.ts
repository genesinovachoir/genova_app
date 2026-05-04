'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

const NOTIFICATION_BACK_PARAM = 'fromNotification';

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

export function useBackOrHome(homePath = '/') {
  const router = useRouter();

  return useCallback(() => {
    if (openedFromNotification() || !canGoBackInHistory()) {
      router.replace(homePath);
      return;
    }

    router.back();
  }, [homePath, router]);
}
