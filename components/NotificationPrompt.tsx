'use client';

import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { supabase } from '@/lib/supabase';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function postWithAuth(url: string, payload: unknown) {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('Oturum bulunamadı.');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `İstek başarısız (${response.status})`);
  }
}

async function registerServiceWorker() {
  if (IS_DEVELOPMENT || !('serviceWorker' in navigator)) {
    return null;
  }

  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

async function ensurePushSubscription(registration: ServiceWorkerRegistration | null) {
  if (!registration || !VAPID_PUBLIC_KEY || !('PushManager' in window)) {
    return;
  }

  const existingSubscription = await registration.pushManager.getSubscription();
  if (existingSubscription) {
    await postWithAuth('/api/push/subscribe', existingSubscription.toJSON());
    return;
  }

  const newSubscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  await postWithAuth('/api/push/subscribe', newSubscription.toJSON());
}

async function unsubscribePush(registration: ServiceWorkerRegistration | null) {
  if (!registration || !('PushManager' in window)) {
    return;
  }

  const existingSubscription = await registration.pushManager.getSubscription();
  if (!existingSubscription) {
    return;
  }

  try {
    await postWithAuth('/api/push/unsubscribe', { endpoint: existingSubscription.endpoint });
  } catch (error) {
    console.error('Push aboneliği backend silinemedi:', error);
  }

  await existingSubscription.unsubscribe();
}

export function NotificationPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (IS_DEVELOPMENT) {
      return;
    }

    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const setupNotifications = async () => {
      try {
        const registration = await registerServiceWorker();

        if (Notification.permission === 'granted') {
          await ensurePushSubscription(registration);
          return;
        }

        if (Notification.permission === 'denied') {
          await unsubscribePush(registration);
          return;
        }

        const hasPromptedBefore = sessionStorage.getItem('notification_prompted');
        if (!hasPromptedBefore) {
          timeoutId = setTimeout(() => setShowPrompt(true), 3000);
        }
      } catch (error) {
        console.error('Bildirim kurulumu başarısız:', error);
      }
    };

    void setupNotifications();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  const requestPermission = async () => {
    if (!('Notification' in window)) {
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      const registration = await registerServiceWorker();

      if (permission === 'granted') {
        await ensurePushSubscription(registration);
      } else if (permission === 'denied') {
        await unsubscribePush(registration);
      }
    } catch (error) {
      console.error('Bildirim izni alınamadı:', error);
    }

    sessionStorage.setItem('notification_prompted', 'true');
    setShowPrompt(false);
  };

  return (
    <AnimatePresence>
      {showPrompt && (
        <div
          className="fixed bottom-0 inset-x-0 z-[100] flex justify-center p-4 pointer-events-none"
          style={{ paddingBottom: 'calc(7.5rem + env(safe-area-inset-bottom))' }}
        >
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="w-full max-w-[340px] pointer-events-auto rounded-[var(--radius-panel)] p-4 glass-panel shadow-xl"
          >
            <div className="flex items-start gap-4">
              <div className="p-2 bg-[var(--color-accent)]/10 rounded-full text-[var(--color-accent)] mt-1 shrink-0">
                <Bell size={24} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-[0.8rem] text-[var(--color-text-high)] uppercase tracking-wider">Bildirimler</h3>
                <p className="text-xs mt-1 text-[var(--color-text-medium)] leading-relaxed">
                  Koro duyuruları ve provalardan anında haberdar olmak ister misiniz?
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={requestPermission}
                    className="w-full rounded-[var(--radius-panel)] bg-[var(--color-accent)] py-2 text-[0.65rem] font-bold text-[var(--color-background)] transition-transform active:scale-95 uppercase tracking-widest"
                  >
                    Bildirimleri Aç
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
