(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SubToVoiceLog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MAX_STRING = 700, MAX_ARRAY = 30, MAX_DEPTH = 4;
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let source = "content";
  function clip(text, limit = MAX_STRING) {
    const value = String(text ?? "");
    return value.length <= limit ? value : `${value.slice(0, limit)}…<${value.length}>`;
  }
  function sanitize(value, depth = 0, seen = new WeakSet()) {
    if (value == null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return clip(value);
    if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
    if (typeof value !== "object") return clip(value);
    if (depth >= MAX_DEPTH) return "[MaxDepth]";
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((item) => sanitize(item, depth + 1, seen));
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      try { out[key] = sanitize(item, depth + 1, seen); }
      catch (err) { out[key] = `[Unserializable: ${err?.message || err}]`; }
    }
    return out;
  }
  function setSource(next) { source = String(next || "content"); }
  function event(type, data = {}, level = "info") {
    const payload = { type: String(type || "unknown"), level: String(level || "info"), source, sessionId,
      ts: Date.now(), url: typeof location !== "undefined" ? clip(location.href, 1000) : "", data: sanitize(data) };
    try {
      const result = globalThis.chrome?.runtime?.sendMessage?.({ type: "SUBTOVOICE_LOG_APPEND", entry: payload });
      result?.catch?.(() => {});
    } catch (_) {}
    return payload;
  }
  function error(type, err, data = {}) {
    return event(type, { ...data, error: { name: err?.name || "Error", message: err?.message || String(err || "Unknown error"), stack: err?.stack || "" } }, "error");
  }
  return { clip, error, event, sanitize, sessionId, setSource };
});
