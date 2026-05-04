import { beforeEach, describe, expect, it } from 'vitest';

import { useRepertoireWorkspaceStore } from '@/store/useRepertoireWorkspaceStore';
import { makeLayerPageKey, type AnnotationItem } from '@/lib/repertuvar/annotation-types';

const layerPageKey = makeLayerPageKey({
  fileId: 'file-1',
  pageNumber: 1,
  layerKey: 'personal',
});

function makePenItem(id: string): AnnotationItem {
  return {
    id,
    type: 'pen',
    color: 'red',
    strokeWidth: 0.01,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ],
  };
}

describe('useRepertoireWorkspaceStore annotation history', () => {
  beforeEach(() => {
    useRepertoireWorkspaceStore.getState().reset();
  });

  it('restores annotations when clearing a page is undone', () => {
    const originalItems = [makePenItem('a'), makePenItem('b')];
    const store = useRepertoireWorkspaceStore.getState();

    store.setLayerItems(layerPageKey, originalItems);
    useRepertoireWorkspaceStore.getState().commitLayerItems(layerPageKey, []);

    expect(useRepertoireWorkspaceStore.getState().layersByPage[layerPageKey]).toEqual([]);

    useRepertoireWorkspaceStore.getState().undoLayer(layerPageKey);

    expect(useRepertoireWorkspaceStore.getState().layersByPage[layerPageKey]).toEqual(originalItems);
  });

  it('keeps a long enough bounded undo history', () => {
    for (let index = 0; index < 45; index += 1) {
      useRepertoireWorkspaceStore.getState().commitLayerItems(layerPageKey, [makePenItem(String(index))]);
    }

    expect(useRepertoireWorkspaceStore.getState().historyByLayerPage[layerPageKey]).toHaveLength(40);
  });
});
