// ==UserScript==
// @name         PTCL DDS Entry Assistant
// @namespace    ptcl-dds-assistant
// @version      0.1.0
// @description  Fills the real PTCL POMS DDS New Customer form using entries from our own backend. No server-side browser automation - runs entirely in your own logged-in browser tab.
// @match        https://my.ptcl.net.pk/POMS/DDSNewCustomer.aspx*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Same backend the desktop extension uses. If you redeploy the backend
  // somewhere else, update this and re-save the script in Tampermonkey.
  var BACKEND_URL = 'https://dds-jade-five.vercel.app';

  var MAPPING = {
    region: '#ddlregionname',
    exchange: '#TextExchange',
    name: '#TextName',
    address: '#TextAddress',
    contact: '#TextContactNo',
    competition: '#TestCompName',
    latHidden: '#hfLatitude',
    lngHidden: '#hfLongitude',
    latDisplay: '#TxtLatitude',
    lngDisplay: '#TxtLongitude',
    email: '#TxtEmail',
    orderStatusRadio: '#rbOrderBookedNo',
    technologyRadio: '#rbODNNo',
    submit: '#btnLogin',
  };

  var TEXT_FIELD_KEYS = ['exchange', 'name', 'address', 'contact', 'competition', 'email'];

  // ---------------- Persistent state (survives every page reload) ----------------

  var STATE_KEY = 'dds_state';

  function defaultState() {
    return {
      runState: 'idle', // idle | running | paused | stopped | completed
      mode: 'manual',
      ptclUsername: '',
      entries: [],
      currentIndex: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      entryStatus: 'pending', // pending | submitting | waiting_manual_submit | failed
      lastError: null,
    };
  }

  function loadState() {
    var raw = GM_getValue(STATE_KEY, null);
    return raw ? JSON.parse(raw) : defaultState();
  }

  function saveState(state) {
    GM_setValue(STATE_KEY, JSON.stringify(state));
  }

  // ---------------- Form filling (same technique as the desktop extension) ----------------

  function setNativeValue(element, value) {
    var prototype = Object.getPrototypeOf(element);
    var descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    var nativeSetter = descriptor && descriptor.set;
    if (nativeSetter) {
      nativeSetter.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fieldsMatchRecord(record) {
    for (var i = 0; i < TEXT_FIELD_KEYS.length; i++) {
      var key = TEXT_FIELD_KEYS[i];
      var el = document.querySelector(MAPPING[key]);
      if (!el || el.value !== record[key]) return false;
    }
    var region = document.querySelector(MAPPING.region);
    if (!region || region.value !== record.region) return false;

    var latHidden = document.querySelector(MAPPING.latHidden);
    var lngHidden = document.querySelector(MAPPING.lngHidden);
    if (!latHidden || latHidden.value !== record.lat) return false;
    if (!lngHidden || lngHidden.value !== record.lng) return false;

    return true;
  }

  // Real PTCL page runs its own geolocation script on every load that can
  // overwrite the lat/lng fields asynchronously at any time - always
  // re-assert unconditionally, immediately before every click below, so
  // nothing (JS is single-threaded) can slip in between.
  function reassertLatLng(record) {
    var missing = [];
    [
      [MAPPING.latHidden, record.lat],
      [MAPPING.lngHidden, record.lng],
      [MAPPING.latDisplay, record.lat],
      [MAPPING.lngDisplay, record.lng],
    ].forEach(function (pair) {
      var el = document.querySelector(pair[0]);
      if (!el) {
        missing.push(pair[0]);
        return;
      }
      setNativeValue(el, pair[1]);
    });
    return missing;
  }

  function fillTextAndHiddenFields(record) {
    var missing = [];

    var region = document.querySelector(MAPPING.region);
    if (!region) {
      missing.push('region');
    } else if (region.value !== record.region) {
      region.value = record.region;
      region.dispatchEvent(new Event('change', { bubbles: true }));
    }

    TEXT_FIELD_KEYS.forEach(function (key) {
      var el = document.querySelector(MAPPING[key]);
      if (!el) {
        missing.push(key);
        return;
      }
      if (el.value !== record[key]) setNativeValue(el, record[key]);
    });

    missing = missing.concat(reassertLatLng(record));
    return missing;
  }

  function isOrderStatusChecked() {
    var el = document.querySelector(MAPPING.orderStatusRadio);
    return !!(el && el.checked);
  }

  function isTechnologyChecked() {
    var el = document.querySelector(MAPPING.technologyRadio);
    return !!(el && el.checked);
  }

  function clickElement(selector) {
    var el = document.querySelector(selector);
    if (!el) return false;
    el.click();
    return true;
  }

  // ---------------- Backend API ----------------

  function fetchEntries(ptclUsername, count) {
    return fetch(BACKEND_URL + '/api/dds/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ptclUsername: ptclUsername, count: count }),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Backend request failed.');
        return data.entries;
      });
    });
  }

  // ---------------- Floating control panel ----------------

  var panelEl = null;

  function ensurePanel() {
    if (panelEl && document.body.contains(panelEl)) return panelEl;
    panelEl = document.createElement('div');
    panelEl.id = 'dds-assistant-panel';
    panelEl.style.cssText =
      'position:fixed; top:12px; right:12px; z-index:999999; background:#12213c; color:#fff; ' +
      'font-family:sans-serif; font-size:13px; padding:10px 14px; border-radius:8px; ' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.3); min-width:200px;';
    document.body.appendChild(panelEl);
    return panelEl;
  }

  function renderPanel(state) {
    var panel = ensurePanel();
    var isRunning = state.runState === 'running';
    var isPaused = state.runState === 'paused';
    var isIdleOrFinished = ['idle', 'stopped', 'completed'].indexOf(state.runState) !== -1;

    var html = '<div style="font-weight:600; margin-bottom:6px;">DDS Assistant</div>';

    if (isIdleOrFinished) {
      html +=
        '<div style="opacity:0.85; margin-bottom:8px;">' +
        (state.runState === 'completed' ? 'All done. ' : state.runState === 'stopped' ? 'Stopped. ' : '') +
        'Completed: ' + state.completed + ', Failed: ' + state.failed +
        '</div>' +
        '<button id="dds-start-btn" style="width:100%; padding:6px; border:none; border-radius:5px; background:#1f6feb; color:#fff; cursor:pointer;">Start</button>';
    } else {
      html +=
        '<div style="margin-bottom:4px;">Entry ' + (state.currentIndex + 1) + ' / ' + state.entries.length + '</div>' +
        '<div style="opacity:0.85; margin-bottom:8px;">' + (state.status || state.entryStatus) + '</div>';

      if (state.entryStatus === 'failed' && state.lastError) {
        html +=
          '<div style="background:#ffebe9; color:#82071e; padding:6px; border-radius:5px; margin-bottom:8px; font-size:12px;">' +
          escapeHtml(state.lastError) +
          '</div>' +
          '<button id="dds-retry-btn" style="width:48%; margin-right:4%; padding:6px; border:none; border-radius:5px; background:#1f6feb; color:#fff; cursor:pointer;">Retry</button>' +
          '<button id="dds-skip-btn" style="width:48%; padding:6px; border:none; border-radius:5px; background:#6b7280; color:#fff; cursor:pointer;">Skip</button>';
      } else {
        html +=
          (isPaused
            ? '<button id="dds-resume-btn" style="width:48%; margin-right:4%; padding:6px; border:none; border-radius:5px; background:#1f6feb; color:#fff; cursor:pointer;">Resume</button>'
            : '<button id="dds-pause-btn" style="width:48%; margin-right:4%; padding:6px; border:none; border-radius:5px; background:#6b7280; color:#fff; cursor:pointer;">Pause</button>') +
          '<button id="dds-stop-btn" style="width:48%; padding:6px; border:none; border-radius:5px; background:#d1242f; color:#fff; cursor:pointer;">Stop</button>';
      }
    }

    panel.innerHTML = html;

    var startBtn = document.getElementById('dds-start-btn');
    if (startBtn) startBtn.addEventListener('click', onStartClicked);
    var pauseBtn = document.getElementById('dds-pause-btn');
    if (pauseBtn) pauseBtn.addEventListener('click', onPauseClicked);
    var resumeBtn = document.getElementById('dds-resume-btn');
    if (resumeBtn) resumeBtn.addEventListener('click', onResumeClicked);
    var stopBtn = document.getElementById('dds-stop-btn');
    if (stopBtn) stopBtn.addEventListener('click', onStopClicked);
    var retryBtn = document.getElementById('dds-retry-btn');
    if (retryBtn) retryBtn.addEventListener('click', onRetryClicked);
    var skipBtn = document.getElementById('dds-skip-btn');
    if (skipBtn) skipBtn.addEventListener('click', onSkipClicked);
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------------- Button handlers ----------------

  function onStartClicked() {
    var ptclUsername = prompt('PTCL Username (checked against the roster):');
    if (!ptclUsername) return;

    var countStr = prompt('How many entries?', '10');
    if (!countStr) return;
    var count = Math.max(1, parseInt(countStr, 10) || 1);

    var autoSubmit = confirm(
      'Auto-submit each entry automatically?\n\nOK = Yes, submit every entry automatically\nCancel = No, I will click Submit myself each time'
    );

    fetchEntries(ptclUsername.trim(), count)
      .then(function (entries) {
        var state = defaultState();
        state.runState = 'running';
        state.mode = autoSubmit ? 'auto' : 'manual';
        state.ptclUsername = ptclUsername.trim();
        state.entries = entries;
        saveState(state);
        renderPanel(state);
        processCurrentPage();
      })
      .catch(function (err) {
        alert('Could not start: ' + err.message);
      });
  }

  function onPauseClicked() {
    var state = loadState();
    if (state.runState === 'running') {
      state.runState = 'paused';
      saveState(state);
      renderPanel(state);
    }
  }

  function onResumeClicked() {
    var state = loadState();
    if (state.runState === 'paused') {
      state.runState = 'running';
      saveState(state);
      renderPanel(state);
      processCurrentPage();
    }
  }

  function onStopClicked() {
    if (!confirm('Stop the current run? Progress so far is kept.')) return;
    var state = loadState();
    state.runState = 'stopped';
    saveState(state);
    renderPanel(state);
  }

  function onRetryClicked() {
    var state = loadState();
    state.entryStatus = 'pending';
    state.lastError = null;
    state.runState = 'running';
    saveState(state);
    renderPanel(state);
    processCurrentPage();
  }

  function onSkipClicked() {
    var state = loadState();
    state.skipped += 1;
    state.currentIndex += 1;
    state.entryStatus = 'pending';
    state.lastError = null;
    state.runState = state.currentIndex >= state.entries.length ? 'completed' : 'running';
    saveState(state);
    renderPanel(state);
    if (state.runState === 'running') processCurrentPage();
  }

  // ---------------- Manual-mode submit guard ----------------
  // While waiting for the user's own click (could be a long time), the
  // page's geolocation script could still overwrite lat/lng at any point.
  // A capture-phase listener on document fires before the submit button's
  // own handler, so re-assert correct values at the exact instant of the
  // real click.

  var manualGuardAttached = false;
  function attachManualSubmitGuard(record) {
    if (manualGuardAttached) return;
    manualGuardAttached = true;
    document.addEventListener(
      'click',
      function (event) {
        var submitButton = document.querySelector(MAPPING.submit);
        if (submitButton && (event.target === submitButton || submitButton.contains(event.target))) {
          reassertLatLng(record);
        }
      },
      true
    );
  }

  // ---------------- Core per-page-load automation step ----------------
  // Mirrors the desktop extension's content script exactly: every page load
  // re-derives "what should happen next" purely from comparing the current
  // DOM to the target record + the last known entryStatus - never from
  // anything only held in a variable, since a postback reload destroys the
  // whole script execution just like it would a content script.

  function processCurrentPage() {
    var state = loadState();
    if (state.runState !== 'running') return;

    var record = state.entries[state.currentIndex];
    if (!record) {
      state.runState = 'completed';
      saveState(state);
      renderPanel(state);
      return;
    }

    var stillMatchesTarget = fieldsMatchRecord(record);

    if ((state.entryStatus === 'submitting' || state.entryStatus === 'waiting_manual_submit') && !stillMatchesTarget) {
      // Previous entry's submission went through - the form reset.
      state.completed += 1;
      state.currentIndex += 1;
      state.entryStatus = 'pending';
      state.lastError = null;
      state.runState = state.currentIndex >= state.entries.length ? 'completed' : 'running';
      saveState(state);
      renderPanel(state);
      if (state.runState === 'running') processCurrentPage(); // continue with the next record, same page load
      return;
    }

    if (!stillMatchesTarget) {
      var missing = fillTextAndHiddenFields(record);
      if (missing.length > 0) {
        state.failed += 1;
        state.entryStatus = 'failed';
        state.lastError = 'Field(s) not found: ' + missing.join(', ');
        state.runState = 'paused';
        saveState(state);
        renderPanel(state);
        return;
      }
    }

    if (!isOrderStatusChecked()) {
      reassertLatLng(record);
      if (!clickElement(MAPPING.orderStatusRadio)) {
        failCurrentEntry(state, 'Order Status radio button was not found.');
      }
      return;
    }

    if (!isTechnologyChecked()) {
      reassertLatLng(record);
      if (!clickElement(MAPPING.technologyRadio)) {
        failCurrentEntry(state, 'Technology radio button was not found.');
      }
      return;
    }

    // Every field correct, both radios checked - ready to submit.
    if (state.mode === 'auto') {
      state.entryStatus = 'submitting';
      saveState(state);
      renderPanel(state);
      reassertLatLng(record);
      if (!clickElement(MAPPING.submit)) {
        failCurrentEntry(loadState(), 'Submit button was not found.');
      }
    } else {
      state.entryStatus = 'waiting_manual_submit';
      saveState(state);
      renderPanel(state);
      attachManualSubmitGuard(record);
    }
  }

  function failCurrentEntry(state, reason) {
    state.failed += 1;
    state.entryStatus = 'failed';
    state.lastError = reason;
    state.runState = 'paused';
    saveState(state);
    renderPanel(state);
  }

  // ---------------- Init ----------------

  var initialState = loadState();
  renderPanel(initialState);
  if (initialState.runState === 'running') {
    processCurrentPage();
  }
})();
