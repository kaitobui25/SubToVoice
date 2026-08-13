const test = require("node:test");
const assert = require("node:assert/strict");
const { PhraseBuffer, computeNovelText } = require("../src/subtitle-buffer.js");

test("rolling captions append only new words", () => {
  assert.equal(computeNovelText("hello world", "hello world again"), "again");
});

test("rolling window overlap is removed", () => {
  assert.equal(computeNovelText("one two three", "two three four"), "four");
});

test("finished sentence does not lose repeated first word", () => {
  assert.equal(computeNovelText("say yes.", "Yes I agree."), "Yes I agree.");
});

test("phrase buffer joins fragments", () => {
  const out = [];
  const buffer = new PhraseBuffer({ settleMs: 60000, punctuationMs: 60000, onFlush: text => out.push(text) });
  buffer.push("this is", 1000);
  buffer.push("one sentence", 1100);
  buffer.flush("test");
  assert.deepEqual(out, ["this is one sentence."]);
});

test("extension pause time does not create a false hard gap", () => {
  const out = [];
  const buffer = new PhraseBuffer({ settleMs: 60000, punctuationMs: 60000, hardGapMs: 1400, onFlush: (text, reason) => out.push({ text, reason }) });
  buffer.push("phần", 10000);
  buffer.setSettlingPaused(true, 10200);
  buffer.setSettlingPaused(false, 15200);
  buffer.push("thứ", 15400);
  assert.equal(buffer.pendingText(), "phần thứ");
  assert.deepEqual(out, []);
  buffer.reset();
});

test("caption mutations during extension pause do not create a false hard gap", () => {
  const out = [];
  const buffer = new PhraseBuffer({ settleMs: 60000, punctuationMs: 60000, hardGapMs: 1400, onFlush: (text, reason) => out.push({ text, reason }) });
  buffer.push("Vận", 10000);
  buffer.setSettlingPaused(true, 10200);
  buffer.push("động", 12000);
  buffer.setSettlingPaused(false, 15200);
  buffer.push("viên", 15400);
  assert.equal(buffer.pendingText(), "Vận động viên");
  assert.deepEqual(out, []);
  buffer.reset();
});

test("real active hard gaps still flush", () => {
  const out = [];
  const buffer = new PhraseBuffer({ settleMs: 60000, punctuationMs: 60000, hardGapMs: 1400, onFlush: (text, reason) => out.push({ text, reason }) });
  buffer.push("một", 10000);
  buffer.push("hai", 11600);
  assert.equal(out.length, 1);
  assert.equal(out[0].reason, "gap");
  assert.equal(buffer.pendingText(), "hai");
  buffer.reset();
});
