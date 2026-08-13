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
  const TERMINAL_BOUNDARY = /[.!?。！？…]+[\]})"'”’»]*(?=\s|$)/gu;
  const SOFT_BOUNDARY = /[,;:，、；：]+(?=\s|$)/gu;
  const SOUND_ONLY = /^(?:[\[（(【].{0,30}(?:music|applause|laughter|laughs|cheering|音楽|拍手|笑|音乐|掌声|tiếng nhạc|nhạc|vỗ tay|cười).{0,30}[\]）)】]|[♪♫♬\s]+)$/iu;
  const VIETNAMESE_CONTINUATION_WORDS = new Set([
    "ai", "bằng", "bị", "bởi", "các", "cho", "có", "của", "cũng", "đang", "để", "được",
    "giống", "hay", "hoặc", "khi", "là", "mà", "một", "nhận", "như", "những", "nếu", "ra",
    "rằng", "sẽ", "thì", "thấy", "theo", "trên", "trong", "từ", "và", "về", "vì", "với",
  ]);

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

  function shouldDeferSettled(text) {
    const clean = normalizeWhitespace(text);
    if (!clean || TERMINAL_PUNCTUATION.test(clean)) return false;
    if (SOFT_ENDING_PUNCTUATION.test(clean)) return true;

    const words = canonicalWords(clean);
    if (!words.length) return false;
    if (words.length <= 4) return true;
    return VIETNAMESE_CONTINUATION_WORDS.has(words[words.length - 1]);
  }

  function boundaryEnds(text, pattern, minEnd, maxEnd) {
    const hits = [];
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const end = match.index + match[0].length;
      if (end >= minEnd && end <= maxEnd) hits.push(end);
    }
    return hits;
  }

  function splitForMaxLength(text, maxChars) {
    const clean = normalizeWhitespace(text);
    const limit = Math.max(1, Number(maxChars) || 1);
    if (clean.length <= limit) return null;

    const minCut = Math.max(1, Math.floor(limit * 0.6));
    const overflow = Math.max(24, Math.floor(limit * 0.2));
    const lookAheadEnd = Math.min(clean.length, limit + overflow);

    const terminalBefore = boundaryEnds(clean, TERMINAL_BOUNDARY, minCut, limit);
    const softBefore = boundaryEnds(clean, SOFT_BOUNDARY, minCut, limit);
    let cut = terminalBefore.at(-1) || softBefore.at(-1) || 0;

    if (!cut) {
      const terminalAhead = boundaryEnds(clean, TERMINAL_BOUNDARY, limit + 1, lookAheadEnd);
      const softAhead = boundaryEnds(clean, SOFT_BOUNDARY, limit + 1, lookAheadEnd);
      cut = terminalAhead[0] || softAhead[0] || 0;
    }

    // maxChars is a soft ceiling. Give the caption a little room to finish a phrase
    // before falling back to a plain word boundary.
    if (!cut && clean.length <= limit + overflow) return null;

    if (!cut) {
      const spaceBefore = clean.lastIndexOf(" ", limit);
      if (spaceBefore >= minCut) cut = spaceBefore;
      else {
        const spaceAhead = clean.indexOf(" ", limit);
        if (spaceAhead > 0 && spaceAhead <= lookAheadEnd) cut = spaceAhead;
      }
    }

    if (!cut) cut = limit;
    const head = normalizeWhitespace(clean.slice(0, cut));
    const tail = normalizeWhitespace(clean.slice(cut));
    if (!head || !tail) return null;
    return { head, tail };
  }

  class PhraseBuffer {
    constructor(options = {}) {
      this.onFlush = typeof options.onFlush === "function" ? options.onFlush : () => {};
      this.settleMs = Number(options.settleMs ?? 700);
      this.punctuationMs = Number(options.punctuationMs ?? 160);
      this.hardGapMs = Number(options.hardGapMs ?? 1400);
      this.incompleteSettleMs = Number(options.incompleteSettleMs ?? 4500);
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
      if (options.incompleteSettleMs != null) this.incompleteSettleMs = Number(options.incompleteSettleMs);
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

      if (!this.settlingPaused && this.text && this.lastInputAt) {
        const gapMs = nowMs - this.lastInputAt;
        const holdIncomplete = shouldDeferSettled(this.text) && gapMs < this.incompleteSettleMs;
        if (gapMs >= this.hardGapMs && !holdIncomplete) this.flush("gap");
      }

      this.text = smartJoin(this.text, clean);
      this._flushSafeMaxLengthChunks();
      this.lastInputAt = nowMs;
      this._schedule(this._settleDelay());
      return true;
    }

    _flushSafeMaxLengthChunks() {
      while (this.text.length > this.maxChars) {
        const split = splitForMaxLength(this.text, this.maxChars);
        if (!split) return;
        this.text = split.tail;
        this._emit(split.head, "max-length", false);
      }
    }

    _settleDelay() {
      if (TERMINAL_PUNCTUATION.test(this.text)) return this.punctuationMs;
      if (shouldDeferSettled(this.text)) return Math.max(this.settleMs, this.incompleteSettleMs);
      return this.settleMs;
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

    _emit(rawText, reason, addTerminalPunctuation = this.addTerminalPunctuation) {
      const raw = normalizeWhitespace(rawText);
      if (!raw) return "";
      const spoken = addTerminalPunctuation ? ensureTerminalPunctuation(raw) : raw;
      this.onFlush(spoken, reason);
      return spoken;
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
      return this._emit(raw, reason, reason === "max-length" ? false : this.addTerminalPunctuation);
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
    shouldDeferSettled,
    smartJoin,
    splitForMaxLength,
  };
});
