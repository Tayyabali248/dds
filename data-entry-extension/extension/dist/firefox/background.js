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
    }
  };

  // extension/src/storage/storage.ts
  var QUEUE_STATE_KEY = "dds_queue_state";
  async function loadQueueState() {
    const result = await api.storage.get([QUEUE_STATE_KEY]);
    return result[QUEUE_STATE_KEY] ?? null;
  }
  async function saveQueueState(state) {
    await api.storage.set({ [QUEUE_STATE_KEY]: state });
  }

  // extension/src/queue/queue-manager.ts
  function createIdleState() {
    return {
      mode: "manual",
      runState: "idle",
      status: "Idle",
      currentIndex: 0,
      total: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      lastError: null,
      entryStatus: "pending",
      tabId: null,
      ptclUsername: "",
      entries: []
    };
  }
  var QueueManager = class _QueueManager {
    constructor(state) {
      this.state = state;
    }
    static async load() {
      const saved = await loadQueueState();
      return new _QueueManager(saved ?? createIdleState());
    }
    getState() {
      return { ...this.state };
    }
    isActive() {
      return this.state.runState === "running";
    }
    async start(mode, ptclUsername, entries, tabId) {
      this.state = {
        mode,
        runState: "running",
        status: "Starting...",
        currentIndex: 0,
        total: entries.length,
        completed: 0,
        failed: 0,
        skipped: 0,
        lastError: null,
        entryStatus: "pending",
        tabId,
        ptclUsername,
        entries
      };
      await this.persist();
      return this.getState();
    }
    async setTabId(tabId) {
      this.state.tabId = tabId;
      await this.persist();
    }
    /** For failures before the queue is even running (auth/network on Start) - keeps runState as-is. */
    async reportError(reason) {
      this.state.lastError = reason;
      this.state.status = reason;
      await this.persist();
      return this.getState();
    }
    currentRecord() {
      return this.state.entries[this.state.currentIndex];
    }
    async pause() {
      if (this.state.runState === "running") {
        this.state.runState = "paused";
        this.state.status = "Paused";
        await this.persist();
      }
      return this.getState();
    }
    async resume() {
      if (this.state.runState === "paused") {
        this.state.runState = "running";
        this.state.status = this.state.entryStatus === "waiting_manual_submit" ? "Waiting for you to click Submit" : "Resumed";
        await this.persist();
      }
      return this.getState();
    }
    async stop() {
      this.state.runState = "stopped";
      this.state.status = "Stopped";
      await this.persist();
      return this.getState();
    }
    async setEntryStatus(entryStatus, statusText) {
      this.state.entryStatus = entryStatus;
      this.state.status = statusText;
      await this.persist();
      return this.getState();
    }
    async markSuccess() {
      this.state.completed += 1;
      this.state.currentIndex += 1;
      this.state.entryStatus = "pending";
      this.state.lastError = null;
      if (this.state.currentIndex >= this.state.total) {
        this.state.runState = "completed";
        this.state.status = "All entries processed";
      } else {
        this.state.status = `Entry ${this.state.currentIndex} of ${this.state.total} completed`;
      }
      await this.persist();
      return this.getState();
    }
    // On failure we pause rather than continue, per spec: never silently
    // continue after an automation failure - the user must Retry or Skip.
    async markFailed(reason) {
      this.state.failed += 1;
      this.state.entryStatus = "failed";
      this.state.lastError = reason;
      this.state.runState = "paused";
      this.state.status = `Entry ${this.state.currentIndex + 1} failed: ${reason}`;
      await this.persist();
      return this.getState();
    }
    async retry() {
      this.state.entryStatus = "pending";
      this.state.lastError = null;
      this.state.runState = "running";
      this.state.status = `Retrying entry ${this.state.currentIndex + 1}`;
      await this.persist();
      return this.getState();
    }
    async skip() {
      this.state.skipped += 1;
      this.state.currentIndex += 1;
      this.state.entryStatus = "pending";
      this.state.lastError = null;
      this.state.runState = this.state.currentIndex >= this.state.total ? "completed" : "running";
      this.state.status = this.state.runState === "completed" ? "All entries processed" : `Skipped. Moving to entry ${this.state.currentIndex + 1}`;
      await this.persist();
      return this.getState();
    }
    async persist() {
      await saveQueueState(this.state);
    }
  };

  // extension/src/config/backend.ts
  var BACKEND_URL = "https://dds-jade-five.vercel.app";

  // extension/src/background/service-worker.ts
  var cachedManager = null;
  function getQueueManager() {
    if (!cachedManager) cachedManager = QueueManager.load();
    return cachedManager;
  }
  async function fetchEntries(ptclUsername, count) {
    let response;
    try {
      response = await fetch(`${BACKEND_URL}/api/dds/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ptclUsername, count })
      });
    } catch {
      throw new Error(`Could not reach the backend at ${BACKEND_URL}. Is dds/server.js running?`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Backend returned ${response.status}.`);
    }
    if (!data.entries || data.entries.length === 0) {
      throw new Error("Backend returned no entries.");
    }
    return data.entries;
  }
  async function sendFillEntry(tabId, qm) {
    const state = qm.getState();
    const record = qm.currentRecord();
    if (!record) {
      await qm.markFailed(`No entry data available for index ${state.currentIndex + 1}.`);
      return;
    }
    const message = {
      type: "FILL_ENTRY",
      entryIndex: state.currentIndex,
      record,
      mode: state.mode,
      entryStatus: state.entryStatus
    };
    api.tabs.sendMessage(tabId, message).catch(() => {
    });
  }
  async function handleContentReady(tabId) {
    if (tabId === void 0) return;
    const qm = await getQueueManager();
    await qm.setTabId(tabId);
    const state = qm.getState();
    if (state.runState !== "running") return;
    await sendFillEntry(tabId, qm);
  }
  async function handleFillResult(msg) {
    const qm = await getQueueManager();
    const state = qm.getState();
    if (state.runState !== "running" || msg.entryIndex !== state.currentIndex) return;
    if (!msg.success) {
      const missing = msg.missingFields?.join(", ") || "unknown field";
      await qm.markFailed(`Field(s) not found on the page: ${missing}`);
      return;
    }
    await qm.setEntryStatus("filling", `Filling entry ${state.currentIndex + 1} of ${state.total}`);
  }
  async function handleReadyToSubmit(msg) {
    const qm = await getQueueManager();
    const state = qm.getState();
    if (state.runState !== "running" || msg.entryIndex !== state.currentIndex) return;
    if (state.mode === "auto") {
      await qm.setEntryStatus("submitting", `Submitting entry ${state.currentIndex + 1} of ${state.total}`);
    } else {
      await qm.setEntryStatus(
        "waiting_manual_submit",
        `Entry ${state.currentIndex + 1} filled - click Submit yourself on the page`
      );
    }
  }
  async function handleSubmissionSuccess(msg) {
    const qm = await getQueueManager();
    const state = qm.getState();
    if (state.runState !== "running" || msg.entryIndex !== state.currentIndex) return;
    const newState = await qm.markSuccess();
    if (newState.runState === "running" && newState.tabId !== null) {
      await sendFillEntry(newState.tabId, qm);
    }
  }
  async function handleSubmissionFailed(msg) {
    const qm = await getQueueManager();
    const state = qm.getState();
    if (state.runState !== "running" || msg.entryIndex !== state.currentIndex) return;
    await qm.markFailed(msg.reason);
  }
  async function handleStart(total, mode, ptclUsername) {
    const qm = await getQueueManager();
    let entries;
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
  async function handleRetryOrSkip(action) {
    const qm = await getQueueManager();
    const state = action === "retry" ? await qm.retry() : await qm.skip();
    if (state.runState === "running" && state.tabId !== null) {
      await sendFillEntry(state.tabId, qm);
    }
    return qm.getState();
  }
  async function handlePopupMessage(message) {
    const qm = await getQueueManager();
    switch (message.type) {
      case "START":
        return handleStart(message.total, message.mode, message.ptclUsername);
      case "PAUSE":
        return qm.pause();
      case "RESUME":
        return qm.resume();
      case "STOP":
        return qm.stop();
      case "GET_STATUS":
        return qm.getState();
      case "RETRY_ENTRY":
        return handleRetryOrSkip("retry");
      case "SKIP_ENTRY":
        return handleRetryOrSkip("skip");
    }
  }
  api.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      const tabId = sender.tab?.id;
      switch (message.type) {
        case "CONTENT_READY":
          void handleContentReady(tabId);
          return false;
        case "FILL_RESULT":
          void handleFillResult(message);
          return false;
        case "READY_TO_SUBMIT":
          void handleReadyToSubmit(message);
          return false;
        case "SUBMISSION_SUCCESS":
          void handleSubmissionSuccess(message);
          return false;
        case "SUBMISSION_FAILED":
          void handleSubmissionFailed(message);
          return false;
        default:
          handlePopupMessage(message).then(sendResponse);
          return true;
      }
    }
  );
})();
//# sourceMappingURL=background.js.map
