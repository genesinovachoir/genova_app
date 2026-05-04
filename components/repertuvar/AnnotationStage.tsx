'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Arrow, Label, Layer, Line, Rect, Stage, Tag, Text } from 'react-konva';
import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';

import {
  AnnotationColor,
  AnnotationItem,
  AnnotationTool,
  ArrowShape,
  NormalizedPoint,
  RectangleShape,
  TextNote,
  clampAnnotationStrokeWidthPx,
  clampNormalizedPoint,
  createAnnotationId,
  denormalizePoint,
  normalizePoint,
  resolveAnnotationColor,
} from '@/lib/repertuvar/annotation-types';

interface VisibleAnnotationEntry {
  contextKey: string;
  item: AnnotationItem;
  isActiveLayer: boolean;
}

interface AnnotationStageProps {
  width: number;
  height: number;
  items: VisibleAnnotationEntry[];
  activeItems: AnnotationItem[];
  activeTool: AnnotationTool;
  activeColor: AnnotationColor;
  activeStrokeWidthPx: number;
  isEditMode: boolean;
  onCommitActiveItems: (items: AnnotationItem[]) => void;
}

interface DraftTextEditor {
  x: number;
  y: number;
  position: NormalizedPoint;
  value: string;
}

interface PenDraft {
  points: NormalizedPoint[];
}

interface HighlighterDraft {
  start: NormalizedPoint;
  end: NormalizedPoint;
  lockDirection: { x: number; y: number } | null;
}

interface ShapeDraft {
  start: NormalizedPoint;
  end: NormalizedPoint;
}

const HIGHLIGHTER_AXIS_SNAP_DEGREES = 12;
const HIGHLIGHTER_LOCK_DISTANCE_PX = 14;
const HIGHLIGHTER_OPACITY_ACTIVE = 0.38;
const HIGHLIGHTER_OPACITY_INACTIVE = 0.3;

function normalizeStrokeWidth(width: number, strokeWidthPx: number): number {
  return clampAnnotationStrokeWidthPx(strokeWidthPx) / Math.max(width, 1);
}

function getTextWidth(width: number): number {
  return Math.max(0.16, Math.min(0.32, 180 / Math.max(width, 1)));
}

function hasRenderableArea(start: NormalizedPoint, end: NormalizedPoint): boolean {
  return Math.abs(start.x - end.x) > 0.005 || Math.abs(start.y - end.y) > 0.005;
}

function getHighlighterLockDirection(
  start: NormalizedPoint,
  point: NormalizedPoint,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const startPx = denormalizePoint(start, width, height);
  const pointPx = denormalizePoint(point, width, height);
  const dx = pointPx.x - startPx.x;
  const dy = pointPx.y - startPx.y;
  const distance = Math.hypot(dx, dy);

  if (distance < HIGHLIGHTER_LOCK_DISTANCE_PX) {
    return null;
  }

  const angleFromHorizontal = Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI);
  const angleFromVertical = Math.atan2(Math.abs(dx), Math.abs(dy)) * (180 / Math.PI);

  if (angleFromHorizontal <= HIGHLIGHTER_AXIS_SNAP_DEGREES) {
    return { x: 1, y: 0 };
  }

  if (angleFromVertical <= HIGHLIGHTER_AXIS_SNAP_DEGREES) {
    return { x: 0, y: 1 };
  }

  return {
    x: dx / distance,
    y: dy / distance,
  };
}

function constrainPointToDirection(
  start: NormalizedPoint,
  point: NormalizedPoint,
  direction: { x: number; y: number },
  width: number,
  height: number,
): NormalizedPoint {
  const startPx = denormalizePoint(start, width, height);
  const pointPx = denormalizePoint(point, width, height);
  const dx = pointPx.x - startPx.x;
  const dy = pointPx.y - startPx.y;
  const projectedDistance = dx * direction.x + dy * direction.y;

  return clampNormalizedPoint(normalizePoint(
    startPx.x + direction.x * projectedDistance,
    startPx.y + direction.y * projectedDistance,
    width,
    height,
  ));
}

