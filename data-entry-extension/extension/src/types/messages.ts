// Central message contract for Popup <-> Background <-> Content Script.
// Every message has a `type` discriminant so handlers can switch on it.

// Matches exactly what the backend's buildEntry() returns
// (dds/lib/data.js) - the extension never generates data itself.
export interface EntryRecord {
  name: string;
  address: string;
  contact: string;
  email: string;
  lat: string;
  lng: string;
  exchange: string;
  region: string;
  competition: string;
}

export type AutomationMode = 'auto' | 'manual';

export type RunState = 'idle' | 'running' | 'paused' | 'stopped' | 'completed';

export type EntryStatus =
  | 'pending'
  | 'filling'
  | 'waiting_manual_submit'
  | 'submitting'
  | 'failed';

export interface QueueState {
  mode: AutomationMode;
  runState: RunState;
  status: string; // human-readable line for the popup
  currentIndex: number; // 0-based index into `entries`
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  lastError: string | null;
  entryStatus: EntryStatus;
  /** Tab the automation is currently driving, so a retry/resume/reload can re-target it after a service-worker restart. */
  tabId: number | null;
  /** Who this run is for - read off the page's Sales Officer box at START, sent with every backend API call. */
  ptclUsername: string;
  /** Fetched from the backend once at START and persisted, so a browser/service-worker restart doesn't lose the actual data mid-run. */
  entries: EntryRecord[];
}

// ---------- Popup -> Background ----------
// No username here: the background reads it off the page's Sales Officer box
// itself at START, so there is nothing for the user to type or mistype.
export interface StartMessage {
  type: 'START';
  mode: AutomationMode;
  total: number;
}
export interface PauseMessage {
  type: 'PAUSE';
}
export interface ResumeMessage {
  type: 'RESUME';
}
export interface StopMessage {
  type: 'STOP';
}
export interface GetStatusMessage {
  type: 'GET_STATUS';
}
export interface RetryEntryMessage {
  type: 'RETRY_ENTRY';
}
export interface SkipEntryMessage {
  type: 'SKIP_ENTRY';
}
/** "Show me who I'm logged in as" - answered with SalesOfficerResult, not a QueueState. */
export interface DetectSalesOfficerMessage {
  type: 'DETECT_SALES_OFFICER';
}

/** The subset of popup messages the background answers with a fresh QueueState. */
export type PopupQueueMessage =
  | StartMessage
  | PauseMessage
  | ResumeMessage
  | StopMessage
  | GetStatusMessage
  | RetryEntryMessage
  | SkipEntryMessage;

export type PopupToBackgroundMessage = PopupQueueMessage | DetectSalesOfficerMessage;

/**
 * Reply to DETECT_SALES_OFFICER. `salesOfficer` is null when no POMS tab
 * could be read, in which case `error` says what to do about it. `tabUrl` is
 * the tab the value came from, so the popup can show which page it used.
 */
export interface SalesOfficerResult {
  salesOfficer: string | null;
  tabUrl: string | null;
  error: string | null;
}

// ---------- Content Script -> Background ----------
export interface ContentReadyMessage {
  type: 'CONTENT_READY';
  url: string;
}
export interface FillResultMessage {
  type: 'FILL_RESULT';
  entryIndex: number;
  success: boolean;
  missingFields?: string[];
}
export interface SubmissionSuccessMessage {
  type: 'SUBMISSION_SUCCESS';
  entryIndex: number;
}
export interface SubmissionFailedMessage {
  type: 'SUBMISSION_FAILED';
  entryIndex: number;
  reason: string;
}
/** Fields correct, both radios checked - about to click Submit (auto) or start waiting for a manual click. */
export interface ReadyToSubmitMessage {
  type: 'READY_TO_SUBMIT';
  entryIndex: number;
}

export type ContentToBackgroundMessage =
  | ContentReadyMessage
  | FillResultMessage
  | SubmissionSuccessMessage
  | SubmissionFailedMessage
  | ReadyToSubmitMessage;

// ---------- Background -> Content Script ----------
// Sent in response to every CONTENT_READY while the queue is running. Carries
// entryStatus so the content script can tell "still filling this entry" apart
// from "we already clicked submit/asked for a manual click - check if this
// fresh page load means it actually went through."
export interface FillEntryMessage {
  type: 'FILL_ENTRY';
  entryIndex: number;
  record: EntryRecord;
  mode: AutomationMode;
  entryStatus: EntryStatus;
}
export interface NoActiveQueueMessage {
  type: 'NO_ACTIVE_QUEUE';
}

export type BackgroundToContentMessage = FillEntryMessage | NoActiveQueueMessage;

// Background's reply to every PopupToBackgroundMessage is the fresh QueueState.
export type BackgroundToPopupMessage = QueueState;
