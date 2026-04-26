'use client';

import { useEffect, useRef, useState } from 'react';
import { Arrow, Label, Layer, Line, Rect, Stage, Tag, Text } from 'react-konva';
import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';

import {
  ANNOTATION_COLOR_SWATCHES,
  AnnotationColor,
  AnnotationItem,
  AnnotationTool,
  ArrowShape,
  NormalizedPoint,
  RectangleShape,
  TextNote,
  clampNormalizedPoint,
  createAnnotationId,
  denormalizePoint,
  normalizePoint,
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

interface ShapeDraft {
  start: NormalizedPoint;
  end: NormalizedPoint;
}

function getStrokeWidth(width: number): number {
  return Math.max(0.0025, Math.min(0.008, 2.5 / Math.max(width, 1)));
}

function getTextWidth(width: number): number {
  return Math.max(0.16, Math.min(0.32, 180 / Math.max(width, 1)));
}

function hasRenderableArea(start: NormalizedPoint, end: NormalizedPoint): boolean {
  return Math.abs(start.x - end.x) > 0.005 || Math.abs(start.y - end.y) > 0.005;
}

export function AnnotationStage({
  width,
  height,
  items,
  activeItems,
  activeTool,
  activeColor,
  isEditMode,
  onCommitActiveItems,
}: AnnotationStageProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const [penDraft, setPenDraft] = useState<PenDraft | null>(null);
  const [shapeDraft, setShapeDraft] = useState<ShapeDraft | null>(null);
  const [draftTextEditor, setDraftTextEditor] = useState<DraftTextEditor | null>(null);

  useEffect(() => {
    if (draftTextEditor && textAreaRef.current) {
      textAreaRef.current.focus();
    }
  }, [draftTextEditor]);

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
    if (!isEditMode || !activeTool || activeTool === 'eraser' || activeTool === 'text') {
      return;
    }

    if (window.TouchEvent && event.evt instanceof TouchEvent && event.evt.touches.length > 1) {
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

    if (activeTool === 'pen') {
      setPenDraft({ points: [point] });
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

    if (activeTool === 'pen' && penDraft) {
      if (penDraft.points.length > 1) {
        commitItems([
          ...activeItems,
          {
            id: createAnnotationId(),
            type: 'pen',
            color: activeColor,
            points: penDraft.points,
            strokeWidth: getStrokeWidth(width),
          },
        ]);
      }

      setPenDraft(null);
    }

    if ((activeTool === 'arrow' || activeTool === 'rectangle') && shapeDraft) {
      if (hasRenderableArea(shapeDraft.start, shapeDraft.end)) {
        const nextItem: ArrowShape | RectangleShape = activeTool === 'arrow'
          ? {
              id: createAnnotationId(),
              type: 'arrow',
              color: activeColor,
              start: shapeDraft.start,
              end: shapeDraft.end,
              strokeWidth: getStrokeWidth(width),
            }
          : {
              id: createAnnotationId(),
              type: 'rectangle',
              color: activeColor,
              start: shapeDraft.start,
              end: shapeDraft.end,
              strokeWidth: getStrokeWidth(width),
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
    const color = ANNOTATION_COLOR_SWATCHES[entry.item.color];
    const isErasable = isEditMode && activeTool === 'eraser' && entry.isActiveLayer;
    const commonProps = {
      listening: isErasable,
      onClick: isErasable ? () => deleteActiveItem(entry.item.id) : undefined,
      onTap: isErasable ? () => deleteActiveItem(entry.item.id) : undefined,
      opacity: entry.isActiveLayer ? 1 : 0.82,
    };

    if (entry.item.type === 'pen') {
      return (
        <Line
          key={entry.item.id}
          {...commonProps}
          points={entry.item.points.flatMap((point) => {
            const pixelPoint = denormalizePoint(point, width, height);
            return [pixelPoint.x, pixelPoint.y];
          })}
          stroke={color}
          strokeWidth={Math.max(entry.item.strokeWidth * width, 2)}
          lineCap="round"
          lineJoin="round"
          tension={0.2}
          hitStrokeWidth={18}
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
          strokeWidth={Math.max(entry.item.strokeWidth * width, 2)}
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
          strokeWidth={Math.max(entry.item.strokeWidth * width, 2)}
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

  const draftColor = ANNOTATION_COLOR_SWATCHES[activeColor];
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
    <div className="absolute inset-0 z-10 overflow-hidden rounded-[12px]">
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        style={{
          width,
          height,
          cursor: stageCursor,
          pointerEvents: isEditMode ? 'auto' : 'none',
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
              strokeWidth={Math.max(getStrokeWidth(width) * width, 2)}
              lineCap="round"
              lineJoin="round"
              tension={0.2}
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
              strokeWidth={Math.max(getStrokeWidth(width) * width, 2)}
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
              strokeWidth={Math.max(getStrokeWidth(width) * width, 2)}
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
