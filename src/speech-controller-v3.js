(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SubToVoiceSpeech = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const log = (type, data = {}, level = "info") => globalThis.SubToVoiceLog?.event?.(type, data, level);
  const logError = (type, err, data = {}) => globalThis.SubToVoiceLog?.error?.(type, err, data);

  class SpeechController {
    constructor(options = {}) {
      this.video = null;
      this.queue = [];
      this.speaking = false;
      this.currentUtterance = null;
      this.currentStartedAt = 0;
      this.pausedByUs = false;
      this.originalVideoVolume = null;
      this.onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : () => {};
      this.settings = {};
      this.updateSettings(options.settings || {});
      log("speech.controller.created", { settings: this.settings });
    }

    _videoState() {
      const video = this.video;
      return video ? {
        currentTime: Number(video.currentTime || 0), paused: Boolean(video.paused), ended: Boolean(video.ended),
        volume: Number(video.volume ?? 0), playbackRate: Number(video.playbackRate || 1),
      } : null;
    }

    updateSettings(settings = {}) {
      this.settings = {
        lang: settings.lang || this.settings.lang || "vi-VN",
        voiceName: settings.voiceName ?? this.settings.voiceName ?? "",
        rate: Number(settings.rate ?? this.settings.rate ?? 1.25),
        pitch: Number(settings.pitch ?? this.settings.pitch ?? 1),
        volume: Number(settings.volume ?? this.settings.volume ?? 1),
        pauseWhenBehind: settings.pauseWhenBehind ?? this.settings.pauseWhenBehind ?? true,
        duckOriginal: settings.duckOriginal ?? this.settings.duckOriginal ?? true,
        duckVolume: Number(settings.duckVolume ?? this.settings.duckVolume ?? 0.12),
      };
      log("speech.settings.updated", { settings: this.settings });
    }

    setVideo(video) {
      if (this.video === video) return;
      this._restoreVideoVolume();
      this.video = video || null;
      this.pausedByUs = false;
      log("speech.video.attached", { video: this._videoState() });
    }

    getVoices() {
      const synth = globalThis.speechSynthesis;
      if (!synth) return [];
      const wanted = String(this.settings.lang || "").toLowerCase();
      const base = wanted.split("-")[0];
      return synth.getVoices().slice().sort((a, b) => {
        const aLang = String(a.lang || "").toLowerCase();
        const bLang = String(b.lang || "").toLowerCase();
        return Number(!aLang.startsWith(base)) - Number(!bLang.startsWith(base)) || String(a.name).localeCompare(String(b.name));
      });
    }

    _selectVoice() {
      const voices = this.getVoices();
      if (!voices.length) return null;
      if (this.settings.voiceName) {
        const exact = voices.find((voice) => voice.name === this.settings.voiceName);
        if (exact) return exact;
      }
      const lang = String(this.settings.lang || "").toLowerCase();
      const base = lang.split("-")[0];
      return voices.find((v) => String(v.lang || "").toLowerCase() === lang)
        || voices.find((v) => String(v.lang || "").toLowerCase().startsWith(`${base}-`))
        || voices[0];
    }

    enqueue(text) {
      const clean = String(text || "").trim();
      if (!clean) return;
      this.queue.push(clean);
      log("speech.queue.enqueue", { text: clean, queued: this.queue.length, speaking: this.speaking, pausedByUs: this.pausedByUs, video: this._videoState() });
      if (this.speaking && this.settings.pauseWhenBehind) this._pauseVideoForBacklog("enqueue-while-speaking");
      this._emitState();
      this._pump();
    }

    _pauseVideoForBacklog(reason = "backlog") {
      const video = this.video;
      if (!video) return log("video.pause.skipped", { reason: "no-video" }, "warn");
      if (video.paused || video.ended || this.pausedByUs) {
        return log("video.pause.skipped", { reason, video: this._videoState(), pausedByUs: this.pausedByUs });
      }
      this.pausedByUs = true;
      log("video.pause.request", { reason, queued: this.queue.length, currentText: this.currentUtterance?.text || "", video: this._videoState() }, "warn");
      try {
        video.pause();
        log("video.pause.applied", { video: this._videoState() });
      } catch (err) { logError("video.pause.error", err, { reason }); }
      this._emitState();
    }

    _resumeVideoIfNeeded(reason = "caught-up") {
      const video = this.video;
      if (!video || !this.pausedByUs) return;
      this.pausedByUs = false;
      if (video.ended) return log("video.resume.skipped", { reason: "ended" });
      log("video.resume.request", { reason, queued: this.queue.length, speaking: this.speaking, currentText: this.currentUtterance?.text || "", video: this._videoState() }, "warn");
      try {
        const result = video.play();
        result?.then?.(() => log("video.resume.applied", { reason, video: this._videoState() }))
          ?.catch?.((err) => logError("video.resume.error", err, { reason }));
      } catch (err) { logError("video.resume.error", err, { reason }); }
    }

    _duckVideoVolume() {
      const video = this.video;
      if (!video || !this.settings.duckOriginal) return;
      if (this.originalVideoVolume == null) this.originalVideoVolume = video.volume;
      const before = video.volume;
      video.volume = Math.min(video.volume, Math.max(0, Math.min(1, this.settings.duckVolume)));
      if (before !== video.volume) log("video.volume.duck", { before, after: video.volume });
    }

    _restoreVideoVolume() {
      if (this.video && this.originalVideoVolume != null) {
        const before = this.video.volume;
        this.video.volume = Math.max(0, Math.min(1, this.originalVideoVolume));
        log("video.volume.restore", { before, after: this.video.volume });
      }
      this.originalVideoVolume = null;
    }

    _pump() {
      if (this.speaking || !this.queue.length) return;
      const synth = globalThis.speechSynthesis;
      if (!synth || typeof globalThis.SpeechSynthesisUtterance !== "function") {
        log("tts.unavailable", { queuedDropped: this.queue.length }, "error");
        this.queue = [];
        this._emitState("TTS unavailable");
        return;
      }

      const text = this.queue.shift();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = this._selectVoice();
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || this.settings.lang || "vi-VN";
      utterance.rate = Math.max(0.5, Math.min(3, this.settings.rate));
      utterance.pitch = Math.max(0.5, Math.min(2, this.settings.pitch));
      utterance.volume = Math.max(0, Math.min(1, this.settings.volume));

      this.currentUtterance = utterance;
      this.currentStartedAt = Date.now();
      this.speaking = true;
      this._duckVideoVolume();
      if (this.pausedByUs && this.queue.length === 0) this._resumeVideoIfNeeded("last-backlog-started");

      log("tts.start", {
        text, queuedAfterShift: this.queue.length, voice: voice ? { name: voice.name, lang: voice.lang } : null,
        rate: utterance.rate, pitch: utterance.pitch, volume: utterance.volume, video: this._videoState(), pausedByUs: this.pausedByUs,
      });
      this._emitState();

      const finish = (kind, err = null) => {
        if (this.currentUtterance !== utterance) {
          log("tts.finish.ignored", { kind, text, reason: "stale-utterance" }, "warn");
          return;
        }
        const elapsedMs = Date.now() - this.currentStartedAt;
        if (err) logError("tts.error", err, { text, elapsedMs, queued: this.queue.length, video: this._videoState() });
        else log("tts.end", { text, elapsedMs, queued: this.queue.length, video: this._videoState() });
        this.currentUtterance = null;
        this.currentStartedAt = 0;
        this.speaking = false;
        if (this.queue.length) this._pump();
        else {
          this._restoreVideoVolume();
          this._resumeVideoIfNeeded("queue-empty");
          this._emitState();
        }
      };

      utterance.onend = () => finish("end");
      utterance.onerror = (event) => finish("error", event?.error ? new Error(String(event.error)) : new Error("Speech synthesis error"));
      try { synth.speak(utterance); }
      catch (err) { finish("throw", err); }
    }

    cancel(options = {}) {
      log("speech.cancel", { queuedDropped: this.queue.length, speaking: this.speaking, resumeVideo: options.resumeVideo !== false, video: this._videoState() }, "warn");
      this.queue = [];
      this.currentUtterance = null;
      this.currentStartedAt = 0;
      this.speaking = false;
      try { globalThis.speechSynthesis?.cancel(); } catch (err) { logError("speech.cancel.error", err); }
      this._restoreVideoVolume();
      if (options.resumeVideo !== false) this._resumeVideoIfNeeded("cancel");
      else this.pausedByUs = false;
      this._emitState();
    }

    snapshot(extraStatus = "") {
      return {
        speaking: this.speaking,
        queued: this.queue.length,
        pausedByUs: this.pausedByUs,
        currentText: this.currentUtterance?.text || "",
        status: extraStatus || (this.pausedByUs ? "Đang giữ video để đọc kịp" : this.speaking ? "Đang đọc" : "Sẵn sàng"),
      };
    }

    _emitState(extraStatus = "") { this.onStateChange(this.snapshot(extraStatus)); }
  }

  return { SpeechController };
});
