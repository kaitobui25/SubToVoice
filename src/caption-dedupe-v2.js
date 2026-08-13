(function (root, factory) {
  const base = root.SubToVoiceBuffer || (typeof require === "function" ? require("./subtitle-buffer.js") : null);
  const api = factory(base, root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (base) {
    base.computeNovelText = api.computeNovelText;
    base.stripYouTubeCaptionInfoOverlay = api.stripYouTubeCaptionInfoOverlay;
  }
  root.SubToVoiceCaptionDedupe = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (base, root) {
  "use strict";

  if (!base) throw new Error("SubToVoiceBuffer must load before caption-dedupe-v2.js");

  const { normalizeWhitespace } = base;
  const TRAILING_PUNCTUATION = /([,.;:!?。！？，、；：…]+)$/u;
  const KNOWN_AUTO_LANGUAGES = [
    "English", "Vietnamese", "Japanese", "Korean", "Chinese", "Spanish", "French", "German",
    "Italian", "Portuguese", "Russian", "Ukrainian", "Indonesian", "Thai", "Hindi", "Arabic",
    "Dutch", "Polish", "Turkish", "Swedish", "Norwegian", "Danish", "Finnish",
  ];
  const languagePattern = KNOWN_AUTO_LANGUAGES.join("|");
  const YOUTUBE_INFO_OVERLAY = new RegExp(
    `\\s(?:${languagePattern})\\s*\\(auto[- ]generated\\)\\s*(?:(?:>>|›|→)\\s*[\\p{L} ()-]{1,80})?\\s*Click for settings\\s*$`,
    "iu",
  );

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

  function stripYouTubeCaptionInfoOverlay(text) {
    const clean = normalizeWhitespace(text);
    const stripped = normalizeWhitespace(clean.replace(YOUTUBE_INFO_OVERLAY, ""));
    if (stripped !== clean) {
      try {
        root.SubToVoiceLog?.event?.("caption.info-overlay.stripped", { before: clean, after: stripped });
      } catch (_) {}
    }
    return stripped;
  }

  function wordEntries(text) {
    const rawTokens = tokenize(text);
    const words = [];
    rawTokens.forEach((raw, rawIndex) => {
      const key = comparableToken(raw);
      if (key) words.push({ key, rawIndex });
    });
    return { rawTokens, words };
  }

  function computeNovelText(previousText, currentText) {
    const previous = stripYouTubeCaptionInfoOverlay(previousText);
    const current = stripYouTubeCaptionInfoOverlay(currentText);
    if (!current || current === previous) return "";
    if (!previous) return current;

    const previousData = wordEntries(previous);
    const currentData = wordEntries(current);
    const previousWords = previousData.words.map((entry) => entry.key);
    const currentWords = currentData.words.map((entry) => entry.key);

    if (previousWords.length === currentWords.length
        && previousWords.every((word, index) => word === currentWords[index])) {
      const before = trailingPunctuation(previous);
      const after = trailingPunctuation(current);
      if (after && after !== before && after.startsWith(before)) return after.slice(before.length);
      return "";
    }

    if (previousWords.length
        && previousWords.length <= currentWords.length
        && previousWords.every((word, index) => word === currentWords[index])) {
      const lastMatchedRawIndex = currentData.words[previousWords.length - 1].rawIndex;
      return normalizeWhitespace(currentData.rawTokens.slice(lastMatchedRawIndex + 1).join(" "));
    }

    const maxOverlap = Math.min(previousWords.length, currentWords.length);
    for (let overlap = maxOverlap; overlap >= 2; overlap -= 1) {
      let matches = true;
      for (let index = 0; index < overlap; index += 1) {
        if (previousWords[previousWords.length - overlap + index] !== currentWords[index]) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;
      if (overlap === currentWords.length) return "";
      const lastMatchedRawIndex = currentData.words[overlap - 1].rawIndex;
      return normalizeWhitespace(currentData.rawTokens.slice(lastMatchedRawIndex + 1).join(" "));
    }

    // Conservative fallback: if overlap is ambiguous, repeat rather than drop potentially real speech.
    return current;
  }

  return { computeNovelText, stripYouTubeCaptionInfoOverlay };
});
