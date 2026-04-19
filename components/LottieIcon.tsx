'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, useRef } from 'react';

// Require the named export from the module
const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

interface LottieIconProps {
  path: string;
  fallback: React.ElementType;
  size?: number | string;
  className?: string;
  isActive?: boolean;
  stopAtHalf?: boolean;
  interactive?: boolean;
  loop?: boolean;
  autoPlay?: boolean;
  disableAnimation?: boolean;
}

export function LottieIcon({ 
  path, 
  fallback: FallbackIcon, 
  size = 24, 
  className, 
  isActive, 
  stopAtHalf,
  interactive = true,
  loop = false,
  autoPlay = false,
  disableAnimation = false,
}: LottieIconProps) {
  const [animationData, setAnimationData] = useState<any>(null);
  const lottieRef = useRef<any>(null);

  useEffect(() => {
    if (disableAnimation) return;

    fetch(path)
      .then((res) => {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then((data) => setAnimationData(data))
      .catch(() => setAnimationData(null));
  }, [path, disableAnimation]);

  useEffect(() => {
    if (isActive && lottieRef.current && animationData) {
      if (stopAtHalf && animationData.op) {
        lottieRef.current.playSegments([0, Math.floor(animationData.op * 0.55)], true);
      } else {
        lottieRef.current.stop();
        lottieRef.current.play();
      }
    }
  }, [isActive, animationData, stopAtHalf]);

  const handleInteract = () => {
    if (lottieRef.current && animationData) {
      if (stopAtHalf && animationData.op) {
        lottieRef.current.playSegments([0, Math.floor(animationData.op * 0.55)], true);
      } else {
        lottieRef.current.stop();
        lottieRef.current.play();
      }
    }
  };

  if (disableAnimation || fallbackIfMissing(animationData)) {
    return <FallbackIcon size={size} className={className} />;
  }

  const initialSegment = stopAtHalf && animationData?.op 
    ? [0, Math.floor(animationData.op * 0.55)] 
    : undefined;

  return (
    <div 
      onClick={interactive ? handleInteract : undefined}
      className={`flex items-center justify-center ${interactive ? 'cursor-pointer' : ''} ${className || ''}`} 
      style={{ width: size, height: size }}
    >
      <Lottie 
        lottieRef={lottieRef}
        animationData={animationData} 
        loop={loop} 
        autoplay={autoPlay || isActive} 
        initialSegment={initialSegment as [number, number]}
        onDOMLoaded={() => {
          if (isActive && lottieRef.current && animationData) {
             if (stopAtHalf && animationData.op) {
                lottieRef.current.playSegments([0, Math.floor(animationData.op * 0.55)], true);
             } else {
                lottieRef.current.play();
             }
          }
        }}
        style={{ width: '100%', height: '100%' }} 
      />
    </div>
  );
}

function fallbackIfMissing(data: any) {
  return data === null;
}
