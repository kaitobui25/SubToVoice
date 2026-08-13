(() => {
  "use strict";

  const logger = globalThis.SubToVoiceLog;
  if (!logger) return;
  logger.setSource("content");
  const log = (type, data = {}, level = "info") => logger.event(type, data, level);

  function videoState(video = document.querySelector("video.html5-main-video") || document.querySelector("video")) {
    return video ? {
      currentTime: Number(video.currentTime || 0),
      duration: Number(video.duration || 0),
      paused: Boolean(video.paused),
      ended: Boolean(video.ended),
      playbackRate: Number(video.playbackRate || 1),
      volume: Number(video.volume ?? 0),
    } : null;
  }

  log("runtime.loaded", {
    version: chrome.runtime.getManifest().version,
    title: document.title,
    readyState: document.readyState,
    userAgent: navigator.userAgent,
  });

  const bufferApi = globalThis.SubToVoiceBuffer;
  if (bufferApi) {
    const originalNovel = bufferApi.computeNovelText;
    bufferApi.computeNovelText = function (previous, current) {
      const novel = originalNovel(previous, current);
      log("caption.snapshot", { previous, current, novel, video: videoState() });
      return novel;
    };

    const proto = bufferApi.PhraseBuffer?.prototype;
    if (proto) {
      const originalPush = proto.push;
      proto.push = function (input, nowMs) {
        const before = this.pendingText();
        log("buffer.push", { input, pendingBefore: before, nowMs: nowMs ?? Date.now(), video: videoState() });
        const accepted = originalPush.call(this, input, nowMs);
        log("buffer.push.result", { accepted, pendingAfter: this.pendingText() });
        return accepted;
      };

      const originalFlush = proto.flush;
      proto.flush = function (reason = "manual") {
        const before = this.pendingText();
        log("buffer.flush.begin", { reason, pending: before, video: videoState() });
        const spoken = originalFlush.call(this, reason);
        log("buffer.flush.end", { reason, spoken, video: videoState() });
        return spoken;
      };

      const originalReset = proto.reset;
      proto.reset = function () {
        log("buffer.reset", { pending: this.pendingText(), video: videoState() }, "warn");
        return originalReset.call(this);
      };
    }
  }

  const speechProto = globalThis.SubToVoiceSpeech?.SpeechController?.prototype;
  const instrumentedVideos = new WeakSet();
  if (speechProto) {
    const originalSetVideo = speechProto.setVideo;
    speechProto.setVideo = function (video) {
      const result = originalSetVideo.call(this, video);
      if (video && !instrumentedVideos.has(video)) {
        instrumentedVideos.add(video);
        log("video.attached", { src: video.currentSrc || video.src || "", video: videoState(video) });
        for (const type of ["play", "pause", "seeking", "seeked", "ended", "ratechange"]) {
          video.addEventListener(type, () => {
            log(`youtube.${type}.event`, { video: videoState(video), speech: this.snapshot() }, type === "pause" || type === "seeking" ? "warn" : "info");
          });
        }
      }
      return result;
    };
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const interesting = {};
    for (const [key, change] of Object.entries(changes)) {
      if (key === "subtovoiceDebugLog") continue;
      interesting[key] = { oldValue: change.oldValue, newValue: change.newValue };
    }
    if (Object.keys(interesting).length) log("storage.changed", { changes: interesting });
  });

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      const previousUrl = lastUrl;
      lastUrl = location.href;
      log("youtube.url.changed", { previousUrl, nextUrl: lastUrl }, "warn");
    }
  }, 500);
})();