export function AnnotationStage({
  width,
  height,
  items,
  activeItems,
  activeTool,
  activeColor,
  activeStrokeWidthPx,
  isEditMode,
  onCommitActiveItems,
}: AnnotationStageProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const twoFingerRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [penDraft, setPenDraft] = useState<PenDraft | null>(null);
  const [highlighterDraft, setHighlighterDraft] = useState<HighlighterDraft | null>(null);
  const [shapeDraft, setShapeDraft] = useState<ShapeDraft | null>(null);
  const [draftTextEditor, setDraftTextEditor] = useState<DraftTextEditor | null>(null);
  const [isTwoFingerGesture, setIsTwoFingerGesture] = useState(false);

  useEffect(() => {
    if (draftTextEditor && textAreaRef.current) {
      textAreaRef.current.focus();
    }
  }, [draftTextEditor]);

  // Cancel any in-progress drawing drafts (used when switching to 2-finger gesture)
  const cancelActiveDrafts = useCallback(() => {
    setPenDraft(null);
    setHighlighterDraft(null);
    setShapeDraft(null);
  }, []);

  // Eraser drag state: track IDs of items erased during a single drag gesture
  // so we can commit them all at once (one undo entry) and show visual feedback.
  const isErasingRef = useRef(false);
  const pendingEraseIdsRef = useRef<Set<string>>(new Set());
  const [erasedDuringDragIds, setErasedDuringDragIds] = useState<Set<string>>(new Set());

  // Two-finger gesture detection: temporarily disable pointer events on the
  // annotation layer so touch events fall through to the parent container's
  // pinch-to-zoom / two-finger-pan handler.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !isEditMode) {
      return;
    }

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        // Clear any pending restore timer
        if (twoFingerRestoreTimerRef.current !== null) {
          clearTimeout(twoFingerRestoreTimerRef.current);
          twoFingerRestoreTimerRef.current = null;
        }

        cancelActiveDrafts();
        setIsTwoFingerGesture(true);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        // Small delay before re-enabling pointer events to prevent the
        // remaining single finger from accidentally starting a stroke.
        twoFingerRestoreTimerRef.current = setTimeout(() => {
          twoFingerRestoreTimerRef.current = null;
          setIsTwoFingerGesture(false);
        }, 80);
      }
    };

    wrapper.addEventListener('touchstart', handleTouchStart, { passive: true });
    wrapper.addEventListener('touchend', handleTouchEnd, { passive: true });
    wrapper.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      wrapper.removeEventListener('touchstart', handleTouchStart);
      wrapper.removeEventListener('touchend', handleTouchEnd);
      wrapper.removeEventListener('touchcancel', handleTouchEnd);

      if (twoFingerRestoreTimerRef.current !== null) {
        clearTimeout(twoFingerRestoreTimerRef.current);
        twoFingerRestoreTimerRef.current = null;
      }
    };
  }, [isEditMode, cancelActiveDrafts]);

  function getPointerPosition(stage: Konva.Stage): NormalizedPoint | null {
    const pointer = stage.getPointerPosition();

    if (!pointer) {
      return null;
    }

    return clampNormalizedPoint(normalizePoint(pointer.x, pointer.y, width, height));
  }

  function commitItems(itemsToCommit: AnnotationItem[]) {
    onCommitActiveItems(itemsToCommit);
  }

  function handlePointerStart(event: KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!isEditMode || !activeTool || activeTool === 'text') {
      return;
    }

    if (window.TouchEvent && event.evt instanceof TouchEvent && event.evt.touches.length > 1) {
      return;
    }

    const stage = event.target.getStage();

    if (!stage) {
      return;
    }

    // ── Eraser drag: initiate continuous erasing ──────────────────────────────
    if (activeTool === 'eraser') {
      isErasingRef.current = true;
      pendingEraseIdsRef.current = new Set();
      setErasedDuringDragIds(new Set());

      // Also check the start point immediately (same as moving to it)
      const pos = stage.getPointerPosition();
      if (pos) {
        const node = stage.getIntersection(pos);
        const nodeId = node?.id();
        if (nodeId && activeItems.some((item) => item.id === nodeId)) {
          pendingEraseIdsRef.current.add(nodeId);
          setErasedDuringDragIds(new Set([nodeId]));
        }
      }
      return;
    }

    const point = getPointerPosition(stage);

    if (!point) {
      return;
    }

    if (activeTool === 'pen') {
      setPenDraft({ points: [point] });
      return;
    }

    if (activeTool === 'highlighter') {
      setHighlighterDraft({
        start: point,
        end: point,
        lockDirection: null,
      });
      return;
    }

    setShapeDraft({
      start: point,
      end: point,
    });
  }

  function handlePointerMove(event: KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!isEditMode || !activeTool) {
      return;
    }

    if (window.TouchEvent && event.evt instanceof TouchEvent && event.evt.touches.length > 1) {
      return;
    }

    const stage = event.target.getStage();

    if (!stage) {
      return;
    }

    // ── Eraser drag: erase items under the pointer continuously ───────────────
    if (activeTool === 'eraser' && isErasingRef.current) {
      const pos = stage.getPointerPosition();
      if (pos) {
        const node = stage.getIntersection(pos);
        const nodeId = node?.id();
        if (
          nodeId &&
          !pendingEraseIdsRef.current.has(nodeId) &&
          activeItems.some((item) => item.id === nodeId)
        ) {
          pendingEraseIdsRef.current.add(nodeId);
          // Update state for immediate visual feedback (shape disappears)
          setErasedDuringDragIds((prev) => {
            const next = new Set(prev);
            next.add(nodeId);
            return next;
          });
        }
      }
      return;
    }

    const point = getPointerPosition(stage);

    if (!point) {
      return;
    }

    if (activeTool === 'pen' && penDraft) {
      setPenDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          points: [...current.points, point],
        };
      });
    }

    if (activeTool === 'highlighter' && highlighterDraft) {
      setHighlighterDraft((current) => {
        if (!current) {
          return current;
        }

        const lockDirection =
          current.lockDirection ??
          getHighlighterLockDirection(current.start, point, width, height);

        return {
          ...current,
          end: lockDirection
            ? constrainPointToDirection(current.start, point, lockDirection, width, height)
            : point,
          lockDirection,
        };
      });
    }

    if ((activeTool === 'arrow' || activeTool === 'rectangle') && shapeDraft) {
      setShapeDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          end: point,
        };
      });
    }
  }

  function handlePointerEnd() {
    if (!isEditMode || !activeTool) {
      return;
    }

    // ── Eraser drag: commit all erased items in one go (single undo entry) ────
    if (activeTool === 'eraser') {
      if (isErasingRef.current && pendingEraseIdsRef.current.size > 0) {
        commitItems(activeItems.filter((item) => !pendingEraseIdsRef.current.has(item.id)));
      }
      isErasingRef.current = false;
      pendingEraseIdsRef.current = new Set();
      setErasedDuringDragIds(new Set());
      return;
    }

    if (activeTool === 'pen' && penDraft) {
      if (penDraft.points.length > 1) {
        const strokeWidth = normalizeStrokeWidth(width, activeStrokeWidthPx);

        commitItems([
          ...activeItems,
          {
            id: createAnnotationId(),
            type: 'pen',
            color: activeColor,
            points: penDraft.points,
            strokeWidth,
          },
        ]);
      }

      setPenDraft(null);
    }

    if (activeTool === 'highlighter' && highlighterDraft) {
      if (hasRenderableArea(highlighterDraft.start, highlighterDraft.end)) {
        const strokeWidth = normalizeStrokeWidth(width, activeStrokeWidthPx);

        commitItems([
          ...activeItems,
          {
            id: createAnnotationId(),
            type: 'highlighter',
            color: activeColor,
            points: [highlighterDraft.start, highlighterDraft.end],
            strokeWidth,
          },
        ]);
      }

      setHighlighterDraft(null);
    }

    if ((activeTool === 'arrow' || activeTool === 'rectangle') && shapeDraft) {
      if (hasRenderableArea(shapeDraft.start, shapeDraft.end)) {
        const strokeWidth = normalizeStrokeWidth(width, activeStrokeWidthPx);
        const nextItem: ArrowShape | RectangleShape = activeTool === 'arrow'
          ? {
              id: createAnnotationId(),
              type: 'arrow',
              color: activeColor,
              start: shapeDraft.start,
              end: shapeDraft.end,
              strokeWidth,
            }
          : {
              id: createAnnotationId(),
              type: 'rectangle',
              color: activeColor,
              start: shapeDraft.start,
              end: shapeDraft.end,
              strokeWidth,
            };

        commitItems([...activeItems, nextItem]);
      }

      setShapeDraft(null);
    }
  }

  function handleStageClick(event: KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!isEditMode || activeTool !== 'text') {
      return;
    }

    const stage = event.target.getStage();

    if (!stage) {
      return;
    }

    const point = getPointerPosition(stage);

    if (!point) {
      return;
    }

    const pixelPosition = denormalizePoint(point, width, height);
    setDraftTextEditor({
      x: pixelPosition.x,
      y: pixelPosition.y,
      position: point,
      value: '',
    });
  }

  function deleteActiveItem(itemId: string) {
    commitItems(activeItems.filter((item) => item.id !== itemId));
  }

  function commitTextDraft() {
    if (!draftTextEditor) {
      return;
    }

    const text = draftTextEditor.value.trim().slice(0, 140);

    if (!text) {
      setDraftTextEditor(null);
      return;
    }

    const nextItem: TextNote = {
      id: createAnnotationId(),
      type: 'text',
      color: activeColor,
      position: draftTextEditor.position,
      text,
      width: getTextWidth(width),
    };

    commitItems([...activeItems, nextItem]);
    setDraftTextEditor(null);
  }

  function renderItem(entry: VisibleAnnotationEntry) {
    // During drag-erase, hide items already marked for deletion
    if (erasedDuringDragIds.has(entry.item.id)) {
      return null;
    }

    const color = resolveAnnotationColor(entry.item.color);
    const isErasable = isEditMode && activeTool === 'eraser' && entry.isActiveLayer;
    const commonProps = {
      id: entry.item.id,
      listening: isErasable,
      onClick: isErasable ? () => deleteActiveItem(entry.item.id) : undefined,
      onTap: isErasable ? () => deleteActiveItem(entry.item.id) : undefined,
      opacity: entry.isActiveLayer ? 1 : 0.82,
    };

    if (entry.item.type === 'pen' || entry.item.type === 'highlighter') {
      const isHighlighter = entry.item.type === 'highlighter';

      return (
        <Line
          key={entry.item.id}
          {...commonProps}
          points={entry.item.points.flatMap((point) => {
            const pixelPoint = denormalizePoint(point, width, height);
            return [pixelPoint.x, pixelPoint.y];
          })}
          stroke={color}
          strokeWidth={Math.max(entry.item.strokeWidth * width, isHighlighter ? 6 : 1)}
          opacity={isHighlighter
            ? entry.isActiveLayer
              ? HIGHLIGHTER_OPACITY_ACTIVE
              : HIGHLIGHTER_OPACITY_INACTIVE
            : commonProps.opacity}
          lineCap="round"
          lineJoin="round"
          tension={isHighlighter ? 0 : 0.2}
          hitStrokeWidth={isHighlighter ? 24 : 18}
        />
      );
    }

    if (entry.item.type === 'arrow') {
      const start = denormalizePoint(entry.item.start, width, height);
      const end = denormalizePoint(entry.item.end, width, height);

      return (
        <Arrow
          key={entry.item.id}
          {...commonProps}
          points={[start.x, start.y, end.x, end.y]}
          stroke={color}
          fill={color}
          pointerLength={10}
          pointerWidth={10}
          strokeWidth={Math.max(entry.item.strokeWidth * width, 1)}
          hitStrokeWidth={18}
        />
      );
    }

    if (entry.item.type === 'rectangle') {
      const start = denormalizePoint(entry.item.start, width, height);
      const end = denormalizePoint(entry.item.end, width, height);
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const rectWidth = Math.abs(start.x - end.x);
      const rectHeight = Math.abs(start.y - end.y);

      return (
        <Rect
          key={entry.item.id}
          {...commonProps}
          x={x}
          y={y}
          width={rectWidth}
          height={rectHeight}
          stroke={color}
          strokeWidth={Math.max(entry.item.strokeWidth * width, 1)}
          cornerRadius={6}
          hitStrokeWidth={18}
        />
      );
    }

    const position = denormalizePoint(entry.item.position, width, height);

    return (
      <Label
        key={entry.item.id}
        {...commonProps}
        x={position.x}
        y={position.y}
      >
        <Tag
          fill="rgba(15, 23, 42, 0.9)"
          stroke={color}
          strokeWidth={1}
          cornerRadius={8}
        />
        <Text
          text={entry.item.text}
          width={Math.max(entry.item.width * width, 140)}
          fill={color}
          fontSize={15}
          lineHeight={1.3}
          padding={10}
          wrap="word"
        />
      </Label>
    );
  }

  const draftColor = resolveAnnotationColor(activeColor);
  const draftStrokeWidthPx = clampAnnotationStrokeWidthPx(activeStrokeWidthPx);
  const stageCursor = !isEditMode
    ? 'default'
    : activeTool === 'eraser'
      ? 'not-allowed'
      : activeTool === 'text'
        ? 'text'
        : activeTool
          ? 'crosshair'
          : 'default';

  return (
    <div ref={wrapperRef} className="absolute inset-0 z-10 overflow-hidden rounded-[12px]">
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        style={{
          width,
          height,
          cursor: stageCursor,
          pointerEvents: isEditMode && !isTwoFingerGesture ? 'auto' : 'none',
          touchAction: isEditMode ? 'none' : 'auto',
        }}
        onMouseDown={handlePointerStart}
        onTouchStart={handlePointerStart}
        onMouseMove={handlePointerMove}
        onTouchMove={handlePointerMove}
        onMouseUp={handlePointerEnd}
        onTouchEnd={handlePointerEnd}
        onClick={handleStageClick}
        onTap={handleStageClick}
      >
        <Layer>
          {items.map(renderItem)}

          {penDraft && (
            <Line
              points={penDraft.points.flatMap((point) => {
                const pixelPoint = denormalizePoint(point, width, height);
                return [pixelPoint.x, pixelPoint.y];
              })}
              stroke={draftColor}
              strokeWidth={draftStrokeWidthPx}
              lineCap="round"
              lineJoin="round"
              tension={0.2}
            />
          )}

          {highlighterDraft && (
            <Line
              points={[
                denormalizePoint(highlighterDraft.start, width, height).x,
                denormalizePoint(highlighterDraft.start, width, height).y,
                denormalizePoint(highlighterDraft.end, width, height).x,
                denormalizePoint(highlighterDraft.end, width, height).y,
              ]}
              stroke={draftColor}
              strokeWidth={Math.max(draftStrokeWidthPx, 6)}
              opacity={HIGHLIGHTER_OPACITY_ACTIVE}
              lineCap="round"
              lineJoin="round"
              tension={0}
            />
          )}

          {shapeDraft && activeTool === 'arrow' && (
            <Arrow
              points={[
                denormalizePoint(shapeDraft.start, width, height).x,
                denormalizePoint(shapeDraft.start, width, height).y,
                denormalizePoint(shapeDraft.end, width, height).x,
                denormalizePoint(shapeDraft.end, width, height).y,
              ]}
              stroke={draftColor}
              fill={draftColor}
              pointerLength={10}
              pointerWidth={10}
              strokeWidth={draftStrokeWidthPx}
            />
          )}

          {shapeDraft && activeTool === 'rectangle' && (
            <Rect
              x={Math.min(
                denormalizePoint(shapeDraft.start, width, height).x,
                denormalizePoint(shapeDraft.end, width, height).x,
              )}
              y={Math.min(
                denormalizePoint(shapeDraft.start, width, height).y,
                denormalizePoint(shapeDraft.end, width, height).y,
              )}
              width={Math.abs(
                denormalizePoint(shapeDraft.start, width, height).x -
                  denormalizePoint(shapeDraft.end, width, height).x,
              )}
              height={Math.abs(
                denormalizePoint(shapeDraft.start, width, height).y -
                  denormalizePoint(shapeDraft.end, width, height).y,
              )}
              stroke={draftColor}
              strokeWidth={draftStrokeWidthPx}
              cornerRadius={6}
            />
          )}
        </Layer>
      </Stage>

      {draftTextEditor && (
        <div
          className="absolute z-20 w-[200px] rounded-[10px] border border-[var(--color-border-strong)] bg-[rgba(10,10,10,0.96)] p-2 shadow-[0_18px_45px_rgba(0,0,0,0.45)]"
          style={{
            left: Math.min(draftTextEditor.x, Math.max(width - 212, 8)),
            top: Math.min(draftTextEditor.y, Math.max(height - 148, 8)),
          }}
        >
          <textarea
            ref={textAreaRef}
            value={draftTextEditor.value}
            onChange={(event) =>
              setDraftTextEditor((current) => current
                ? { ...current, value: event.target.value.slice(0, 140) }
                : current)
            }
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                commitTextDraft();
              }

              if (event.key === 'Escape') {
                event.preventDefault();
                setDraftTextEditor(null);
              }
            }}
            placeholder="Kısa not..."
            className="min-h-[84px] w-full resize-none rounded-[8px] border border-[var(--color-border)] bg-white/4 px-3 py-2 text-sm text-[var(--color-text-high)] outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[0.62rem] uppercase tracking-[0.18em] text-[var(--color-text-medium)]">
              {draftTextEditor.value.length}/140
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDraftTextEditor(null)}
                className="rounded-[6px] border border-[var(--color-border)] px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-[var(--color-text-medium)]"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={commitTextDraft}
                className="rounded-[6px] border border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]"
              >
                Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
