let sharedAudioElement: HTMLAudioElement | null = null;

export function getSharedAudioElement(): HTMLAudioElement | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!sharedAudioElement) {
    sharedAudioElement = new Audio();
    sharedAudioElement.preload = 'auto';
  }

  return sharedAudioElement;
}

export function resolveAudioUrl(url: string): string {
  if (typeof window === 'undefined') {
    return url;
  }
  return new URL(url, window.location.href).href;
}
