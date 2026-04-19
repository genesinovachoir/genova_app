'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });
const LIGHT_FRAME = 60;
const DARK_FRAME = 90;
const ANIMATION_HOLD_MS = 900;

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [animationData, setAnimationData] = useState<unknown>(null);
  const lottieRef = useRef<any>(null);
  const animationLockUntilRef = useRef(0);
  const isDark = resolvedTheme !== 'light';

  useEffect(() => {
    let isCancelled = false;

    fetch('/lottie/light-dark-switch.json')
      .then((response) => {
        if (!response.ok) throw new Error('Animation not found');
        return response.json();
      })
      .then((json) => {
        if (!isCancelled) setAnimationData(json);
      })
      .catch(() => {
        if (!isCancelled) setAnimationData(null);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const label = isDark ? 'Açık moda geç' : 'Koyu moda geç';

  const handleToggle = () => {
    const nextIsDark = !isDark;

    if (lottieRef.current) {
      const fromFrame = isDark ? DARK_FRAME : LIGHT_FRAME;
      const toFrame = nextIsDark ? DARK_FRAME : LIGHT_FRAME;
      lottieRef.current.goToAndStop(fromFrame, true);
      lottieRef.current.playSegments([fromFrame, toFrame], true);
      animationLockUntilRef.current = Date.now() + ANIMATION_HOLD_MS;
    }

    requestAnimationFrame(() => {
      setTheme(nextIsDark ? 'dark' : 'light');
    });
  };

  useEffect(() => {
    if (!lottieRef.current || !animationData) {
      return;
    }
    if (Date.now() < animationLockUntilRef.current) {
      return;
    }
    const frame = isDark ? DARK_FRAME : LIGHT_FRAME;
    lottieRef.current.goToAndStop(frame, true);
  }, [animationData, isDark]);

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={label}
      title={label}
      className="flex h-[3.4rem] w-[3.4rem] items-center justify-center rounded-full bg-transparent active:scale-90 transition-transform"
    >
      {animationData ? (
        <Lottie
          lottieRef={lottieRef}
          animationData={animationData}
          loop={false}
          autoplay={false}
          onDOMLoaded={() => {
            if (lottieRef.current) {
              const frame = isDark ? DARK_FRAME : LIGHT_FRAME;
              lottieRef.current.goToAndStop(frame, true);
            }
          }}
          style={{ width: 44, height: 44 }}
        />
      ) : isDark ? (
        <Moon size={24} />
      ) : (
        <Sun size={24} />
      )}
    </button>
  );
}
