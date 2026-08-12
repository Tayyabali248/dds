import { loadQueueState, saveQueueState } from '../storage/storage';
import type { AutomationMode, EntryRecord, EntryStatus, QueueState } from '../types/messages';

function createIdleState(): QueueState {
  return {
    mode: 'manual',
    runState: 'idle',
    status: 'Idle',
    currentIndex: 0,
    total: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    lastError: null,
    entryStatus: 'pending',
    tabId: null,
    ptclUsername: '',
    entries: [],
  };
}

/**
 * Owns all queue state transitions and persists every change to storage
 * immediately. The background script is the only thing that constructs
 * this - it holds no long-lived state itself beyond one QueueManager
 * instance, which it always re-loads from storage on service-worker startup.
 */
export class QueueManager {
  private state: QueueState;

  private constructor(state: QueueState) {
    this.state = state;
  }

  static async load(): Promise<QueueManager> {
    const saved = await loadQueueState();
    return new QueueManager(saved ?? createIdleState());
  }

  getState(): QueueState {
    return { ...this.state };
  }

  isActive(): boolean {
    return this.state.runState === 'running';
  }

  async start(
    mode: AutomationMode,
    ptclUsername: string,
    entries: EntryRecord[],
    tabId: number | null
  ): Promise<QueueState> {
    this.state = {
      mode,
      runState: 'running',
      status: 'Starting...',
      currentIndex: 0,
      total: entries.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      lastError: null,
      entryStatus: 'pending',
      tabId,
      ptclUsername,
      entries,
    };
    await this.persist();
    return this.getState();
  }

  async setTabId(tabId: number | null): Promise<void> {
    this.state.tabId = tabId;
    await this.persist();
  }

  /** For failures before the queue is even running (auth/network on Start) - keeps runState as-is. */
  async reportError(reason: string): Promise<QueueState> {
    this.state.lastError = reason;
    this.state.status = reason;
    await this.persist();
    return this.getState();
  }

  currentRecord(): EntryRecord | undefined {
    return this.state.entries[this.state.currentIndex];
  }

  async pause(): Promise<QueueState> {
    if (this.state.runState === 'running') {
      this.state.runState = 'paused';
      this.state.status = 'Paused';
      await this.persist();
    }
    return this.getState();
  }

  async resume(): Promise<QueueState> {
    if (this.state.runState === 'paused') {
      this.state.runState = 'running';
      this.state.status =
        this.state.entryStatus === 'waiting_manual_submit'
          ? 'Waiting for you to click Submit'
          : 'Resumed';
      await this.persist();
    }
    return this.getState();
  }

  async stop(): Promise<QueueState> {
    this.state.runState = 'stopped';
    this.state.status = 'Stopped';
    await this.persist();
    return this.getState();
  }

  async setEntryStatus(entryStatus: EntryStatus, statusText: string): Promise<QueueState> {
    this.state.entryStatus = entryStatus;
    this.state.status = statusText;
    await this.persist();
    return this.getState();
  }

  async markSuccess(): Promise<QueueState> {
    this.state.completed += 1;
    this.state.currentIndex += 1;
    this.state.entryStatus = 'pending';
    this.state.lastError = null;
    if (this.state.currentIndex >= this.state.total) {
      this.state.runState = 'completed';
      this.state.status = 'All entries processed';
    } else {
      this.state.status = `Entry ${this.state.currentIndex} of ${this.state.total} completed`;
    }
    await this.persist();
    return this.getState();
  }

  // On failure we pause rather than continue, per spec: never silently
  // continue after an automation failure - the user must Retry or Skip.
  async markFailed(reason: string): Promise<QueueState> {
    this.state.failed += 1;
    this.state.entryStatus = 'failed';
    this.state.lastError = reason;
    this.state.runState = 'paused';
    this.state.status = `Entry ${this.state.currentIndex + 1} failed: ${reason}`;
    await this.persist();
    return this.getState();
  }

  async retry(): Promise<QueueState> {
    this.state.entryStatus = 'pending';
    this.state.lastError = null;
    this.state.runState = 'running';
    this.state.status = `Retrying entry ${this.state.currentIndex + 1}`;
    await this.persist();
    return this.getState();
  }

  async skip(): Promise<QueueState> {
    this.state.skipped += 1;
    this.state.currentIndex += 1;
    this.state.entryStatus = 'pending';
    this.state.lastError = null;
    this.state.runState = this.state.currentIndex >= this.state.total ? 'completed' : 'running';
    this.state.status =
      this.state.runState === 'completed'
        ? 'All entries processed'
        : `Skipped. Moving to entry ${this.state.currentIndex + 1}`;
    await this.persist();
    return this.getState();
  }

  private async persist(): Promise<void> {
    await saveQueueState(this.state);
  }
}
