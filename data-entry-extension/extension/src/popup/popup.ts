import { api } from '../platform/browser';
import type {
  GetSalesOfficerMessage,
  PopupToBackgroundMessage,
  QueueState,
  SalesOfficerResponse,
} from '../types/messages';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

const ptclUsernameInput = el<HTMLInputElement>('ptcl-username-input');
const detectUsernameBtn = el<HTMLButtonElement>('detect-username-btn');
const usernameHint = el<HTMLParagraphElement>('username-hint');
const entriesInput = el<HTMLInputElement>('entries-input');
const modeAuto = el<HTMLInputElement>('mode-auto');
const modeManual = el<HTMLInputElement>('mode-manual');
const setupSection = el<HTMLDivElement>('setup-section');

const startBtn = el<HTMLButtonElement>('start-btn');
const pauseBtn = el<HTMLButtonElement>('pause-btn');
const resumeBtn = el<HTMLButtonElement>('resume-btn');
const stopBtn = el<HTMLButtonElement>('stop-btn');

const progressCurrent = el<HTMLSpanElement>('progress-current');
const progressTotal = el<HTMLSpanElement>('progress-total');
const statCompleted = el<HTMLSpanElement>('stat-completed');
const statFailed = el<HTMLSpanElement>('stat-failed');
const statSkipped = el<HTMLSpanElement>('stat-skipped');
const statusLine = el<HTMLParagraphElement>('status-line');

const errorSection = el<HTMLDivElement>('error-section');
const errorText = el<HTMLParagraphElement>('error-text');
const retryBtn = el<HTMLButtonElement>('retry-btn');
const skipBtn = el<HTMLButtonElement>('skip-btn');

async function send(message: PopupToBackgroundMessage): Promise<QueueState> {
  return api.runtime.sendMessage<QueueState>(message);
}

let lastRenderedUsername = '';
// Set once the username came from somewhere the 1s poll must not overwrite:
// the page's Sales Officer field, or the user's own typing.
let usernamePinned = false;

const POMS_FORM_URL = 'https://my.ptcl.net.pk/POMS/DDSNewCustomer.aspx*';

/**
 * Asks the content script for the value of the page's own (disabled) Sales
 * Officer box - POMS puts the logged-in user's PTCL username there, so
 * there's no reason to make anyone type it. Tries the active tab first, then
 * any other open DDS form tab. Returns null when no such tab is open, the
 * content script isn't attached yet, or the box is empty.
 */
async function readSalesOfficerFromPage(): Promise<string | null> {
  const message: GetSalesOfficerMessage = { type: 'GET_SALES_OFFICER' };
  const tabIds: number[] = [];

  const [activeTab] = await api.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id !== undefined) tabIds.push(activeTab.id);
  for (const tab of await api.tabs.query({ url: POMS_FORM_URL })) {
    if (tab.id !== undefined && !tabIds.includes(tab.id)) tabIds.push(tab.id);
  }

  for (const tabId of tabIds) {
    try {
      const reply = await api.tabs.sendMessage<SalesOfficerResponse>(tabId, message);
      if (reply?.salesOfficer) return reply.salesOfficer;
    } catch {
      // No content script on that tab (not the DDS form) - try the next one.
    }
  }
  return null;
}

/** `manual` = the user clicked the button, so say something either way. */
async function prefillUsernameFromPage(manual: boolean): Promise<void> {
  if (!manual && ptclUsernameInput.value.trim()) return;

  const officer = await readSalesOfficerFromPage();
  if (!officer) {
    if (manual) {
      usernameHint.textContent =
        'Sales Officer field not readable - open the DDS New Customer page in a tab, or type the username.';
    }
    return;
  }
  // The user may have started typing while we were asking the page.
  if (!manual && ptclUsernameInput.value.trim()) return;

  ptclUsernameInput.value = officer;
  usernamePinned = true;
  usernameHint.textContent = 'Read from the page\'s Sales Officer field.';
}

