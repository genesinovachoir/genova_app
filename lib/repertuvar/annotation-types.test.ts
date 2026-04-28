import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ANNOTATION_STROKE_WIDTH_PX,
  MAX_ANNOTATION_STROKE_WIDTH_PX,
  MIN_ANNOTATION_STROKE_WIDTH_PX,
  clampAnnotationStrokeWidthPx,
  resolveAnnotationColor,
} from '@/lib/repertuvar/annotation-types';

describe('resolveAnnotationColor', () => {
  it('resolves legacy annotation colors', () => {
    expect(resolveAnnotationColor('red')).toBe('#ef4444');
    expect(resolveAnnotationColor('black')).toBe('#111111');
    expect(resolveAnnotationColor('white')).toBe('#f8fafc');
  });

  it('keeps valid custom hex colors and falls back for invalid values', () => {
    expect(resolveAnnotationColor('#12ABef')).toBe('#12ABef');
    expect(resolveAnnotationColor('#bad')).toBe('#ef4444');
    expect(resolveAnnotationColor('rgb(0,0,0)')).toBe('#ef4444');
  });
});

describe('clampAnnotationStrokeWidthPx', () => {
  it('clamps and rounds stroke width values', () => {
    expect(clampAnnotationStrokeWidthPx(0)).toBe(MIN_ANNOTATION_STROKE_WIDTH_PX);
    expect(clampAnnotationStrokeWidthPx(6.6)).toBe(7);
    expect(clampAnnotationStrokeWidthPx(99)).toBe(MAX_ANNOTATION_STROKE_WIDTH_PX);
    expect(clampAnnotationStrokeWidthPx(Number.NaN)).toBe(DEFAULT_ANNOTATION_STROKE_WIDTH_PX);
  });
});
