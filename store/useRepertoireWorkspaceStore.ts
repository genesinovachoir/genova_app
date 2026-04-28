import { create } from 'zustand';

import {
  AnnotationColor,
  AnnotationItem,
  AnnotationLayerKey,
  AnnotationSaveState,
  AnnotationTool,
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_ANNOTATION_STROKE_WIDTH_PX,
  LayerVisibility,
  PreviewVoiceGroup,
  clampAnnotationStrokeWidthPx,
  cloneAnnotationItems,
} from '@/lib/repertuvar/annotation-types';

type HistoryState = Record<string, AnnotationItem[][]>;
type LayerState = Record<string, AnnotationItem[]>;

interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

interface RepertoireWorkspaceState {
  selectedPdfId: string | null;
  selectedAudioId: string | null;
  currentPage: number;
  totalPages: number;
  isEditMode: boolean;
  activeLayerKey: AnnotationLayerKey;
  previewVoiceGroup: PreviewVoiceGroup;
  activeTool: AnnotationTool;
  activeColor: AnnotationColor;
  activeStrokeWidthPx: number;
  visibility: LayerVisibility;
  layersByPage: LayerState;
  historyByLayerPage: HistoryState;
  futureByLayerPage: HistoryState;
  saveState: AnnotationSaveState;
  saveError: string | null;
  annotationLoading: boolean;
  annotationError: string | null;
  documentError: string | null;
  pageAspectRatio: number | null;
  audioState: AudioState;
  setSelectedPdfId: (value: string | null) => void;
  setSelectedAudioId: (value: string | null) => void;
  setCurrentPage: (value: number) => void;
  setTotalPages: (value: number) => void;
  setEditMode: (value: boolean) => void;
  setActiveLayerKey: (value: AnnotationLayerKey) => void;
  setPreviewVoiceGroup: (value: PreviewVoiceGroup) => void;
  setActiveTool: (value: AnnotationTool) => void;
  setActiveColor: (value: AnnotationColor) => void;
  setActiveStrokeWidthPx: (value: number) => void;
  toggleVisibility: (key: keyof LayerVisibility) => void;
  replaceFileLayers: (fileId: string, layers: LayerState) => void;
  setLayerItems: (layerPageKey: string, items: AnnotationItem[]) => void;
  commitLayerItems: (layerPageKey: string, items: AnnotationItem[]) => void;
  undoLayer: (layerPageKey: string) => void;
  redoLayer: (layerPageKey: string) => void;
  clearLayerHistory: (layerPageKey: string) => void;
  setSaveState: (value: AnnotationSaveState, error?: string | null) => void;
  setAnnotationLoading: (value: boolean) => void;
  setAnnotationError: (value: string | null) => void;
  setDocumentError: (value: string | null) => void;
  setPageAspectRatio: (value: number | null) => void;
  setAudioState: (value: Partial<AudioState>) => void;
  reset: () => void;
}

const MAX_HISTORY_LENGTH = 40;

const initialAudioState: AudioState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
};

function pushHistorySnapshot(history: AnnotationItem[][], snapshot: AnnotationItem[]): AnnotationItem[][] {
  const nextHistory = [...history, cloneAnnotationItems(snapshot)];

  if (nextHistory.length > MAX_HISTORY_LENGTH) {
    return nextHistory.slice(nextHistory.length - MAX_HISTORY_LENGTH);
  }

  return nextHistory;
}

function removeFileScopedEntries<T extends Record<string, unknown>>(state: T, fileId: string): T {
  return Object.fromEntries(
    Object.entries(state).filter(([key]) => !key.startsWith(`${fileId}::`)),
  ) as T;
}

