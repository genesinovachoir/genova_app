import { beforeEach, describe, expect, it } from 'vitest';

import { useMiniAudioPlayerStore } from '@/store/useMiniAudioPlayerStore';

const sessionPayload = {
  songId: 'song-1',
  songTitle: 'Test Song',
  coverSource: null,
  tracks: [{ id: 'track-1', label: 'Tutti', source: '/audio.mp3' }],
  currentTrackId: 'track-1',
  currentTime: 0,
  duration: 120,
  isPlaying: false,
  playbackRate: 1,
};

describe('useMiniAudioPlayerStore', () => {
  beforeEach(() => {
    useMiniAudioPlayerStore.getState().reset();
  });

  it('stores passive sessions without opening the player', () => {
    useMiniAudioPlayerStore.getState().setSession(sessionPayload);

    const state = useMiniAudioPlayerStore.getState();
    expect(state.isActive).toBe(false);
    expect(state.songId).toBe('song-1');
    expect(state.currentTrackId).toBe('track-1');
  });

  it('opens a passive session when explicitly activated', () => {
    useMiniAudioPlayerStore.getState().setSession(sessionPayload);
    useMiniAudioPlayerStore.getState().dismissSession('song-1');
    useMiniAudioPlayerStore.getState().setActive(true);

    const state = useMiniAudioPlayerStore.getState();
    expect(state.isActive).toBe(true);
    expect(state.dismissedSongId).toBeNull();
  });

  it('keeps the same passive song open after explicit activation', () => {
    useMiniAudioPlayerStore.getState().setSession(sessionPayload);
    useMiniAudioPlayerStore.getState().setActive(true);
    useMiniAudioPlayerStore.getState().setSession(sessionPayload);

    expect(useMiniAudioPlayerStore.getState().isActive).toBe(true);
  });

  it('keeps a dismissed song hidden during passive session refreshes', () => {
    useMiniAudioPlayerStore.getState().setSession(sessionPayload);
    useMiniAudioPlayerStore.getState().dismissSession('song-1');
    useMiniAudioPlayerStore.getState().setSession(sessionPayload);

    const state = useMiniAudioPlayerStore.getState();
    expect(state.isActive).toBe(false);
    expect(state.songId).toBe('song-1');
    expect(state.dismissedSongId).toBe('song-1');
  });

  it('does not carry active state into a different passive song session', () => {
    useMiniAudioPlayerStore.getState().setSession(sessionPayload);
    useMiniAudioPlayerStore.getState().setActive(true);
    useMiniAudioPlayerStore.getState().setSession({
      ...sessionPayload,
      songId: 'song-2',
      songTitle: 'Next Song',
      isPlaying: false,
    });

    const state = useMiniAudioPlayerStore.getState();
    expect(state.isActive).toBe(false);
    expect(state.songId).toBe('song-2');
  });

  it('reactivates a dismissed song when playback is active', () => {
    useMiniAudioPlayerStore.getState().dismissSession('song-1');
    useMiniAudioPlayerStore.getState().setSession({
      ...sessionPayload,
      isPlaying: true,
    });

    const state = useMiniAudioPlayerStore.getState();
    expect(state.isActive).toBe(true);
    expect(state.dismissedSongId).toBeNull();
  });
});
