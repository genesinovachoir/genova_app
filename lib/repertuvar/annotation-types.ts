export const VOICE_GROUPS = ['Soprano', 'Alto', 'Tenor', 'Bass'] as const;

export type VoiceGroup = (typeof VOICE_GROUPS)[number];
export type PreviewVoiceGroup = VoiceGroup | 'ALL';
export type AnnotationTool = 'pen' | 'highlighter' | 'arrow' | 'rectangle' | 'text' | 'eraser' | null;
export type LegacyAnnotationColor = 'black' | 'red' | 'white';
export type HexAnnotationColor = `#${string}`;
export type AnnotationColor = LegacyAnnotationColor | HexAnnotationColor;
export type AnnotationLayerType = 'personal' | 'shared_voice_group' | 'shared_all';
export type AnnotationLayerKey = 'personal' | 'shared_all' | `shared_voice_group:${VoiceGroup}`;
export type AnnotationSaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface AnnotationBase {
  id: string;
  type: 'pen' | 'highlighter' | 'arrow' | 'rectangle' | 'text';
  color: AnnotationColor;
}

export interface PenStroke extends AnnotationBase {
  type: 'pen';
  points: NormalizedPoint[];
  strokeWidth: number;
}

export interface HighlighterStroke extends AnnotationBase {
  type: 'highlighter';
  points: NormalizedPoint[];
  strokeWidth: number;
}

export interface ArrowShape extends AnnotationBase {
  type: 'arrow';
  start: NormalizedPoint;
  end: NormalizedPoint;
  strokeWidth: number;
}

export interface RectangleShape extends AnnotationBase {
  type: 'rectangle';
  start: NormalizedPoint;
  end: NormalizedPoint;
  strokeWidth: number;
}

export interface TextNote extends AnnotationBase {
  type: 'text';
  position: NormalizedPoint;
  text: string;
  width: number;
}

export type AnnotationItem = PenStroke | HighlighterStroke | ArrowShape | RectangleShape | TextNote;

export interface AnnotationContextDescriptor {
  fileId: string;
  pageNumber: number;
  layerKey: AnnotationLayerKey;
}

export interface LayerVisibility {
  personal: boolean;
  shared: boolean;
}

export const DEFAULT_ANNOTATION_COLOR: LegacyAnnotationColor = 'red';
export const DEFAULT_HIGHLIGHTER_COLOR: HexAnnotationColor = '#facc15';
export const DEFAULT_ANNOTATION_STROKE_WIDTH_PX = 3;
export const DEFAULT_HIGHLIGHTER_STROKE_WIDTH_PX = 10;
export const MIN_ANNOTATION_STROKE_WIDTH_PX = 1;
export const MAX_ANNOTATION_STROKE_WIDTH_PX = 14;
export const LEGACY_ANNOTATION_COLORS: LegacyAnnotationColor[] = ['black', 'red', 'white'];

export const ANNOTATION_COLOR_SWATCHES: Record<LegacyAnnotationColor, string> = {
  black: '#111111',
  red: '#ef4444',
  white: '#f8fafc',
};

export const ANNOTATION_COLOR_PRESETS: Array<{ color: AnnotationColor; label: string }> = [
  { color: 'black', label: 'Siyah' },
  { color: 'red', label: 'Kırmızı' },
  { color: 'white', label: 'Beyaz' },
  { color: DEFAULT_HIGHLIGHTER_COLOR, label: 'Sarı' },
  { color: '#22c55e', label: 'Yeşil' },
  { color: '#38bdf8', label: 'Mavi' },
  { color: '#f97316', label: 'Turuncu' },
];

const HEX_ANNOTATION_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isHexAnnotationColor(value: string): value is HexAnnotationColor {
  return HEX_ANNOTATION_COLOR_PATTERN.test(value);
}

export function resolveAnnotationColor(color: AnnotationColor | string | null | undefined): string {
  if (color === 'black' || color === 'red' || color === 'white') {
    return ANNOTATION_COLOR_SWATCHES[color];
  }

  if (color && isHexAnnotationColor(color)) {
    return color;
  }

  return ANNOTATION_COLOR_SWATCHES[DEFAULT_ANNOTATION_COLOR];
}