export const useRepertoireWorkspaceStore = create<RepertoireWorkspaceState>((set, get) => ({
  selectedPdfId: null,
  selectedAudioId: null,
  currentPage: 1,
  totalPages: 0,
  isEditMode: false,
  activeLayerKey: 'personal',
  previewVoiceGroup: 'ALL',
  activeTool: null,
  activeColor: DEFAULT_ANNOTATION_COLOR,
  activeStrokeWidthPx: DEFAULT_ANNOTATION_STROKE_WIDTH_PX,
  visibility: {
    personal: true,
    shared: true,
  },
  layersByPage: {},
  historyByLayerPage: {},
  futureByLayerPage: {},
  saveState: 'idle',
  saveError: null,
  annotationLoading: false,
  annotationError: null,
  documentError: null,
  pageAspectRatio: null,
  audioState: initialAudioState,

  setSelectedPdfId: (selectedPdfId) => set({ selectedPdfId }),
  setSelectedAudioId: (selectedAudioId) => set({ selectedAudioId }),
  setCurrentPage: (currentPage) => set({ currentPage }),
  setTotalPages: (totalPages) => set({ totalPages }),
  setEditMode: (isEditMode) => set({ isEditMode }),
  setActiveLayerKey: (activeLayerKey) => set({ activeLayerKey }),
  setPreviewVoiceGroup: (previewVoiceGroup) => set({ previewVoiceGroup }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setActiveColor: (activeColor) => set({ activeColor }),
  setActiveStrokeWidthPx: (activeStrokeWidthPx) =>
    set({ activeStrokeWidthPx: clampAnnotationStrokeWidthPx(activeStrokeWidthPx) }),
  toggleVisibility: (key) =>
    set((state) => ({
      visibility: {
        ...state.visibility,
        [key]: !state.visibility[key],
      },
    })),

  replaceFileLayers: (fileId, layers) =>
    set((state) => ({
      layersByPage: {
        ...removeFileScopedEntries(state.layersByPage, fileId),
        ...Object.fromEntries(
          Object.entries(layers).map(([key, value]) => [key, cloneAnnotationItems(value)]),
        ),
      },
      historyByLayerPage: removeFileScopedEntries(state.historyByLayerPage, fileId),
      futureByLayerPage: removeFileScopedEntries(state.futureByLayerPage, fileId),
    })),

  setLayerItems: (layerPageKey, items) =>
    set((state) => ({
      layersByPage: {
        ...state.layersByPage,
        [layerPageKey]: cloneAnnotationItems(items),
      },
    })),

  commitLayerItems: (layerPageKey, items) =>
    set((state) => {
      const previousItems = state.layersByPage[layerPageKey] ?? [];
      const nextHistory = pushHistorySnapshot(
        state.historyByLayerPage[layerPageKey] ?? [],
        previousItems,
      );

      return {
        layersByPage: {
          ...state.layersByPage,
          [layerPageKey]: cloneAnnotationItems(items),
        },
        historyByLayerPage: {
          ...state.historyByLayerPage,
          [layerPageKey]: nextHistory,
        },
        futureByLayerPage: {
          ...state.futureByLayerPage,
          [layerPageKey]: [],
        },
      };
    }),

  undoLayer: (layerPageKey) =>
    set((state) => {
      const history = state.historyByLayerPage[layerPageKey] ?? [];

      if (history.length === 0) {
        return state;
      }

      const previousSnapshot = history[history.length - 1];
      const currentItems = state.layersByPage[layerPageKey] ?? [];

      return {
        layersByPage: {
          ...state.layersByPage,
          [layerPageKey]: cloneAnnotationItems(previousSnapshot),
        },
        historyByLayerPage: {
          ...state.historyByLayerPage,
          [layerPageKey]: history.slice(0, -1),
        },
        futureByLayerPage: {
          ...state.futureByLayerPage,
          [layerPageKey]: [
            cloneAnnotationItems(currentItems),
            ...(state.futureByLayerPage[layerPageKey] ?? []),
          ],
        },
      };
    }),

  redoLayer: (layerPageKey) =>
    set((state) => {
      const future = state.futureByLayerPage[layerPageKey] ?? [];

      if (future.length === 0) {
        return state;
      }

      const [nextSnapshot, ...restFuture] = future;
      const currentItems = state.layersByPage[layerPageKey] ?? [];

      return {
        layersByPage: {
          ...state.layersByPage,
          [layerPageKey]: cloneAnnotationItems(nextSnapshot),
        },
        historyByLayerPage: {
          ...state.historyByLayerPage,
          [layerPageKey]: pushHistorySnapshot(
            state.historyByLayerPage[layerPageKey] ?? [],
            currentItems,
          ),
        },
        futureByLayerPage: {
          ...state.futureByLayerPage,
          [layerPageKey]: restFuture,
        },
      };
    }),

  clearLayerHistory: (layerPageKey) =>
    set((state) => ({
      historyByLayerPage: {
        ...state.historyByLayerPage,
        [layerPageKey]: [],
      },
      futureByLayerPage: {
        ...state.futureByLayerPage,
        [layerPageKey]: [],
      },
    })),

  setSaveState: (saveState, saveError = null) => set({ saveState, saveError }),
  setAnnotationLoading: (annotationLoading) => set({ annotationLoading }),
  setAnnotationError: (annotationError) => set({ annotationError }),
  setDocumentError: (documentError) => set({ documentError }),
  setPageAspectRatio: (pageAspectRatio) => set({ pageAspectRatio }),
  setAudioState: (value) =>
    set((state) => ({
      audioState: {
        ...state.audioState,
        ...value,
      },
    })),

  reset: () =>
    set({
      selectedPdfId: null,
      selectedAudioId: null,
      currentPage: 1,
      totalPages: 0,
      isEditMode: false,
      activeLayerKey: 'personal',
      previewVoiceGroup: 'ALL',
      activeTool: null,
      activeColor: DEFAULT_ANNOTATION_COLOR,
      activeStrokeWidthPx: DEFAULT_ANNOTATION_STROKE_WIDTH_PX,
      visibility: {
        personal: true,
        shared: true,
      },
      layersByPage: {},
      historyByLayerPage: {},
      futureByLayerPage: {},
      saveState: 'idle',
      saveError: null,
      annotationLoading: false,
      annotationError: null,
      documentError: null,
      pageAspectRatio: null,
      audioState: initialAudioState,
    }),
}));

export function getLayerItemsFromStore(layerPageKey: string): AnnotationItem[] {
  return useRepertoireWorkspaceStore.getState().layersByPage[layerPageKey] ?? [];
}
