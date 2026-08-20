import { api } from '../platform/browser';
import { QueueManager } from '../queue/queue-manager';
import { BACKEND_URL } from '../config/backend';
import { defaultFieldMapping } from '../config/field-mapping';
import { readSalesOfficerInPage } from '../automation/sales-officer';
import type {
  ContentToBackgroundMessage,
  EntryRecord,
  FillEntryMessage,
  FillResultMessage,
  PopupQueueMessage,
  PopupToBackgroundMessage,
  QueueState,
  ReadyToSubmitMessage,
  SalesOfficerResult,
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

// Any POMS page, not just the DDS form: the Sales Officer box is read by
// injection rather than by messaging the content script, so it works on tabs
// the content script never attached to.
const POMS_TAB_URL = 'https://my.ptcl.net.pk/*';

/**
 * Tabs worth checking for the Sales Officer box, active tab first (that's
 * the one the user is looking at while the popup is open, and the one we'd
 * drive), then any other open POMS tab.
 */
async function candidateTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs: chrome.tabs.Tab[] = [];

  const [activeTab] = await api.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id !== undefined) tabs.push(activeTab);

  for (const tab of await api.tabs.query({ url: POMS_TAB_URL })) {
    if (tab.id !== undefined && !tabs.some((known) => known.id === tab.id)) tabs.push(tab);
  }

  return tabs;
}

/** Result of hunting for the Sales Officer value, plus the tab it was found in. */
interface SalesOfficerLookup extends SalesOfficerResult {
  tabId: number | null;
}

/**
 * Injects the reader into every frame of each candidate tab and takes the
 * first non-empty value. The tab it came from is the tab we should drive -
 * it is by definition the one showing the logged-in DDS form.
 */
async function lookupSalesOfficer(): Promise<SalesOfficerLookup> {
  const tabs = await candidateTabs();
  const checked: string[] = [];

  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const label = tab.url ?? `tab ${tab.id}`;

    let results: (string | null | undefined)[];
    try {
      results = await api.scripting.executeScript(tab.id, readSalesOfficerInPage, [
        defaultFieldMapping.salesOfficer,
      ]);
    } catch {
      // Not a page we're allowed to inject into (chrome://, another site,
      // the extension's own pages) - nothing to report, just move on.
      continue;
    }

    const found = results.find((value): value is string => typeof value === 'string' && value.length > 0);
    if (found) {
      return { salesOfficer: found, tabUrl: tab.url ?? null, tabId: tab.id, error: null };
    }
    checked.push(label);
  }

  const where = checked.length > 0 ? ` Checked: ${checked.slice(0, 2).join(', ')}` : '';
  return {
    salesOfficer: null,
    tabUrl: null,
    tabId: null,
    error: `Could not read the Sales Officer box. Open the DDS New Customer page in a tab and log into POMS, then try again.${where}`,
  };
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

async function handleStart(total: number, mode: 'auto' | 'manual'): Promise<QueueState> {
  const qm = await getQueueManager();

  // Read the username fresh here rather than trusting whatever the popup
  // last displayed - the user may have switched tabs or logged in as someone
  // else since then, and this value authorizes the whole run.
  const lookup = await lookupSalesOfficer();
  if (!lookup.salesOfficer || lookup.tabId === null) {
    return qm.reportError(lookup.error ?? 'Could not read the Sales Officer box.');
  }

  let entries: EntryRecord[];
  try {
    entries = await fetchEntries(lookup.salesOfficer, total);
  } catch (err) {
    return qm.reportError(err instanceof Error ? err.message : String(err));
  }

  await qm.start(mode, lookup.salesOfficer, entries, lookup.tabId);
  await sendFillEntry(lookup.tabId, qm);
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

async function handleDetectSalesOfficer(): Promise<SalesOfficerResult> {
  const { salesOfficer, tabUrl, error } = await lookupSalesOfficer();
  return { salesOfficer, tabUrl, error };
}

async function handlePopupMessage(message: PopupQueueMessage): Promise<QueueState> {
  const qm = await getQueueManager();

  switch (message.type) {
    case 'START':
      return handleStart(message.total, message.mode);
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
      case 'DETECT_SALES_OFFICER':
        // The one popup message answered with something other than a QueueState.
        handleDetectSalesOfficer().then(sendResponse);
        return true;
      default:
        // Popup messages expect a QueueState response.
        handlePopupMessage(message).then(sendResponse);
        return true; // keep the message channel open for the async response
    }
  }
);
