(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SubToVoiceBuffer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TERMINAL_PUNCTUATION = /[.!?。！？…]+[\]})"'”’»]*$/u;
  const ONLY_PUNCTUATION = /^[,.;:!?。！？，、；：…]+$/u;
  const TRAILING_PUNCTUATION = /([,.;:!?。！？，、；：…]+)$/u;
  const SOFT_ENDING_PUNCTUATION = /[,;:，、；：]+$/u;
  const SOUND_ONLY = /^(?:[\[（(【].{0,30}(?:music|applause|laughter|laughs|cheering|音楽|拍手|笑|音乐|掌声|tiếng nhạc|nhạc|vỗ tay|cười).{0,30}[\]）)】]|[♪♫♬\s]+)$/iu;

  function normalizeWhitespace(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function comparableToken(token) {
    return String(token || "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
  }

  function tokenize(text) {
    return normalizeWhitespace(text).split(/\s+/).filter(Boolean);
  }

  function trailingPunctuation(text) {
    const match = normalizeWhitespace(text).match(TRAILING_PUNCTUATION);
    return match ? match[1] : "";
  }

  function canonicalWords(text) {
    return tokenize(text).map(comparableToken).filter(Boolean);
  }

  function arraysEqual(a, b) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function computeNovelText(previousText, currentText) {
    const previous = normalizeWhitespace(previousText);
    const current = normalizeWhitespace(currentText);
    if (!current || current === previous) return "";
    if (!previous) return current;

    const previousWords = canonicalWords(previous);
    const currentWords = canonicalWords(current);

    if (arraysEqual(previousWords, currentWords)) {
      const before = trailingPunctuation(previous);
      const after = trailingPunctuation(current);
      if (after && after !== before && after.startsWith(before)) {
        return after.slice(before.length);
      }
      return "";
    }

    if (current.startsWith(previous)) {
      return normalizeWhitespace(current.slice(previous.length));
    }

    if (TERMINAL_PUNCTUATION.test(previous)) {
      return current;
    }

    const previousTokens = tokenize(previous);
    const currentTokens = tokenize(current);
    const previousComparable = previousTokens.map(comparableToken);
    const currentComparable = currentTokens.map(comparableToken);
    const maxOverlap = Math.min(previousTokens.length, currentTokens.length);

    for (let overlap = maxOverlap; overlap >= 1; overlap -= 1) {
      let matches = true;
      for (let index = 0; index < overlap; index += 1) {
        const left = previousComparable[previousComparable.length - overlap + index];
        const right = currentComparable[index];
        if (!left || !right || left !== right) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return normalizeWhitespace(currentTokens.slice(overlap).join(" "));
      }
    }

    return current;
  }

  function smartJoin(left, right) {
    const a = normalizeWhitespace(left);
    const b = normalizeWhitespace(right);
    if (!a) return b;
    if (!b) return a;
    if (ONLY_PUNCTUATION.test(b) || /^[,.;:!?。！？，、；：…]/u.test(b)) {
      return `${a}${b}`;
    }
    if (/[([{“‘«]$/u.test(a)) return `${a}${b}`;
    return `${a} ${b}`;
  }

  function isSoundOnly(text) {
    const clean = normalizeWhitespace(text);
    return Boolean(clean && SOUND_ONLY.test(clean));
  }

  function ensureTerminalPunctuation(text) {
    const clean = normalizeWhitespace(text);
    if (!clean || TERMINAL_PUNCTUATION.test(clean)) return clean;
    if (SOFT_ENDING_PUNCTUATION.test(clean)) return clean.replace(SOFT_ENDING_PUNCTUATION, ".");
    return `${clean}.`;
  }

  class PhraseBuffer {
    constructor(options = {}) {
      this.onFlush = typeof options.onFlush === "function" ? options.onFlush : () => {};
      this.settleMs = Number(options.settleMs ?? 700);
      this.punctuationMs = Number(options.punctuationMs ?? 160);
      this.hardGapMs = Number(options.hardGapMs ?? 1400);
      this.maxChars = Number(options.maxChars ?? 180);
      this.skipSoundLabels = options.skipSoundLabels !== false;
      this.addTerminalPunctuation = options.addTerminalPunctuation !== false;
      this.text = "";
      this.lastInputAt = 0;
      this.timer = null;
      this.settlingPaused = false;
      this.settlingPausedAt = 0;
    }

    updateOptions(options = {}) {
      if (options.settleMs != null) this.settleMs = Number(options.settleMs);
      if (options.punctuationMs != null) this.punctuationMs = Number(options.punctuationMs);
      if (options.hardGapMs != null) this.hardGapMs = Number(options.hardGapMs);
      if (options.maxChars != null) this.maxChars = Number(options.maxChars);
      if (options.skipSoundLabels != null) this.skipSoundLabels = Boolean(options.skipSoundLabels);
      if (options.addTerminalPunctuation != null) {
        this.addTerminalPunctuation = Boolean(options.addTerminalPunctuation);
      }
    }

    push(input, nowMs = Date.now()) {
      const clean = normalizeWhitespace(input);
      if (!clean) return false;
      if (this.skipSoundLabels && isSoundOnly(clean)) return false;

      if (!this.settlingPaused && this.text && this.lastInputAt && nowMs - this.lastInputAt >= this.hardGapMs) {
        this.flush("gap");
      }

      if (this.text && this.text.length + clean.length + 1 > this.maxChars) {
        this.flush("max-length");
      }

      this.text = smartJoin(this.text, clean);
      this.lastInputAt = nowMs;
      this._schedule(this._settleDelay());
      return true;
    }

    _settleDelay() {
      return TERMINAL_PUNCTUATION.test(this.text) ? this.punctuationMs : this.settleMs;
    }

    _schedule(delayMs) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (this.settlingPaused || !this.text) return;
      this.timer = setTimeout(() => this.flush("settled"), Math.max(0, delayMs));
    }

    setSettlingPaused(paused, nowMs = Date.now()) {
      const next = Boolean(paused);
      if (next === this.settlingPaused) return;

      if (next) {
        this.settlingPaused = true;
        this.settlingPausedAt = nowMs;
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        return;
      }

      const pausedAt = this.settlingPausedAt;
      this.settlingPaused = false;
      this.settlingPausedAt = 0;
      if (this.lastInputAt && pausedAt) {
        const excludedPauseMs = Math.max(0, nowMs - Math.max(pausedAt, this.lastInputAt));
        this.lastInputAt += excludedPauseMs;
      }
      if (this.text) this._schedule(this._settleDelay());
    }

    flush(reason = "manual") {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      const raw = normalizeWhitespace(this.text);
      this.text = "";
      this.lastInputAt = 0;
      if (!raw) return "";
      const spoken = this.addTerminalPunctuation ? ensureTerminalPunctuation(raw) : raw;
      this.onFlush(spoken, reason);
      return spoken;
    }

    reset() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.text = "";
      this.lastInputAt = 0;
      this.settlingPaused = false;
      this.settlingPausedAt = 0;
    }

    pendingText() {
      return this.text;
    }
  }

  return {
    PhraseBuffer,
    canonicalWords,
    computeNovelText,
    ensureTerminalPunctuation,
    isSoundOnly,
    normalizeWhitespace,
    smartJoin,
  };
});
