'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { TopBar } from '@/components/TopBar';
import { BottomNav } from '@/components/BottomNav';
import { useAuth } from '@/components/AuthProvider';
import { NotificationPrompt } from '@/components/NotificationPrompt';
import { ProfileChangeRequestNotifier } from '@/components/ProfileChangeRequestNotifier';
import { FloatingMiniPlayer } from '@/components/FloatingMiniPlayer';
import { getRepertoireRoleScope } from '@/lib/repertuvar/cache';
import { getRepertoireCatalogQueryKey, loadRepertoireCatalog } from '@/lib/repertuvar/queries';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { session, member, isLoading, isAdmin, isSectionLeader } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const mainNavPages = ['/', '/repertuvar', '/odevler', '/profil'];
  const showNavigation = mainNavPages.includes(pathname);
  const roleScope = getRepertoireRoleScope(isAdmin(), isSectionLeader());


  useEffect(() => {
    if (!isLoading && !session) {
      router.replace('/login');
    }
  }, [session, isLoading, router]);

  useEffect(() => {
    if (isLoading || !session) {
      return;
    }

    void queryClient.prefetchQuery({
      queryKey: getRepertoireCatalogQueryKey(member?.id ?? null, roleScope),
      queryFn: () => loadRepertoireCatalog({ memberId: member?.id ?? null, roleScope }),
      staleTime: 30_000,
      gcTime: 24 * 60 * 60_000,
    });
  }, [isLoading, member?.id, queryClient, roleScope, session]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    void (async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));

        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(
            cacheNames
              .filter((cacheName) => cacheName.startsWith('genova-'))
              .map((cacheName) => caches.delete(cacheName)),
          );
        }
      } catch (error) {
        console.warn('Dev service worker temizleme başarısız:', error);
      }
    })();
  }, []);

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
