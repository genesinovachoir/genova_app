'use client';

import { useState } from 'react';
import { Music4 } from 'lucide-react';
import { LottieIcon } from './LottieIcon';
import { useAuth } from './AuthProvider';

export function TopBar() {
  const { member, isAdmin, isSectionLeader } = useAuth();
  const [imgError, setImgError] = useState(false);

  const roleLabel = isAdmin() ? 'Şef' : isSectionLeader() ? 'Part. Şefi' : 'Korist';
  const displayName = member ? member.first_name : '...';

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto max-w-lg px-4 pt-[env(safe-area-inset-top)] sm:pt-4">
        <div className="glass-panel mt-3 flex items-center justify-between gap-2.5 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
            <div className="icon-chip shrink-0 scale-110 relative overflow-hidden bg-[var(--color-surface-solid)]">
              {member?.photo_url && !imgError ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img 
                  src={member.photo_url} 
                  alt={displayName} 
                  className="h-full w-full object-cover" 
                  onError={() => setImgError(true)} 
                />
              ) : (
                <LottieIcon path="/lottie/player music.json" fallback={Music4} size={22} />
              )}
            </div>
            <div className="flex flex-1 flex-col justify-center min-w-0 ml-1">
              <p className="page-kicker text-[0.55rem] leading-none mb-1.5">Genova Korist</p>
              <h1 className="font-serif text-[14px] sm:text-base font-medium tracking-tight text-[var(--color-text-high)] whitespace-nowrap">
                Hoş Geldin, {displayName}
              </h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end">
            <div className="status-pill !min-h-[1.4rem] !px-2 !text-[0.5rem] sm:!text-[0.55rem] tracking-normal whitespace-nowrap opacity-80">{roleLabel}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
