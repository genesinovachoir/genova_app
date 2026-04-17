'use client';

import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';


export function NotificationPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // Only set up after a short delay so it doesn't jump directly after login
    if ('Notification' in window && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => console.log('SW registered:', registration.scope))
        .catch(err => console.error('SW registration failed:', err));

      if (Notification.permission === 'default') {
        const hasPromptedBefore = sessionStorage.getItem('notification_prompted');
        if (!hasPromptedBefore) {
          const timer = setTimeout(() => setShowPrompt(true), 3000);
          return () => clearTimeout(timer);
        }
      }
    }
  }, []);

  const requestPermission = async () => {
    if (!('Notification' in window)) return;
    try {
      // Must be called upon user gesture (button click)
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        console.log('Notification permission granted.');
        // Optionally, register for Push Notifications via pushManager here
      } else {
        console.log('Notification permission denied or dismissed.');
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error);
    }
    sessionStorage.setItem('notification_prompted', 'true');
    setShowPrompt(false);
  };

  const dismiss = () => {
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
            transition={{ duration: 0.4, ease: "easeOut" }}
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