function render(state: QueueState): void {
  const isIdle = state.runState === 'idle';
  const isRunning = state.runState === 'running';
  const isPaused = state.runState === 'paused';
  const isFinished = state.runState === 'completed' || state.runState === 'stopped';
  const hasFailure = state.entryStatus === 'failed';

  // Only overwrite what the user's typing if we haven't already reflected
  // this run's username (avoids clobbering input while they're editing it
  // before Start has been pressed), and never once it's pinned - a value the
  // user typed or that we read off the page beats a stale saved one.
  if (!usernamePinned && state.ptclUsername && state.ptclUsername !== lastRenderedUsername) {
    ptclUsernameInput.value = state.ptclUsername;
    lastRenderedUsername = state.ptclUsername;
  }

  // Editable whenever a new run could be started: never started yet, or the
  // previous one stopped/completed. Only locked while actually running/paused.
  const canEditSetup = isIdle || isFinished;
  setupSection.style.opacity = canEditSetup ? '1' : '0.5';
  ptclUsernameInput.disabled = !canEditSetup;
  detectUsernameBtn.disabled = !canEditSetup;
  entriesInput.disabled = !canEditSetup;
  modeAuto.disabled = !canEditSetup;
  modeManual.disabled = !canEditSetup;

  startBtn.disabled = !canEditSetup;
  pauseBtn.disabled = !isRunning;
  resumeBtn.disabled = !isPaused || hasFailure;
  stopBtn.disabled = isIdle;

  progressCurrent.textContent = String(state.currentIndex >= state.total ? state.total : state.currentIndex);
  progressTotal.textContent = String(state.total);
  statCompleted.textContent = String(state.completed);
  statFailed.textContent = String(state.failed);
  statSkipped.textContent = String(state.skipped);
  statusLine.textContent = state.status;

  // Retry/Skip only make sense for a failed entry mid-run - a "couldn't
  // start" error (bad username, backend unreachable) has no entry to act on.
  retryBtn.classList.toggle('hidden', !hasFailure);
  skipBtn.classList.toggle('hidden', !hasFailure);

  if (hasFailure && state.lastError) {
    errorSection.classList.remove('hidden');
    errorText.textContent = `Entry ${state.currentIndex + 1} failed: ${state.lastError}`;
  } else if (isIdle && state.lastError) {
    // A Start attempt failed (bad username / backend unreachable) before the
    // queue ever started running.
    errorSection.classList.remove('hidden');
    errorText.textContent = state.lastError;
  } else {
    errorSection.classList.add('hidden');
  }
}

async function refresh(): Promise<void> {
  const state = await send({ type: 'GET_STATUS' });
  render(state);
}

ptclUsernameInput.addEventListener('input', () => {
  usernamePinned = true;
});

detectUsernameBtn.addEventListener('click', () => {
  void prefillUsernameFromPage(true);
});

startBtn.addEventListener('click', async () => {
  const ptclUsername = ptclUsernameInput.value.trim();
  if (!ptclUsername) {
    errorSection.classList.remove('hidden');
    errorText.textContent = 'Enter your PTCL username first.';
    return;
  }
  const total = Math.max(1, Math.min(100, parseInt(entriesInput.value, 10) || 1));
  const mode = modeAuto.checked ? 'auto' : 'manual';
  const state = await send({ type: 'START', mode, total, ptclUsername });
  render(state);
});

pauseBtn.addEventListener('click', async () => {
  render(await send({ type: 'PAUSE' }));
});

resumeBtn.addEventListener('click', async () => {
  render(await send({ type: 'RESUME' }));
});

stopBtn.addEventListener('click', async () => {
  if (!confirm('Stop the current run? Progress so far is kept, but the queue will stop.')) return;
  render(await send({ type: 'STOP' }));
});

retryBtn.addEventListener('click', async () => {
  render(await send({ type: 'RETRY_ENTRY' }));
});

skipBtn.addEventListener('click', async () => {
  render(await send({ type: 'SKIP_ENTRY' }));
});

// Keep the popup live while it's open (e.g. content script reports success
// in the background while the user is watching). Once closed, this stops -
// the background keeps running the queue regardless.
const pollTimer = setInterval(refresh, 1000);
window.addEventListener('unload', () => clearInterval(pollTimer));

// First paint from saved state, then - if that left the username blank (very
// first use) - read it off the DDS page so nobody has to type it.
void refresh().then(() => prefillUsernameFromPage(false));
