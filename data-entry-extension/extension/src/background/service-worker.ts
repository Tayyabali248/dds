import { api } from '../platform/browser';
import { QueueManager } from '../queue/queue-manager';
import { BACKEND_URL } from '../config/backend';
import type {
  ContentToBackgroundMessage,
  EntryRecord,
  FillEntryMessage,
  FillResultMessage,
  PopupToBackgroundMessage,
  QueueState,
  ReadyToSubmitMessage,
  SubmissionFailedMessage,
  SubmissionSuccessMessage,
} from '../types/messages';

// MV3 service workers (and Firefox's non-persistent background page) can be
// killed and restarted at any time. Nothing here survives that except what
// QueueManager persists to storage - this module-level cache is just a
// same-lifetime convenience, never the source of truth.
let cachedManager: Promise<QueueManager> | null = null;
function getQueueManager(): Promise<QueueManager> {
  if (!cachedManager) cachedManager = QueueManager.load();
  return cachedManager;
}

async function fetchEntries(ptclUsername: string, count: number): Promise<EntryRecord[]> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}/api/dds/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ptclUsername, count }),
    });
  } catch {
    throw new Error(`Could not reach the backend at ${BACKEND_URL}. Is dds/server.js running?`);
  }

  const data = (await response.json().catch(() => ({}))) as { entries?: EntryRecord[]; error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Backend returned ${response.status}.`);
  }
  if (!data.entries || data.entries.length === 0) {
    throw new Error('Backend returned no entries.');
  }
  return data.entries;
}

async function sendFillEntry(tabId: number, qm: QueueManager): Promise<void> {
  const state = qm.getState();
  const record = qm.currentRecord();

  if (!record) {
    await qm.markFailed(`No entry data available for index ${state.currentIndex + 1}.`);
    return;
  }

  const message: FillEntryMessage = {
    type: 'FILL_ENTRY',
    entryIndex: state.currentIndex,
    record,
    mode: state.mode,
    entryStatus: state.entryStatus,
  };
  api.tabs.sendMessage(tabId, message).catch(() => {
    // Content script may not have attached yet - its own CONTENT_READY
    // announcement (fired on every load) will trigger this again.
  });
}

// --- Handlers for messages coming FROM the content script ---

async function handleContentReady(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return;
  const qm = await getQueueManager();
  await qm.setTabId(tabId);

  const state = qm.getState();
  if (state.runState !== 'running') return;

  await sendFillEntry(tabId, qm);
}

async function handleFillResult(msg: FillResultMessage): Promise<void> {
  const qm = await getQueueManager();
  const state = qm.getState();
  if (state.runState !== 'running' || msg.entryIndex !== state.currentIndex) return;

  if (!msg.success) {
    const missing = msg.missingFields?.join(', ') || 'unknown field';
    await qm.markFailed(`Field(s) not found on the page: ${missing}`);
    return;
  }

  await qm.setEntryStatus('filling', `Filling entry ${state.currentIndex + 1} of ${state.total}`);
}

async function handleReadyToSubmit(msg: ReadyToSubmitMessage): Promise<void> {
  const qm = await getQueueManager();
  const state = qm.getState();
  if (state.runState !== 'running' || msg.entryIndex !== state.currentIndex) return;

  if (state.mode === 'auto') {
    await qm.setEntryStatus('submitting', `Submitting entry ${state.currentIndex + 1} of ${state.total}`);
  } else {
    await qm.setEntryStatus(
      'waiting_manual_submit',
      `Entry ${state.currentIndex + 1} filled - click Submit yourself on the page`
    );
  }
}

async function handleSubmissionSuccess(msg: SubmissionSuccessMessage): Promise<void> {
  const qm = await getQueueManager();
  const state = qm.getState();
  if (state.runState !== 'running' || msg.entryIndex !== state.currentIndex) return;

  const newState = await qm.markSuccess();
  if (newState.runState === 'running' && newState.tabId !== null) {
    await sendFillEntry(newState.tabId, qm);
  }
}

async function handleSubmissionFailed(msg: SubmissionFailedMessage): Promise<void> {
  const qm = await getQueueManager();
  const state = qm.getState();
  if (state.runState !== 'running' || msg.entryIndex !== state.currentIndex) return;
  await qm.markFailed(msg.reason);
}

// --- Handlers for messages coming FROM the popup ---

async function handleStart(total: number, mode: 'auto' | 'manual', ptclUsername: string): Promise<QueueState> {
  const qm = await getQueueManager();

  let entries: EntryRecord[];
  try {
    entries = await fetchEntries(ptclUsername, total);
  } catch (err) {
    return qm.reportError(err instanceof Error ? err.message : String(err));
  }

  const [activeTab] = await api.tabs.query({ active: true, currentWindow: true });
  const tabId = activeTab?.id ?? null;

  await qm.start(mode, ptclUsername, entries, tabId);

  if (tabId !== null) {
    await sendFillEntry(tabId, qm);
  }
  return qm.getState();
}

async function handleRetryOrSkip(action: 'retry' | 'skip'): Promise<QueueState> {
  const qm = await getQueueManager();
  const state = action === 'retry' ? await qm.retry() : await qm.skip();

  if (state.runState === 'running' && state.tabId !== null) {
    await sendFillEntry(state.tabId, qm);
  }
  return qm.getState();
}

async function handlePopupMessage(message: PopupToBackgroundMessage): Promise<QueueState> {
  const qm = await getQueueManager();

  switch (message.type) {
    case 'START':
      return handleStart(message.total, message.mode, message.ptclUsername);
    case 'PAUSE':
      return qm.pause();
    case 'RESUME':
      return qm.resume();
    case 'STOP':
      return qm.stop();
    case 'GET_STATUS':
      return qm.getState();
    case 'RETRY_ENTRY':
      return handleRetryOrSkip('retry');
    case 'SKIP_ENTRY':
      return handleRetryOrSkip('skip');
  }
}

// --- Single message router ---

api.runtime.onMessage.addListener(
  (message: PopupToBackgroundMessage | ContentToBackgroundMessage, sender, sendResponse) => {
    const tabId = sender.tab?.id;

    switch (message.type) {
      case 'CONTENT_READY':
        void handleContentReady(tabId);
        return false;
      case 'FILL_RESULT':
        void handleFillResult(message);
        return false;
      case 'READY_TO_SUBMIT':
        void handleReadyToSubmit(message);
        return false;
      case 'SUBMISSION_SUCCESS':
        void handleSubmissionSuccess(message);
        return false;
      case 'SUBMISSION_FAILED':
        void handleSubmissionFailed(message);
        return false;
      default:
        // Popup messages expect a QueueState response.
        handlePopupMessage(message).then(sendResponse);
        return true; // keep the message channel open for the async response
    }
  }
);
