import type { FieldMapping } from '../config/field-mapping';
import type { EntryRecord } from '../types/messages';

/**
 * Sets an input's value the way a real user's keystrokes would be observed,
 * not just `element.value = x`. Frameworks that install their own setter on
 * the element instance (React, etc.) intercept a plain `.value =`
 * assignment, so we call the native prototype setter directly first, then
 * dispatch `input`/`change` so any such listener still picks it up. Also
 * works for the ASP.NET postback form here, which just reads .value on
 * submit - dispatching the events is harmless extra correctness for free.
 */
function setNativeValue(element: HTMLInputElement, value: string): void {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  const nativeSetter = descriptor?.set;

  if (nativeSetter) {
    nativeSetter.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

const TEXT_FIELD_KEYS = ['exchange', 'name', 'address', 'contact', 'competition', 'email'] as const;

function textSelectorFor(mapping: FieldMapping, key: (typeof TEXT_FIELD_KEYS)[number]): string {
  switch (key) {
    case 'exchange':
      return mapping.exchange;
    case 'name':
      return mapping.name;
    case 'address':
      return mapping.address;
    case 'contact':
      return mapping.contact;
    case 'competition':
      return mapping.competition;
    case 'email':
      return mapping.email;
  }
}

function recordValueFor(record: EntryRecord, key: (typeof TEXT_FIELD_KEYS)[number]): string {
  switch (key) {
    case 'exchange':
      return record.exchange;
    case 'name':
      return record.name;
    case 'address':
      return record.address;
    case 'contact':
      return record.contact;
    case 'competition':
      return record.competition;
    case 'email':
      return record.email;
  }
}

/**
 * True only if every text field, the region dropdown, AND the hidden
 * lat/lng fields already match the target record. Radios are checked
 * separately (isOrderStatusChecked/isTechnologyChecked) since they don't
 * have a "value equals X" notion the same way.
 */
export function fieldsMatchRecord(mapping: FieldMapping, record: EntryRecord): boolean {
  for (const key of TEXT_FIELD_KEYS) {
    const el = document.querySelector<HTMLInputElement>(textSelectorFor(mapping, key));
    if (!el || el.value !== recordValueFor(record, key)) return false;
  }
  const region = document.querySelector<HTMLSelectElement>(mapping.region);
  if (!region || region.value !== record.region) return false;

  const latHidden = document.querySelector<HTMLInputElement>(mapping.latHidden);
  const lngHidden = document.querySelector<HTMLInputElement>(mapping.lngHidden);
  if (!latHidden || latHidden.value !== record.lat) return false;
  if (!lngHidden || lngHidden.value !== record.lng) return false;

  return true;
}

/**
 * Sets ONLY the lat/lng fields (hidden + disabled display pair), always
 * unconditionally (not just when they look wrong). The real PTCL page runs
 * its own script on every load that calls navigator.geolocation.getCurrentPosition()
 * and overwrites these exact fields whenever that resolves - which can
 * happen at any time, including right after we first fill them. Calling
 * this again immediately before every click (see content-script.ts) closes
 * that race: JS is single-threaded, so nothing can slip in between this
 * synchronous re-assertion and the click that immediately follows it in the
 * same function call.
 */
export function reassertLatLng(mapping: FieldMapping, record: EntryRecord): string[] {
  const missing: string[] = [];
  for (const [selector, value] of [
    [mapping.latHidden, record.lat],
    [mapping.lngHidden, record.lng],
    [mapping.latDisplay, record.lat],
    [mapping.lngDisplay, record.lng],
  ] as const) {
    const el = document.querySelector<HTMLInputElement>(selector);
    if (!el) {
      missing.push(selector);
      continue;
    }
    setNativeValue(el, value);
  }
  return missing;
}

/**
 * Fills the region dropdown, every text field, and the lat/lng pair
 * (hidden fields that actually get submitted, plus the disabled display
 * boxes next to them so the value is visible to a human in manual mode).
 * Returns the list of selectors that couldn't be found (empty = all good).
 */
export function fillTextAndHiddenFields(mapping: FieldMapping, record: EntryRecord): string[] {
  const missing: string[] = [];

  const region = document.querySelector<HTMLSelectElement>(mapping.region);
  if (!region) {
    missing.push('region');
  } else if (region.value !== record.region) {
    region.value = record.region;
    region.dispatchEvent(new Event('change', { bubbles: true }));
  }

  for (const key of TEXT_FIELD_KEYS) {
    const selector = textSelectorFor(mapping, key);
    const el = document.querySelector<HTMLInputElement>(selector);
    if (!el) {
      missing.push(key);
      continue;
    }
    const value = recordValueFor(record, key);
    if (el.value !== value) setNativeValue(el, value);
  }

  missing.push(...reassertLatLng(mapping, record));

  return missing;
}

export function isOrderStatusChecked(mapping: FieldMapping): boolean {
  return document.querySelector<HTMLInputElement>(mapping.orderStatusRadio)?.checked ?? false;
}

export function isTechnologyChecked(mapping: FieldMapping): boolean {
  return document.querySelector<HTMLInputElement>(mapping.technologyRadio)?.checked ?? false;
}

/** Returns false if the element wasn't found (caller reports that as a failure). */
export function clickElement(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return false;
  el.click();
  return true;
}
