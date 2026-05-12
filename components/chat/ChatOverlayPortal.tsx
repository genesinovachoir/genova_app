'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ChatOverlayPortalProps {
  children: ReactNode;
}

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function ChatOverlayPortal({ children }: ChatOverlayPortalProps) {
  const canUseDOM = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot
  );

  if (!canUseDOM) return null;

  return createPortal(children, document.body);
}
