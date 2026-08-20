import { api } from '../platform/browser';
import { defaultFieldMapping } from '../config/field-mapping';
import {
  clickElement,
  fieldsMatchRecord,
  fillTextAndHiddenFields,
  isOrderStatusChecked,
  isTechnologyChecked,
  reassertLatLng,
  readSalesOfficer,
} from '../automation/form-filler';
import type {
  BackgroundToContentMessage,
  ContentReadyMessage,
  EntryRecord,
  FillEntryMessage,
  SalesOfficerResponse,
} from '../types/messages';

const mapping = defaultFieldMapping;

// Manual mode: the user's own click could come seconds or minutes after we
// last touched the form, so we can't just re-assert lat/lng once and walk
// away - the page's geolocation script could still overwrite them any time
// before then. A capture-phase listener on `document` fires before the
// submit button's own inline onclick handler (capture runs top-down through
// ancestors before the target's own listeners), so this re-asserts the
// correct values in the same synchronous tick, right before the real click
// is processed.
let manualSubmitGuardAttached = false;
function attachManualSubmitGuard(record: EntryRecord): void {
  if (manualSubmitGuardAttached) return;
  manualSubmitGuardAttached = true;

  document.addEventListener(
    'click',
    (event) => {
      const submitButton = document.querySelector(mapping.submit);
      const target = event.target as Node | null;
      if (submitButton && target && (target === submitButton || submitButton.contains(target))) {
        reassertLatLng(mapping, record);
      }
    },
    true
  );
}

// The real PTCL DDS form's two radio buttons each trigger a genuine
// ASP.NET postback (full page reload) when clicked - there is no way to
// click both and then keep going in one script execution, because the
// browser tears this whole script down the moment the reload starts. So
// every page load re-derives "what should happen next" purely by comparing
// the current DOM to the target record + the entryStatus the background
// last knew about - never from anything remembered in this script instance.

function send(message: unknown): void {
  api.runtime.sendMessage(message).catch(() => {
    // Background may have nothing to say back (no active queue) - fine.
  });
}

function handleFillEntry(msg: FillEntryMessage): void {
  const { entryIndex, record, mode, entryStatus } = msg;
  const stillMatchesTarget = fieldsMatchRecord(mapping, record);

  // We already clicked Submit (auto) or asked the user to (manual) for this
  // exact record on a previous page load. If the fields no longer match it,
  // the form reset - the submission actually went through.
  if ((entryStatus === 'submitting' || entryStatus === 'waiting_manual_submit') && !stillMatchesTarget) {
    send({ type: 'SUBMISSION_SUCCESS', entryIndex });
    return;
  }

  if (!stillMatchesTarget) {
    const missing = fillTextAndHiddenFields(mapping, record);
    if (missing.length > 0) {
      send({ type: 'FILL_RESULT', entryIndex, success: false, missingFields: missing });
      return;
    }
    send({ type: 'FILL_RESULT', entryIndex, success: true });
    // Fall through: the radios below still need clicking. Each click causes
    // a reload, so at most one of the two clicks below actually fires per
    // page load - the next load picks up from there.
  }

  if (!isOrderStatusChecked(mapping)) {
    // Re-assert immediately before the click (same synchronous call, so
    // nothing - including the page's own geolocation script - can slip a
    // different value in between this and the click actually firing.
    reassertLatLng(mapping, record);
    if (!clickElement(mapping.orderStatusRadio)) {
      send({ type: 'SUBMISSION_FAILED', entryIndex, reason: 'Order Status radio button was not found.' });
    }
    return;
  }

  if (!isTechnologyChecked(mapping)) {
    reassertLatLng(mapping, record);
    if (!clickElement(mapping.technologyRadio)) {
      send({ type: 'SUBMISSION_FAILED', entryIndex, reason: 'Technology radio button was not found.' });
    }
    return;
  }

  // Every field correct, both radios checked - ready to submit.
  send({ type: 'READY_TO_SUBMIT', entryIndex });

  if (mode === 'auto') {
    reassertLatLng(mapping, record);
    if (!clickElement(mapping.submit)) {
      send({ type: 'SUBMISSION_FAILED', entryIndex, reason: 'Submit button was not found.' });
    }
  }
  // Manual mode: don't click Submit ourselves. Arm the guard so whenever the
  // user does click it - however long from now - the values are correct at
  // that instant. The next page load's content-script instance detects the
  // field mismatch above and reports SUBMISSION_SUCCESS.
  if (mode === 'manual') {
    attachManualSubmitGuard(record);
  }
}

function announceReady(): void {
  const message: ContentReadyMessage = { type: 'CONTENT_READY', url: window.location.href };
  send(message);
}

api.runtime.onMessage.addListener((message: BackgroundToContentMessage, _sender, sendResponse) => {
  if (message.type === 'FILL_ENTRY') {
    handleFillEntry(message);
  }
  if (message.type === 'GET_SALES_OFFICER') {
    const response: SalesOfficerResponse = { salesOfficer: readSalesOfficer(mapping) };
    sendResponse(response);
  }
  return false;
});

announceReady();
