'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { TopBar } from '@/components/TopBar';
import { BottomNav } from '@/components/BottomNav';
import { useAuth } from '@/components/AuthProvider';
import { NotificationPrompt } from '@/components/NotificationPrompt';
import { ProfileChangeRequestNotifier } from '@/components/ProfileChangeRequestNotifier';
import { FloatingMiniPlayer } from '@/components/FloatingMiniPlayer';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const mainNavPages = ['/', '/repertuvar', '/odevler', '/profil'];
  const showNavigation = mainNavPages.includes(pathname);


  useEffect(() => {
    if (!isLoading && !session) {
      router.replace('/login');
    }
  }, [session, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)]">
        <Loader2 className="animate-spin text-[var(--color-accent)]" size={32} />
      </div>
    );
  }

  if (!session) return null;

  const isProfilePage = pathname.startsWith('/profil');

  return (
    <>
      {showNavigation && !isProfilePage && <div className="fade-overlay fade-overlay-top" />}
      {showNavigation && !isProfilePage && <TopBar />}
      {children}
      <FloatingMiniPlayer hasBottomNav={showNavigation} />
      {showNavigation && <BottomNav />}
      {showNavigation && <div className="fade-overlay fade-overlay-bottom" />}
      <ProfileChangeRequestNotifier />
      <NotificationPrompt />
    </>
  );
}
