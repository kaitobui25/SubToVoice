(() => {
  "use strict";

  if (window.__SUB_TO_VOICE_LOADED__) return;
  window.__SUB_TO_VOICE_LOADED__ = true;

  const { PhraseBuffer, computeNovelText, normalizeWhitespace } = window.SubToVoiceBuffer;
  const { SpeechController } = window.SubToVoiceSpeech;

  const DEFAULT_SETTINGS = {
    enabled: false,
    lang: "vi-VN",
    voiceName: "",
    rate: 1.25,
    pitch: 1,
    volume: 1,
    bufferDelayMs: 700,
    punctuationDelayMs: 160,
    hardGapMs: 1400,
    maxChars: 180,
    pauseWhenBehind: true,
    duckOriginal: true,
    duckVolume: 0.12,
    skipSoundLabels: true,
  };

  let settings = { ...DEFAULT_SETTINGS };
  let captionRoot = null;
  let captionObserver = null;
  let currentVideo = null;
  let lastVisibleCaption = "";
  let lastUrl = location.href;
  let captureDebounce = null;
  let enabledAt = 0;
  let lastCaptionAt = 0;
  let status = "Tắt";

  const speech = new SpeechController({
    settings,
    onStateChange(snapshot) {
      if (!settings.enabled) return;
      if (snapshot.pausedByUs || snapshot.speaking) status = snapshot.status;
      else if (Date.now() - lastCaptionAt < 2500) status = "Đang nghe phụ đề";
      else status = "Chờ phụ đề";
    },
  });

  const phraseBuffer = new PhraseBuffer({
    ...bufferOptionsFromSettings(settings),
    onFlush(text) {
      if (settings.enabled) speech.enqueue(text);
    },
  });

  function bufferOptionsFromSettings(value) {
    return {
      settleMs: value.bufferDelayMs,
      punctuationMs: value.punctuationDelayMs,
      hardGapMs: value.hardGapMs,
      maxChars: value.maxChars,
      skipSoundLabels: value.skipSoundLabels,
      addTerminalPunctuation: true,
    };
  }

  function updateRuntimeSettings(next) {
    settings = { ...settings, ...next };
    phraseBuffer.updateOptions(bufferOptionsFromSettings(settings));
    speech.updateSettings(settings);
    if (!settings.enabled) stopRuntime();
    else startRuntime();
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
    updateRuntimeSettings({ ...DEFAULT_SETTINGS, ...stored });
  }

  function getVideo() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function getCaptionRoot() {
    return document.querySelector(".ytp-caption-window-container");
  }

  function readVisibleCaption() {
    const root = captionRoot || getCaptionRoot();
    if (!root) return "";
    const segments = [...root.querySelectorAll(".ytp-caption-segment")];
    const text = segments.length
      ? segments.map((segment) => segment.textContent || "").join(" ")
      : root.textContent || "";
    return normalizeWhitespace(text);
  }

  function processCaptionSnapshot() {
    captureDebounce = null;
    if (!settings.enabled) return;
    const current = readVisibleCaption();
    if (!current) return;
    const novel = computeNovelText(lastVisibleCaption, current);
    lastVisibleCaption = current;
    if (!novel) return;
    lastCaptionAt = Date.now();
    status = "Đang gom câu";
    phraseBuffer.push(novel, lastCaptionAt);
  }

  function scheduleCaptionRead() {
    if (captureDebounce) clearTimeout(captureDebounce);
    captureDebounce = setTimeout(processCaptionSnapshot, 45);
  }

  function attachCaptionObserver() {
    const nextRoot = getCaptionRoot();
    if (!nextRoot || nextRoot === captionRoot) return;
    captionObserver?.disconnect();
    captionRoot = nextRoot;
    captionObserver = new MutationObserver(scheduleCaptionRead);
    captionObserver.observe(captionRoot, { childList: true, subtree: true, characterData: true });
    scheduleCaptionRead();
  }

  function attachVideo() {
    const video = getVideo();
    if (!video || video === currentVideo) return;
    if (currentVideo) {
      currentVideo.removeEventListener("seeking", handleSeeking);
      currentVideo.removeEventListener("ended", handleEnded);
    }
    currentVideo = video;
    speech.setVideo(video);
    video.addEventListener("seeking", handleSeeking);
    video.addEventListener("ended", handleEnded);
  }

  function handleSeeking() {
    resetStreamState({ cancelSpeech: true, resumeVideo: false });
    status = "Đã tua · chờ phụ đề";
  }

  function handleEnded() {
    phraseBuffer.flush("video-ended");
  }

  function resetStreamState(options = {}) {
    phraseBuffer.reset();
    lastVisibleCaption = "";
    if (captureDebounce) clearTimeout(captureDebounce);
    captureDebounce = null;
    if (options.cancelSpeech) speech.cancel({ resumeVideo: options.resumeVideo !== false });
  }

  function startRuntime() {
    if (!settings.enabled) return;
    enabledAt ||= Date.now();
    status = "Chờ phụ đề";
    attachVideo();
    attachCaptionObserver();
  }

  function stopRuntime() {
    enabledAt = 0;
    status = "Tắt";
    resetStreamState({ cancelSpeech: true, resumeVideo: true });
  }

  function getRuntimeState() {
    const speechState = speech.snapshot();
    return {
      settings,
      status,
      captionDetected: Boolean(lastCaptionAt && Date.now() - lastCaptionAt < 5000),
      pendingText: phraseBuffer.pendingText(),
      queued: speechState.queued,
      speaking: speechState.speaking,
      pausedByUs: speechState.pausedByUs,
      videoFound: Boolean(currentVideo || getVideo()),
    };
  }

  async function getVoices() {
    let voices = speech.getVoices();
    if (!voices.length && globalThis.speechSynthesis) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        globalThis.speechSynthesis.addEventListener?.("voiceschanged", finish, { once: true });
        setTimeout(finish, 500);
      });
      voices = speech.getVoices();
    }
    return voices.map((voice) => ({
      name: voice.name,
      lang: voice.lang,
      localService: Boolean(voice.localService),
      default: Boolean(voice.default),
    }));
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = message?.type;
    if (type === "SUBTOVOICE_GET_STATE") {
      sendResponse({ ok: true, state: getRuntimeState() });
      return;
    }
    if (type === "SUBTOVOICE_GET_VOICES") {
      getVoices().then((voices) => sendResponse({ ok: true, voices }));
      return true;
    }
    if (type === "SUBTOVOICE_SET_ENABLED") {
      const enabled = Boolean(message.enabled);
      chrome.storage.local.set({ enabled }).then(() => {
        updateRuntimeSettings({ enabled });
        sendResponse({ ok: true, state: getRuntimeState() });
      });
      return true;
    }
    if (type === "SUBTOVOICE_UPDATE_SETTINGS") {
      const next = message.settings || {};
      chrome.storage.local.set(next).then(() => {
        updateRuntimeSettings(next);
        sendResponse({ ok: true, state: getRuntimeState() });
      });
      return true;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const next = {};
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) next[key] = change.newValue;
    }
    if (Object.keys(next).length) updateRuntimeSettings(next);
  });

  setInterval(() => {
    if (!settings.enabled) return;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      resetStreamState({ cancelSpeech: true, resumeVideo: true });
      captionRoot = null;
      captionObserver?.disconnect();
      captionObserver = null;
      currentVideo = null;
      lastCaptionAt = 0;
      enabledAt = Date.now();
    }
    attachVideo();
    attachCaptionObserver();
    if (Date.now() - enabledAt > 1000 && Date.now() - lastCaptionAt > 5000 && !speech.speaking) {
      status = "Chờ phụ đề";
    }
  }, 900);

  loadSettings().catch(() => {
    settings = { ...DEFAULT_SETTINGS };
  });
})();
