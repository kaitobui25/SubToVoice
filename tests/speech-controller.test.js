const test = require("node:test");
const assert = require("node:assert/strict");
const { SpeechController } = require("../src/speech-controller.js");

test("resume video before speaking queued backlog", () => {
  const spoken = [];
  global.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  global.speechSynthesis = { getVoices: () => [], speak: u => spoken.push(u), cancel() {} };

  let plays = 0;
  const video = {
    paused: false,
    ended: false,
    volume: 1,
    pause() { this.paused = true; },
    play() { plays += 1; this.paused = false; return Promise.resolve(); },
  };

  const speech = new SpeechController({ settings: { pauseWhenBehind: true } });
  speech.setVideo(video);
  speech.enqueue("A");
  speech.enqueue("B");

  assert.equal(video.paused, true);
  spoken[0].onend();

  assert.equal(plays, 1);
  assert.equal(video.paused, false);
  assert.equal(spoken[1].text, "B");
});
