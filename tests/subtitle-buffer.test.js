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