export function clampAnnotationStrokeWidthPx(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_ANNOTATION_STROKE_WIDTH_PX;
  }

  return Math.min(
    MAX_ANNOTATION_STROKE_WIDTH_PX,
    Math.max(MIN_ANNOTATION_STROKE_WIDTH_PX, Math.round(value)),
  );
}

export function asVoiceGroup(value: string | null | undefined): VoiceGroup | null {
  if (!value) return null;
  return VOICE_GROUPS.includes(value as VoiceGroup) ? (value as VoiceGroup) : null;
}

export function makeSharedVoiceGroupLayerKey(voiceGroup: VoiceGroup): AnnotationLayerKey {
  return `shared_voice_group:${voiceGroup}`;
}

export function parseLayerKey(layerKey: AnnotationLayerKey): {
  layerType: AnnotationLayerType;
  targetVoiceGroup: VoiceGroup | null;
} {
  if (layerKey === 'personal') {
    return { layerType: 'personal', targetVoiceGroup: null };
  }

  if (layerKey === 'shared_all') {
    return { layerType: 'shared_all', targetVoiceGroup: null };
  }

  return {
    layerType: 'shared_voice_group',
    targetVoiceGroup: layerKey.replace('shared_voice_group:', '') as VoiceGroup,
  };
}

export function getLayerLabel(layerKey: AnnotationLayerKey): string {
  if (layerKey === 'personal') return 'SİZ';
  if (layerKey === 'shared_all') return 'Ortak';
  const group = layerKey.replace('shared_voice_group:', '');
  if (group === 'Soprano') return 'SOP';
  if (group === 'Alto') return 'ALT';
  if (group === 'Tenor') return 'TEN';
  if (group === 'Bass') return 'BAS';
  return group;
}

export function getPreviewVoiceGroupLabel(value: PreviewVoiceGroup): string {
  if (value === 'ALL') return 'Tüm Partisyonlar';
  if (value === 'Soprano') return 'SOP';
  if (value === 'Alto') return 'ALT';
  if (value === 'Tenor') return 'TEN';
  if (value === 'Bass') return 'BAS';
  return value;
}

export function makeLayerPageKey({ fileId, pageNumber, layerKey }: AnnotationContextDescriptor): string {
  return `${fileId}::${pageNumber}::${layerKey}`;
}

export function parseLayerPageKey(layerPageKey: string): AnnotationContextDescriptor {
  const [fileId, pageNumber, ...layerParts] = layerPageKey.split('::');

  return {
    fileId,
    pageNumber: Number(pageNumber),
    layerKey: layerParts.join('::') as AnnotationLayerKey,
  };
}

export function clampNormalizedPoint(point: NormalizedPoint): NormalizedPoint {
  return {
    x: Math.max(0, Math.min(1, point.x)),
    y: Math.max(0, Math.min(1, point.y)),
  };
}

export function normalizePoint(x: number, y: number, width: number, height: number): NormalizedPoint {
  return clampNormalizedPoint({
    x: width > 0 ? x / width : 0,
    y: height > 0 ? y / height : 0,
  });
}

export function denormalizePoint(point: NormalizedPoint, width: number, height: number): { x: number; y: number } {
  return {
    x: point.x * width,
    y: point.y * height,
  };
}

export function createAnnotationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `annotation_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function cloneAnnotationItem(item: AnnotationItem): AnnotationItem {
  switch (item.type) {
    case 'pen':
    case 'highlighter':
      return {
        ...item,
        points: item.points.map((point) => ({ ...point })),
      };
    case 'arrow':
    case 'rectangle':
      return {
        ...item,
        start: { ...item.start },
        end: { ...item.end },
      };
    case 'text':
      return {
        ...item,
        position: { ...item.position },
      };
  }
}

export function cloneAnnotationItems(items: AnnotationItem[]): AnnotationItem[] {
  return items.map(cloneAnnotationItem);
}
