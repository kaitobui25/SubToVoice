const test = require("node:test");
const assert = require("node:assert/strict");
require("../src/subtitle-buffer.js");
const { computeNovelText, stripYouTubeCaptionInfoOverlay } = require("../src/caption-dedupe-v2.js");

test("prefix append keeps only new words", () => {
  assert.equal(computeNovelText("hello world", "hello world again"), "again");
});

test("rolling window removes a reliable two-word overlap", () => {
  assert.equal(computeNovelText("one two three", "two three four"), "four");
});

test("one-word overlap stays conservative at a sentence boundary", () => {
  assert.equal(computeNovelText("say yes.", "Yes I agree."), "Yes I agree.");
});

test("YouTube caption info overlay is stripped", () => {
  assert.equal(
    stripYouTubeCaptionInfoOverlay("xin chào English (auto-generated) >> Vietnamese Click for settings"),
    "xin chào",
  );
});

test("overlay does not make an extending rolling caption repeat", () => {
  assert.equal(
    computeNovelText(
      "tôi đã có thể chứng English (auto-generated) >> Vietnamese Click for settings",
      "tôi đã có thể chứng minh English (auto-generated) >> Vietnamese Click for settings",
    ),
    "minh",
  );
});

test("terminal punctuation does not disable a long rolling overlap", () => {
  assert.equal(
    computeNovelText(
      "Một mặt, đó là một câu hỏi tuyệt vời, nhưng mặt khác, nó lại là một câu hỏi gần như không thể trả lời được .",
      "nhưng mặt khác, nó lại là một câu hỏi gần như không thể trả lời được . Một",
    ),
    ". Một",
  );
});

test("fully repeated rolled window produces no new speech", () => {
  assert.equal(
    computeNovelText(
      "nhưng mặt khác, nó lại là một câu hỏi gần như không thể trả lời được . Một câu hỏi khác là, tôi tự hỏi mình phải",
      ". Một câu hỏi khác là, tôi tự hỏi mình phải",
    ),
    "",
  );
});

test("question-ending overlap keeps only the new suffix", () => {
  assert.equal(
    computeNovelText(
      "câu hỏi thiếu sót ở nhiều khía cạnh. Trước hết, câu hỏi đặt ra là, làm thế nào để tôi đạt được điều đó?",
      "câu hỏi đặt ra là, làm thế nào để tôi đạt được điều đó? Vì",
    ),
    "Vì",
  );
});
