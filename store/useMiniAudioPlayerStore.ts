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
  reset: () => void;
}

const initialState = {
  isActive: false,
  songId: null,
  songTitle: '',
  coverSource: null,
  tracks: [] as MiniAudioTrack[],
  currentTrackId: null,
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  playbackRate: 1,
};

export const useMiniAudioPlayerStore = create<MiniAudioPlayerState>((set) => ({
  ...initialState,
  setSession: (payload) =>
    set({
      ...payload,
      isActive: true,
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
  setActive: (isActive) => set({ isActive }),
  reset: () => set(initialState),
}));
