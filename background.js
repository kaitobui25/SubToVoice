"use strict";

const LOG_KEY = "subtovoiceDebugLog";
const MAX_ENTRIES = 8000;
const FLUSH_DELAY_MS = 200;
const FORMAT_VERSION = 1;
let pending = [];
let flushTimer = null;
let flushPromise = Promise.resolve();
let loggingEnabled = true;

chrome.storage.local.get({ debugLogging: true }).then(({ debugLogging }) => {
  loggingEnabled = debugLogging !== false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.debugLogging) return;
  loggingEnabled = changes.debugLogging.newValue !== false;
  if (!loggingEnabled) void flushPending();
});

function baseStore() {
  return { formatVersion: FORMAT_VERSION, nextSeq: 1, updatedAt: null, entries: [] };
}

function safeEntry(entry) {
  return {
    type: String(entry?.type || "unknown"),
    level: String(entry?.level || "info"),
    source: String(entry?.source || "unknown"),
    sessionId: String(entry?.sessionId || ""),
    ts: Number(entry?.ts || Date.now()),
    url: String(entry?.url || "").slice(0, 1200),
    data: entry?.data && typeof entry.data === "object" ? entry.data : {},
  };
}

function queueEntry(entry) {
  if (!loggingEnabled) return;
  pending.push(safeEntry(entry));
  if (pending.length >= 40) void flushPending();
  else if (!flushTimer) flushTimer = setTimeout(() => void flushPending(), FLUSH_DELAY_MS);
}

function flushPending() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (!pending.length) return flushPromise;
  const batch = pending;
  pending = [];
  flushPromise = flushPromise.then(async () => {
    const result = await chrome.storage.local.get(LOG_KEY);
    const store = result[LOG_KEY] && typeof result[LOG_KEY] === "object" ? result[LOG_KEY] : baseStore();
    store.entries = Array.isArray(store.entries) ? store.entries : [];
    store.nextSeq = Number(store.nextSeq || 1);
    for (const entry of batch) store.entries.push({ seq: store.nextSeq++, ...entry });
    if (store.entries.length > MAX_ENTRIES) store.entries = store.entries.slice(-MAX_ENTRIES);
    store.formatVersion = FORMAT_VERSION;
    store.updatedAt = new Date().toISOString();
    await chrome.storage.local.set({ [LOG_KEY]: store });
  }).catch(() => {});
  return flushPromise;
}

function backgroundEvent(type, data = {}, level = "info") {
  queueEntry({ type, level, source: "background", sessionId: "background", ts: Date.now(), url: "", data });
}

chrome.runtime.onInstalled.addListener((details) => {
  backgroundEvent("extension.installed", {
    reason: details.reason,
    previousVersion: details.previousVersion || "",
    version: chrome.runtime.getManifest().version,
  });
});

chrome.runtime.onStartup.addListener(() => {
  backgroundEvent("extension.startup", { version: chrome.runtime.getManifest().version });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SUBTOVOICE_LOG_APPEND") {
    if (loggingEnabled) {
      const entry = safeEntry(message.entry);
      entry.data = { ...entry.data, sender: { tabId: sender.tab?.id ?? null, frameId: sender.frameId ?? null } };
      queueEntry(entry);
    }
    sendResponse?.({ ok: true, enabled: loggingEnabled });
    return;
  }

  if (message?.type === "SUBTOVOICE_LOG_GET") {
    flushPending().then(async () => {
      const result = await chrome.storage.local.get(LOG_KEY);
      sendResponse({ ok: true, log: result[LOG_KEY] || baseStore(), enabled: loggingEnabled });
    }).catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (message?.type === "SUBTOVOICE_LOG_CLEAR") {
    pending = [];
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    flushPromise = flushPromise.then(() => chrome.storage.local.set({ [LOG_KEY]: baseStore() }));
    flushPromise.then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (message?.type === "SUBTOVOICE_LOG_MARK") {
    backgroundEvent("user.bug_mark", { note: String(message.note || "BUG").slice(0, 300) }, "warn");
    void flushPending().then(() => sendResponse({ ok: true, enabled: loggingEnabled }));
    return true;
  }
});

backgroundEvent("background.loaded", { version: chrome.runtime.getManifest().version });
