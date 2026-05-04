'use client';

import { Home, Music, ClipboardList, User, MessageCircle } from 'lucide-react';
import { LottieIcon } from './LottieIcon';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { useTheme } from 'next-themes';

export function BottomNav() {
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const isLightTheme = resolvedTheme === 'light';

  const navItems = [
    { name: 'Anasayfa', path: '/', icon: Home, lottie: isLightTheme ? '/lottie/Home Icon light.json' : '/lottie/Home Icon.json' },
    { name: 'Repertuvar', path: '/repertuvar', icon: Music, lottie: isLightTheme ? '/lottie/player music.json' : '/lottie/player music dark.json' },
    { name: 'Sohbet', path: '/chat', icon: MessageCircle, lottie: isLightTheme ? '/lottie/Chat light.json' : '/lottie/Chat dark.json' },
    { name: 'Ödevler', path: '/odevler', icon: ClipboardList, lottie: isLightTheme ? '/lottie/Tasks light.json' : '/lottie/Tasks.json' },
    { name: 'Profil', path: '/profil', icon: User, lottie: isLightTheme ? '/lottie/Profile Icon light.json' : '/lottie/Profile Icon.json' },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 pb-[calc(env(safe-area-inset-bottom)+12px)]">
      <div className="mx-auto w-full max-w-md px-2 sm:px-4">
        <div className="floating-nav !border-none !shadow-none flex items-center justify-around px-2 py-2">
        {navItems.map((item) => {
          const isActive = pathname === item.path;
          const Icon = item.icon;

          return (
            <Link
              key={item.path}
              href={item.path}
              className="relative flex flex-1 flex-col items-center justify-center gap-1 px-2 py-2.5 active:scale-95 sm:px-3"
            >
              {isActive && (
                <motion.div
                  layoutId="bottom-nav-indicator"
                  className="absolute inset-0 rounded-[10px] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)]"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                />
              )}
              <LottieIcon
                path={item.lottie}
                fallback={Icon}
                size={20}
                isActive={isActive}
                interactive={true}
                autoPlay={false}
                loop={false}
                className={`relative z-10 transition-colors duration-300 ${
                  item.name === 'Anasayfa' ? 'scale-[1.2]' : item.name === 'Repertuvar' ? 'scale-[1.35]' : item.name === 'Sohbet' ? 'scale-[1.2]' : 'scale-100'
                } ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-nav-icon)]'}`}
              />
              <span
                className={`relative z-10 font-sans text-[0.5rem] font-bold uppercase tracking-[0.16em] ${
                  isActive ? 'text-[var(--color-text-high)]' : 'text-[var(--color-text-medium)]'
                }`}
              >
                {item.name}
              </span>
            </Link>
          );
        })}
        </div>
      </div>
    </nav>
  );
}
