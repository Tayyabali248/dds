"use strict";
(() => {
  // extension/src/platform/browser.ts
  var runtimeApi = typeof browser !== "undefined" ? browser : chrome;
  var isFirefox = typeof browser !== "undefined";
  function storageGet(area, keys) {
    if (isFirefox) {
      return runtimeApi.storage[area].get(keys);
    }
    return new Promise((resolve, reject) => {
      chrome.storage[area].get(keys, (result) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(result);
      });
    });
  }
  function storageSet(area, items) {
    if (isFirefox) {
      return runtimeApi.storage[area].set(items);
    }
    return new Promise((resolve, reject) => {
      chrome.storage[area].set(items, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }
  function sendMessage(message) {
    if (isFirefox) {
      return runtimeApi.runtime.sendMessage(message);
    }
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(response);
      });
    });
  }
  function sendMessageToTab(tabId, message) {
    if (isFirefox) {
      return runtimeApi.tabs.sendMessage(tabId, message);
    }
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(response);
      });
    });
  }
  function executeScriptInTab(tabId, func, args, allFrames = true) {
    const injection = {
      target: { tabId, allFrames },
      func,
      args
    };
    return Promise.resolve(runtimeApi.scripting.executeScript(injection)).then(
      (results) => results.map((entry) => entry.result)
    );
  }
  function queryTabs(query) {
    if (isFirefox) {
      return runtimeApi.tabs.query(query);
    }
    return new Promise((resolve) => {
      chrome.tabs.query(query, (tabs) => resolve(tabs));
    });
  }
  var api = {
    isFirefox,
    storage: {
      get: (keys) => storageGet("local", keys),
      set: (items) => storageSet("local", items)
    },
    runtime: {
      sendMessage,
      onMessage: {
        /**
         * Registers a listener. Return `true` (or return a Promise, on
         * Firefox) from the handler to indicate an async response will be
         * sent via `sendResponse` - matches the native MV3 contract.
         */
        addListener(handler) {
          chrome.runtime.onMessage.addListener(handler);
        }
      },
      onInstalled: {
        addListener(handler) {
          chrome.runtime.onInstalled.addListener(handler);
        }
      }
    },
    tabs: {
      query: queryTabs,
      sendMessage: sendMessageToTab
    },
    scripting: {
      executeScript: executeScriptInTab
    }
  };

  // extension/src/popup/popup.ts
  function el(id) {
    const found = document.getElementById(id);
    if (!found) throw new Error(`Missing element #${id}`);
    return found;
  }
  var salesOfficerValue = el("sales-officer-value");
  var detectBtn = el("detect-username-btn");
  var usernameHint = el("username-hint");
  var entriesInput = el("entries-input");
  var modeAuto = el("mode-auto");
  var modeManual = el("mode-manual");
  var setupSection = el("setup-section");
  var startBtn = el("start-btn");
  var pauseBtn = el("pause-btn");
  var resumeBtn = el("resume-btn");
  var stopBtn = el("stop-btn");
  var progressCurrent = el("progress-current");
  var progressTotal = el("progress-total");
  var statCompleted = el("stat-completed");
  var statFailed = el("stat-failed");
  var statSkipped = el("stat-skipped");
  var statusLine = el("status-line");
  var errorSection = el("error-section");
  var errorText = el("error-text");
  var retryBtn = el("retry-btn");
  var skipBtn = el("skip-btn");
  async function send(message) {
    return api.runtime.sendMessage(message);
  }
  var detectedUsername = null;
  function showSalesOfficer(value, hint) {
    salesOfficerValue.textContent = value ?? "Not found";
    salesOfficerValue.classList.toggle("unresolved", value === null);
    if (hint) usernameHint.textContent = hint;
  }
  async function detectSalesOfficer() {
    detectBtn.disabled = true;
    salesOfficerValue.classList.remove("unresolved");
    salesOfficerValue.textContent = "Reading from the page...";
    const message = { type: "DETECT_SALES_OFFICER" };
    try {
      const result = await api.runtime.sendMessage(message);
      detectedUsername = result.salesOfficer;
      if (result.salesOfficer) {
        showSalesOfficer(result.salesOfficer, "Read from the DDS page. Checked against the roster on Start.");
      } else {
        showSalesOfficer(null, result.error ?? "Open the DDS New Customer page and log into POMS.");
      }
    } catch (err) {
      detectedUsername = null;
      showSalesOfficer(null, err instanceof Error ? err.message : String(err));
    } finally {
      detectBtn.disabled = false;
    }
  }
  function render(state) {
    const isIdle = state.runState === "idle";
    const isRunning = state.runState === "running";
    const isPaused = state.runState === "paused";
    const isFinished = state.runState === "completed" || state.runState === "stopped";
    const hasFailure = state.entryStatus === "failed";
    const inFlight = isRunning || isPaused;
    const shown = inFlight ? state.ptclUsername : detectedUsername ?? state.ptclUsername;
    if (shown) showSalesOfficer(shown);
    const canEditSetup = isIdle || isFinished;
    setupSection.style.opacity = canEditSetup ? "1" : "0.5";
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
    retryBtn.classList.toggle("hidden", !hasFailure);
    skipBtn.classList.toggle("hidden", !hasFailure);
    if (hasFailure && state.lastError) {
      errorSection.classList.remove("hidden");
      errorText.textContent = `Entry ${state.currentIndex + 1} failed: ${state.lastError}`;
    } else if (isIdle && state.lastError) {
      errorSection.classList.remove("hidden");
      errorText.textContent = state.lastError;
    } else {
      errorSection.classList.add("hidden");
    }
  }
  async function refresh() {
    const state = await send({ type: "GET_STATUS" });
    render(state);
  }
  detectBtn.addEventListener("click", () => {
    void detectSalesOfficer();
  });
  startBtn.addEventListener("click", async () => {
    const total = Math.max(1, Math.min(100, parseInt(entriesInput.value, 10) || 1));
    const mode = modeAuto.checked ? "auto" : "manual";
    const state = await send({ type: "START", mode, total });
    render(state);
  });
  pauseBtn.addEventListener("click", async () => {
    render(await send({ type: "PAUSE" }));
  });
  resumeBtn.addEventListener("click", async () => {
    render(await send({ type: "RESUME" }));
  });
  stopBtn.addEventListener("click", async () => {
    if (!confirm("Stop the current run? Progress so far is kept, but the queue will stop.")) return;
    render(await send({ type: "STOP" }));
  });
  retryBtn.addEventListener("click", async () => {
    render(await send({ type: "RETRY_ENTRY" }));
  });
  skipBtn.addEventListener("click", async () => {
    render(await send({ type: "SKIP_ENTRY" }));
  });
  var pollTimer = setInterval(refresh, 1e3);
  window.addEventListener("unload", () => clearInterval(pollTimer));
  void refresh().then(detectSalesOfficer);
})();
//# sourceMappingURL=popup.js.map
