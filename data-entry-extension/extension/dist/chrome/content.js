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

  // extension/src/config/field-mapping.ts
  var defaultFieldMapping = {
    region: "#ddlregionname",
    exchange: "#TextExchange",
    name: "#TextName",
    address: "#TextAddress",
    contact: "#TextContactNo",
    competition: "#TestCompName",
    latHidden: "#hfLatitude",
    lngHidden: "#hfLongitude",
    latDisplay: "#TxtLatitude",
    lngDisplay: "#TxtLongitude",
    email: "#TxtEmail",
    orderStatusRadio: "#rbOrderBookedNo",
    // "Contact Later"
    technologyRadio: "#rbODNNo",
    // "FF"
    submit: "#btnLogin"
  };

  // extension/src/automation/form-filler.ts
  function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    const nativeSetter = descriptor?.set;
    if (nativeSetter) {
      nativeSetter.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  var TEXT_FIELD_KEYS = ["exchange", "name", "address", "contact", "competition", "email"];
  function textSelectorFor(mapping2, key) {
    switch (key) {
      case "exchange":
        return mapping2.exchange;
      case "name":
        return mapping2.name;
      case "address":
        return mapping2.address;
      case "contact":
        return mapping2.contact;
      case "competition":
        return mapping2.competition;
      case "email":
        return mapping2.email;
    }
  }
  function recordValueFor(record, key) {
    switch (key) {
      case "exchange":
        return record.exchange;
      case "name":
        return record.name;
      case "address":
        return record.address;
      case "contact":
        return record.contact;
      case "competition":
        return record.competition;
      case "email":
        return record.email;
    }
  }
  function fieldsMatchRecord(mapping2, record) {
    for (const key of TEXT_FIELD_KEYS) {
      const el = document.querySelector(textSelectorFor(mapping2, key));
      if (!el || el.value !== recordValueFor(record, key)) return false;
    }
    const region = document.querySelector(mapping2.region);
    if (!region || region.value !== record.region) return false;
    const latHidden = document.querySelector(mapping2.latHidden);
    const lngHidden = document.querySelector(mapping2.lngHidden);
    if (!latHidden || latHidden.value !== record.lat) return false;
    if (!lngHidden || lngHidden.value !== record.lng) return false;
    return true;
  }
  function reassertLatLng(mapping2, record) {
    const missing = [];
    for (const [selector, value] of [
      [mapping2.latHidden, record.lat],
      [mapping2.lngHidden, record.lng],
      [mapping2.latDisplay, record.lat],
      [mapping2.lngDisplay, record.lng]
    ]) {
      const el = document.querySelector(selector);
      if (!el) {
        missing.push(selector);
        continue;
      }
      setNativeValue(el, value);
    }
    return missing;
  }
  function fillTextAndHiddenFields(mapping2, record) {
    const missing = [];
    const region = document.querySelector(mapping2.region);
    if (!region) {
      missing.push("region");
    } else if (region.value !== record.region) {
      region.value = record.region;
      region.dispatchEvent(new Event("change", { bubbles: true }));
    }
    for (const key of TEXT_FIELD_KEYS) {
      const selector = textSelectorFor(mapping2, key);
      const el = document.querySelector(selector);
      if (!el) {
        missing.push(key);
        continue;
      }
      const value = recordValueFor(record, key);
      if (el.value !== value) setNativeValue(el, value);
    }
    missing.push(...reassertLatLng(mapping2, record));
    return missing;
  }
  function isOrderStatusChecked(mapping2) {
    return document.querySelector(mapping2.orderStatusRadio)?.checked ?? false;
  }
  function isTechnologyChecked(mapping2) {
    return document.querySelector(mapping2.technologyRadio)?.checked ?? false;
  }
  function clickElement(selector) {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.click();
    return true;
  }

  // extension/src/content/content-script.ts
  var mapping = defaultFieldMapping;
  var manualSubmitGuardAttached = false;
  function attachManualSubmitGuard(record) {
    if (manualSubmitGuardAttached) return;
    manualSubmitGuardAttached = true;
    document.addEventListener(
      "click",
      (event) => {
        const submitButton = document.querySelector(mapping.submit);
        const target = event.target;
        if (submitButton && target && (target === submitButton || submitButton.contains(target))) {
          reassertLatLng(mapping, record);
        }
      },
      true
    );
  }
  function send(message) {
    api.runtime.sendMessage(message).catch(() => {
    });
  }
  function handleFillEntry(msg) {
    const { entryIndex, record, mode, entryStatus } = msg;
    const stillMatchesTarget = fieldsMatchRecord(mapping, record);
    if ((entryStatus === "submitting" || entryStatus === "waiting_manual_submit") && !stillMatchesTarget) {
      send({ type: "SUBMISSION_SUCCESS", entryIndex });
      return;
    }
    if (!stillMatchesTarget) {
      const missing = fillTextAndHiddenFields(mapping, record);
      if (missing.length > 0) {
        send({ type: "FILL_RESULT", entryIndex, success: false, missingFields: missing });
        return;
      }
      send({ type: "FILL_RESULT", entryIndex, success: true });
    }
    if (!isOrderStatusChecked(mapping)) {
      reassertLatLng(mapping, record);
      if (!clickElement(mapping.orderStatusRadio)) {
        send({ type: "SUBMISSION_FAILED", entryIndex, reason: "Order Status radio button was not found." });
      }
      return;
    }
    if (!isTechnologyChecked(mapping)) {
      reassertLatLng(mapping, record);
      if (!clickElement(mapping.technologyRadio)) {
        send({ type: "SUBMISSION_FAILED", entryIndex, reason: "Technology radio button was not found." });
      }
      return;
    }
    send({ type: "READY_TO_SUBMIT", entryIndex });
    if (mode === "auto") {
      reassertLatLng(mapping, record);
      if (!clickElement(mapping.submit)) {
        send({ type: "SUBMISSION_FAILED", entryIndex, reason: "Submit button was not found." });
      }
    }
    if (mode === "manual") {
      attachManualSubmitGuard(record);
    }
  }
  function announceReady() {
    const message = { type: "CONTENT_READY", url: window.location.href };
    send(message);
  }
  api.runtime.onMessage.addListener((message) => {
    if (message.type === "FILL_ENTRY") {
      handleFillEntry(message);
    }
    return false;
  });
  announceReady();
})();
//# sourceMappingURL=content.js.map
