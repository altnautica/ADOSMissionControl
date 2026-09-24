import { describe, it, expect, beforeEach, vi } from 'vitest';

let protocol: Record<string, unknown> | null = null;

vi.mock('@/stores/drone-selection', () => ({
  droneSelection: () => ({
    selectedDroneId: protocol ? 'd1' : null,
    drones: new Map(protocol ? [['d1', { protocol }]] : []),
  }),
  selectedDroneProtocol: () => protocol,
}));
vi.mock('@/lib/storage', () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

import { useRallyStore, rallyContentHash } from '@/stores/rally-store';
import { useUploadReceiptsStore, receiptFor, receiptStatus } from '@/stores/upload-receipts-store';
import { clearHistory, undoDepth, undoHistory } from '@/lib/planner-history';

const POINT = { id: 'r1', lat: 12.97, lon: 77.59, alt: 60 };

function rallyStatus() {
  return receiptStatus(receiptFor('rally', 'd1'), rallyContentHash(useRallyStore.getState().points));
}

describe('rally-store transfers', () => {
  beforeEach(() => {
    protocol = null;
    useRallyStore.setState({ points: [{ ...POINT }] });
    useUploadReceiptsStore.setState({ receipts: {} });
    clearHistory();
  });

  it('reports failure with no flight controller', async () => {
    const r = await useRallyStore.getState().uploadRallyPoints();
    expect(r.success).toBe(false);
  });

  it('reports an unsupported firmware instead of claiming success', async () => {
    protocol = {};
    expect((await useRallyStore.getState().uploadRallyPoints()).success).toBe(false);
    expect((await useRallyStore.getState().downloadRallyPoints()).success).toBe(false);
    expect(useRallyStore.getState().points).toEqual([POINT]);
  });

  it('a rejected upload is reported as failed and vouches for nothing', async () => {
    protocol = { uploadRallyPoints: vi.fn().mockResolvedValue({ success: false, message: 'Timeout' }) };
    const r = await useRallyStore.getState().uploadRallyPoints();
    expect(r).toEqual({ success: false, message: 'Timeout' });
    expect(rallyStatus()).toBe('unknown');
  });

  it('an acknowledged upload reads as on aircraft until a point moves', async () => {
    protocol = { uploadRallyPoints: vi.fn().mockResolvedValue({ success: true, message: 'ok' }) };
    expect((await useRallyStore.getState().uploadRallyPoints()).success).toBe(true);
    expect(rallyStatus()).toBe('on-aircraft');
    useRallyStore.getState().updatePoint('r1', { alt: 80 });
    expect(rallyStatus()).toBe('older-on-aircraft');
  });

  it('a failed download keeps the local points and records no undo step', async () => {
    protocol = { downloadRallyPoints: vi.fn().mockRejectedValue(new Error('Not connected')) };
    const r = await useRallyStore.getState().downloadRallyPoints();
    expect(r).toEqual({ success: false, message: 'Not connected' });
    expect(useRallyStore.getState().points).toEqual([POINT]);
    expect(undoDepth()).toBe(0);
  });

  it('a successful download is one undo step back to the local points', async () => {
    protocol = { downloadRallyPoints: vi.fn().mockResolvedValue([{ lat: 1, lon: 2, alt: 40 }]) };
    const r = await useRallyStore.getState().downloadRallyPoints();
    expect(r.success).toBe(true);
    expect(useRallyStore.getState().points).toMatchObject([{ lat: 1, lon: 2, alt: 40 }]);
    expect(rallyStatus()).toBe('on-aircraft');
    expect(undoDepth()).toBe(1);
    undoHistory();
    expect(useRallyStore.getState().points).toEqual([POINT]);
  });
});
