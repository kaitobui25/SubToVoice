(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SubToVoiceSpeech = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class SpeechController {
    constructor(options = {}) {
      this.video = null;
      this.queue = [];
      this.speaking = false;
      this.currentUtterance = null;
      this.pausedByUs = false;
      this.pauseRequestedAt = 0;
      this.originalVideoVolume = null;
      this.onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : () => {};
      this.settings = {};
      this.updateSettings(options.settings || {});
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
    }

    setVideo(video) {
      if (this.video === video) return;
      this._restoreVideoVolume();
      this.video = video || null;
      this.pausedByUs = false;
    }

    getVoices() {
      const synth = globalThis.speechSynthesis;
      if (!synth) return [];
      return synth.getVoices().slice().sort((a, b) => {
        const wanted = String(this.settings.lang || "").toLowerCase();
        const aScore = String(a.lang || "").toLowerCase().startsWith(wanted.split("-")[0]) ? 0 : 1;
        const bScore = String(b.lang || "").toLowerCase().startsWith(wanted.split("-")[0]) ? 0 : 1;
        return aScore - bScore || String(a.name).localeCompare(String(b.name));
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
      return (
        voices.find((voice) => String(voice.lang || "").toLowerCase() === lang) ||
        voices.find((voice) => String(voice.lang || "").toLowerCase().startsWith(`${base}-`)) ||
        voices[0]
      );
    }

    enqueue(text) {
      const clean = String(text || "").trim();
      if (!clean) return;
      this.queue.push(clean);

      if (this.speaking && this.settings.pauseWhenBehind && this.queue.length > 0) {
        this._pauseVideoForBacklog();
      }

      this._emitState();
      this._pump();
    }

    _pauseVideoForBacklog() {
      const video = this.video;
      if (!video || video.paused || video.ended || this.pausedByUs) return;
      this.pausedByUs = true;
      this.pauseRequestedAt = Date.now();
      try {
        video.pause();
      } catch (_) {}
      this._emitState();
    }

    _resumeVideoIfNeeded() {
      const video = this.video;
      if (!video || !this.pausedByUs) return;
      this.pausedByUs = false;
      if (video.ended) return;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    }

    _duckVideoVolume() {
      const video = this.video;
      if (!video || !this.settings.duckOriginal) return;
      if (this.originalVideoVolume == null) this.originalVideoVolume = video.volume;
      const target = Math.max(0, Math.min(1, this.settings.duckVolume));
      if (video.volume > target) video.volume = target;
    }

    _restoreVideoVolume() {
      const video = this.video;
      if (video && this.originalVideoVolume != null) {
        video.volume = Math.max(0, Math.min(1, this.originalVideoVolume));
      }
      this.originalVideoVolume = null;
    }

    _pump() {
      if (this.speaking || !this.queue.length) return;
      const synth = globalThis.speechSynthesis;
      if (!synth || typeof globalThis.SpeechSynthesisUtterance !== "function") {
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
      this.speaking = true;
      this._duckVideoVolume();
      this._emitState();

      const finish = () => {
        if (this.currentUtterance !== utterance) return;
        this.currentUtterance = null;
        this.speaking = false;
        if (this.queue.length) {
          this._pump();
        } else {
          this._restoreVideoVolume();
          this._resumeVideoIfNeeded();
          this._emitState();
        }
      };

      utterance.onend = finish;
      utterance.onerror = finish;
      synth.speak(utterance);
    }

    cancel(options = {}) {
      const synth = globalThis.speechSynthesis;
      this.queue = [];
      this.currentUtterance = null;
      this.speaking = false;
      try {
        synth?.cancel();
      } catch (_) {}
      this._restoreVideoVolume();
      if (options.resumeVideo !== false) this._resumeVideoIfNeeded();
      else this.pausedByUs = false;
      this._emitState();
    }

    snapshot(extraStatus = "") {
      return {
        speaking: this.speaking,
        queued: this.queue.length,
        pausedByUs: this.pausedByUs,
        status: extraStatus || (this.pausedByUs ? "Đang giữ video để đọc kịp" : this.speaking ? "Đang đọc" : "Sẵn sàng"),
      };
    }

    _emitState(extraStatus = "") {
      this.onStateChange(this.snapshot(extraStatus));
    }
  }

  return { SpeechController };
});
