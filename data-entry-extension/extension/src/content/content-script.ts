import { api } from '../platform/browser';
import { defaultFieldMapping } from '../config/field-mapping';
import {
  clickElement,
  fieldsMatchRecord,
  fillTextAndHiddenFields,
  isOrderStatusChecked,
  isTechnologyChecked,
} from '../automation/form-filler';
import type { BackgroundToContentMessage, ContentReadyMessage, FillEntryMessage } from '../types/messages';

const mapping = defaultFieldMapping;

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
    if (!clickElement(mapping.orderStatusRadio)) {
      send({ type: 'SUBMISSION_FAILED', entryIndex, reason: 'Order Status radio button was not found.' });
    }
    return;
  }

  if (!isTechnologyChecked(mapping)) {
    if (!clickElement(mapping.technologyRadio)) {
      send({ type: 'SUBMISSION_FAILED', entryIndex, reason: 'Technology radio button was not found.' });
    }
    return;
  }

  // Every field correct, both radios checked - ready to submit.
  send({ type: 'READY_TO_SUBMIT', entryIndex });

  if (mode === 'auto') {
    if (!clickElement(mapping.submit)) {
      send({ type: 'SUBMISSION_FAILED', entryIndex, reason: 'Submit button was not found.' });
    }
  }
  // Manual mode: do nothing further. The user clicks the real Submit button
  // themselves; that reload's next content-script instance will detect the
  // field mismatch above and report SUBMISSION_SUCCESS.
}

function announceReady(): void {
  const message: ContentReadyMessage = { type: 'CONTENT_READY', url: window.location.href };
  send(message);
}

api.runtime.onMessage.addListener((message: BackgroundToContentMessage) => {
  if (message.type === 'FILL_ENTRY') {
    handleFillEntry(message);
  }
  return false;
});

announceReady();
