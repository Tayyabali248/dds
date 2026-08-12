/**
 * Cross-browser WebExtension API wrapper.
 *
 * Firefox exposes a native `browser.*` namespace that returns Promises.
 * Chrome (MV3) exposes `chrome.*` - modern Chrome also returns Promises when
 * a callback is omitted, but support/behavior has varied across versions, so
 * we wrap everything explicitly rather than relying on that.
 *
 * Every other module in this extension talks to `api` from this file only -
 * nothing else should reference `chrome.*` or `browser.*` directly, so a
 * behavior difference only ever needs fixing in one place.
 */

type StorageArea = 'local';

declare const browser: typeof chrome | undefined;

const runtimeApi: typeof chrome = typeof browser !== 'undefined' ? (browser as typeof chrome) : chrome;
const isFirefox = typeof browser !== 'undefined';

function storageGet<T extends Record<string, unknown>>(
  area: StorageArea,
  keys: string[] | null
): Promise<Partial<T>> {
  if (isFirefox) {
    // Firefox's browser.storage.local.get returns a native Promise.
    return (runtimeApi.storage[area].get(keys as any) as unknown) as Promise<Partial<T>>;
  }
  return new Promise((resolve, reject) => {
    chrome.storage[area].get(keys as any, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result as Partial<T>);
    });
  });
}

function storageSet(area: StorageArea, items: Record<string, unknown>): Promise<void> {
  if (isFirefox) {
    return (runtimeApi.storage[area].set(items) as unknown) as Promise<void>;
  }
  return new Promise((resolve, reject) => {
    chrome.storage[area].set(items, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function sendMessage<TResponse = unknown>(message: unknown): Promise<TResponse> {
  if (isFirefox) {
    return (runtimeApi.runtime.sendMessage(message) as unknown) as Promise<TResponse>;
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      // A missing receiver (e.g. no content script on this page yet) is a
      // common, expected condition here - surface it as a normal rejection
      // rather than an uncaught error.
      if (err) reject(new Error(err.message));
      else resolve(response as TResponse);
    });
  });
}

function sendMessageToTab<TResponse = unknown>(tabId: number, message: unknown): Promise<TResponse> {
  if (isFirefox) {
    return (runtimeApi.tabs.sendMessage(tabId, message) as unknown) as Promise<TResponse>;
  }
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(response as TResponse);
    });
  });
}

function queryTabs(query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  if (isFirefox) {
    return (runtimeApi.tabs.query(query) as unknown) as Promise<chrome.tabs.Tab[]>;
  }
  return new Promise((resolve) => {
    chrome.tabs.query(query, (tabs) => resolve(tabs));
  });
}

export const api = {
  isFirefox,

  storage: {
    get: <T extends Record<string, unknown>>(keys: string[] | null) => storageGet<T>('local', keys),
    set: (items: Record<string, unknown>) => storageSet('local', items),
  },

  runtime: {
    sendMessage,
    onMessage: {
      /**
       * Registers a listener. Return `true` (or return a Promise, on
       * Firefox) from the handler to indicate an async response will be
       * sent via `sendResponse` - matches the native MV3 contract.
       */
      addListener(
        handler: (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => boolean | void
      ) {
        chrome.runtime.onMessage.addListener(handler as any);
      },
    },
    onInstalled: {
      addListener(handler: () => void) {
        chrome.runtime.onInstalled.addListener(handler);
      },
    },
  },

  tabs: {
    query: queryTabs,
    sendMessage: sendMessageToTab,
  },
};

export type BrowserApi = typeof api;
