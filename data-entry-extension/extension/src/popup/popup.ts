import { api } from '../platform/browser';
import type {
  DetectSalesOfficerMessage,
  PopupQueueMessage,
  QueueState,
  SalesOfficerResult,
} from '../types/messages';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

const salesOfficerValue = el<HTMLParagraphElement>('sales-officer-value');
const detectBtn = el<HTMLButtonElement>('detect-username-btn');
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

async function send(message: PopupQueueMessage): Promise<QueueState> {
  return api.runtime.sendMessage<QueueState>(message);
}

// What the last detection read off the page. The background reads it again
// for real at START; this is only what the popup shows.
let detectedUsername: string | null = null;

function showSalesOfficer(value: string | null, hint?: string): void {
  salesOfficerValue.textContent = value ?? 'Not found';
  salesOfficerValue.classList.toggle('unresolved', value === null);
  if (hint) usernameHint.textContent = hint;
}

/**
 * Asks the background to read the page's Sales Officer box. It injects a
 * reader into every frame of the active tab (then any other open POMS tab),
 * so this works even on a tab the content script never attached to.
 */
async function detectSalesOfficer(): Promise<void> {
  detectBtn.disabled = true;
  salesOfficerValue.classList.remove('unresolved');
  salesOfficerValue.textContent = 'Reading from the page...';

  const message: DetectSalesOfficerMessage = { type: 'DETECT_SALES_OFFICER' };
  try {
    const result = await api.runtime.sendMessage<SalesOfficerResult>(message);
    detectedUsername = result.salesOfficer;
    if (result.salesOfficer) {
      showSalesOfficer(result.salesOfficer, 'Read from the DDS page. Checked against the roster on Start.');
    } else {
      showSalesOfficer(null, result.error ?? 'Open the DDS New Customer page and log into POMS.');
    }
  } catch (err) {
    detectedUsername = null;
    showSalesOfficer(null, err instanceof Error ? err.message : String(err));
  } finally {
    detectBtn.disabled = false;
  }
}

function render(state: QueueState): void {
  const isIdle = state.runState === 'idle';
  const isRunning = state.runState === 'running';
  const isPaused = state.runState === 'paused';
  const isFinished = state.runState === 'completed' || state.runState === 'stopped';
  const hasFailure = state.entryStatus === 'failed';

  // While a run is in flight, the username that run started with is the
  // truth. Otherwise show whatever the latest page read found, falling back
  // to the last run's value.
  const inFlight = isRunning || isPaused;
  const shown = inFlight ? state.ptclUsername : detectedUsername ?? state.ptclUsername;
  if (shown) showSalesOfficer(shown);

  // Editable whenever a new run could be started: never started yet, or the
  // previous one stopped/completed. Only locked while actually running/paused.
  const canEditSetup = isIdle || isFinished;
  setupSection.style.opacity = canEditSetup ? '1' : '0.5';
  detectBtn.disabled = !canEditSetup;
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
    // A Start attempt failed (unreadable Sales Officer box, username not on
    // the roster, backend unreachable) before the queue ever started running.
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

detectBtn.addEventListener('click', () => {
  void detectSalesOfficer();
});

startBtn.addEventListener('click', async () => {
  const total = Math.max(1, Math.min(100, parseInt(entriesInput.value, 10) || 1));
  const mode = modeAuto.checked ? 'auto' : 'manual';
  // No username is sent: the background reads the Sales Officer box itself,
  // so what it authorizes with is always what the page actually says.
  const state = await send({ type: 'START', mode, total });
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

void refresh().then(detectSalesOfficer);
