import { api } from '../platform/browser';
import type { QueueState } from '../types/messages';

// Everything the background needs to fully recover after a service-worker
// restart or browser restart lives here - never only in memory.
const QUEUE_STATE_KEY = 'dds_queue_state';

export async function loadQueueState(): Promise<QueueState | null> {
  const result = await api.storage.get<{ [QUEUE_STATE_KEY]: QueueState }>([QUEUE_STATE_KEY]);
  return result[QUEUE_STATE_KEY] ?? null;
}

export async function saveQueueState(state: QueueState): Promise<void> {
  await api.storage.set({ [QUEUE_STATE_KEY]: state });
}
