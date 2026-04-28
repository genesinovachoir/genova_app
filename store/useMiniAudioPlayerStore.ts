import { create } from 'zustand';

export interface MiniAudioTrack {
  id: string;
  label: string;
  source: string;
}

interface MiniAudioPlayerState {
  isActive: boolean;
  songId: string | null;
  songTitle: string;
  coverSource: string | null;
  tracks: MiniAudioTrack[];
  currentTrackId: string | null;
  dismissedSongId: string | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  setSession: (payload: {
    songId: string | null;
    songTitle: string;
    coverSource: string | null;
    tracks: MiniAudioTrack[];
    currentTrackId: string | null;
    currentTime: number;
    duration: number;
    isPlaying: boolean;
    playbackRate: number;
  }) => void;
  setPlaybackState: (payload: Partial<Pick<MiniAudioPlayerState, 'currentTime' | 'duration' | 'isPlaying' | 'playbackRate'>>) => void;
  setCurrentTrackId: (id: string | null) => void;
  setActive: (value: boolean) => void;
  dismissSession: (songId: string | null) => void;
  reset: () => void;
}

const initialState = {
  isActive: false,
  songId: null,
  songTitle: '',
  coverSource: null,
  tracks: [] as MiniAudioTrack[],
  currentTrackId: null,
  dismissedSongId: null,
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  playbackRate: 1,
};

export const useMiniAudioPlayerStore = create<MiniAudioPlayerState>((set) => ({
  ...initialState,
  setSession: (payload) =>
    set((state) => {
      const isDismissedSong = Boolean(payload.songId && state.dismissedSongId === payload.songId);
      const isSameSong = Boolean(payload.songId && state.songId === payload.songId);
      const shouldActivate = payload.isPlaying || (state.isActive && isSameSong && !isDismissedSong);

      return {
        ...payload,
        dismissedSongId: isDismissedSong && !shouldActivate ? state.dismissedSongId : null,
        isActive: shouldActivate,
      };
    }),
  setPlaybackState: (payload) =>
    set((state) => ({
      ...payload,
      currentTime: payload.currentTime ?? state.currentTime,
      duration: payload.duration ?? state.duration,
      isPlaying: payload.isPlaying ?? state.isPlaying,
      playbackRate: payload.playbackRate ?? state.playbackRate,
    })),
  setCurrentTrackId: (currentTrackId) => set({ currentTrackId }),
  setActive: (isActive) =>
    set((state) => ({
      isActive,
      dismissedSongId: isActive ? null : state.dismissedSongId,
    })),
  dismissSession: (songId) =>
    set((state) => ({
      ...state,
      isActive: false,
      isPlaying: false,
      currentTime: 0,
      dismissedSongId: songId ?? state.songId,
    })),
  reset: () => set(initialState),
}));
