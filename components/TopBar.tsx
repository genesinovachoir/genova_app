'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { Music4 } from 'lucide-react';
import { LottieIcon } from './LottieIcon';
import { useAuth } from './AuthProvider';
import { getRoleDisplayLabel } from '@/lib/role-labels';
import { useTheme } from 'next-themes';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

function isInBirthdayWindow(birthDate: string | null | undefined, now: Date) {
  if (!birthDate) return false;
  const parts = birthDate.split('-');
  if (parts.length < 3) return false;

  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return false;

  const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const year = today.getFullYear();
  const candidates = [year - 1, year, year + 1].map((y) => new Date(y, month - 1, day));

  let closestDiffDays = Number.POSITIVE_INFINITY;
  for (const birthday of candidates) {
    const diffDays = Math.round((birthday.getTime() - today.getTime()) / dayMs);
    if (Math.abs(diffDays) < Math.abs(closestDiffDays)) {
      closestDiffDays = diffDays;
    }
  }

  return closestDiffDays >= -3 && closestDiffDays <= 3;
}

export function TopBar() {
  const { member, isAdmin, isSectionLeader } = useAuth();
  const { resolvedTheme } = useTheme();
  const isLightTheme = resolvedTheme === 'light';
  const [imgError, setImgError] = useState(false);
  const [celebrationAnimation, setCelebrationAnimation] = useState<any>(null);
  const isBirthdayWeek = useMemo(() => isInBirthdayWindow(member?.birth_date, new Date()), [member?.birth_date]);

  const roleLabel = isAdmin()
    ? getRoleDisplayLabel('Şef', null, true)
    : isSectionLeader()
      ? getRoleDisplayLabel('Partisyon Şefi', member?.voice_group, true)
      : getRoleDisplayLabel('Korist', null, true);
  const displayName = member ? member.first_name : '...';

  useEffect(() => {
    if (!isBirthdayWeek) return;

    let cancelled = false;
    fetch('/lottie/celebration.json')
      .then((res) => {
        if (!res.ok) throw new Error('celebration.json not found');
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setCelebrationAnimation(json);
      })
      .catch(() => {
        if (!cancelled) setCelebrationAnimation(null);
      });

    return () => {
      cancelled = true;
    };
  }, [isBirthdayWeek]);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto max-w-lg px-2 pt-[env(safe-area-inset-top)]">
        <div className="glass-panel !border-none mt-1 flex items-center justify-between gap-2.5 px-4 py-3 sm:px-6">
          {isBirthdayWeek && celebrationAnimation && (
            <div
              className="pointer-events-none absolute inset-0 overflow-hidden"
              style={{ position: 'absolute', inset: 0, zIndex: 0 }}
              aria-hidden="true"
            >
              <Lottie
                animationData={celebrationAnimation}
                loop
                autoplay
                rendererSettings={{ preserveAspectRatio: 'xMidYMid slice' }}
                style={{ width: '100%', height: '100%', opacity: 0.55 }}
              />
            </div>
          )}

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
                <LottieIcon path={isLightTheme ? "/lottie/player music.json" : "/lottie/player music dark.json"} fallback={Music4} size={22} />
              )}
            </div>
            <div className="flex flex-1 flex-col justify-center min-w-0 ml-1">
              <p className="page-kicker text-[0.55rem] leading-none mb-1.5">GENOVA APP</p>
              <h1 className="font-serif text-[14px] sm:text-base font-medium tracking-tight text-[var(--color-text-high)] whitespace-nowrap">
                {isBirthdayWeek ? `İyi ki doğdun, ${displayName}` : `Hoş Geldin, ${displayName}`}
              </h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2">
            <div className="status-pill !min-h-[1.4rem] !px-2 !text-[0.5rem] sm:!text-[0.55rem] tracking-normal whitespace-nowrap opacity-80">{roleLabel}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
