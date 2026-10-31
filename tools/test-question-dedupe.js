"use strict";

/**
 * 题目去重专项测试（开发工具，不参与插件运行）。
 * 验证 makeQuestionKey() 的 frame 作用域和 mergeQuestionFrames() 的跨 frame 保留行为。
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");

const ROOT = path.join(__dirname, "..");
const source = fs.readFileSync(
  path.join(ROOT, "popup", "popup.js"),
  "utf8"
);
const { document } = parseHTML("<!doctype html><html><body></body></html>");

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  document,
  navigator: { userAgent: "" },
  chrome: {}
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "popup.js" });

let failed = 0;
function test(name, run) {
  try {
    run();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

function options() {
  return [
    { label: "A", text: "甲", textStatus: "ok" },
    { label: "B", text: "乙", textStatus: "ok" }
  ];
}

function rawQuestion(overrides = {}) {
  return {
    number: 1,
    type: "single_choice",
    stem: "相同时干",
    stemTextStatus: "ok",
    options: options(),
    optionCount: 2,
    textStatus: "ok",
    textMessage: "",
    answer: null,
    media: [],
    ...overrides
  };
}

function frame(frameId, questions) {
  return {
    frameId,
    result: {
      questions,
      stats: {
        containers: questions.length,
        extracted: questions.length,
        protectedText: 0,
        mixedText: 0,
        skippedMultiple: 0,
        skippedOtherType: 0,
        skippedUnknownType: 0,
        skippedIncomplete: 0,
        skippedHomeworkUnsupported: 0,
        duplicates: 0,
        inferredLabels: 0,
        structures: questions.length
      },
      skipped: []
    }
  };
}

function analysis(overrides = {}) {
  return {
    rawUrl: "https://mooc1.chaoxing.com/mooc-ans/mooc2/work/view",
    pageTitle: "作业详情",
    result: {
      courseName: "测试课程",
      chapterName: "测试章节",
      parentChapterName: null,
      chapterId: "cur1231902406",
      chapterIdSource: "coursetree",
      chapterIdStatus: "stable",
      chapterFrameId: 0,
      chapterFrameStatus: "stable",
      ...overrides
    },
    frames: []
  };
}

function merge(frames, data = analysis()) {
  return sandbox.mergeQuestionFrames(frames, data);
}

console.log("题目去重专项测试\n");

test("makeQuestionKey 对同一 frame 相同内容生成相同 key", () => {
  const first = sandbox.makeQuestionKey(rawQuestion(), options(), 0);
  const second = sandbox.makeQuestionKey(rawQuestion(), options(), 0);
  assert.strictEqual(first, second);
});

test("makeQuestionKey 对不同 frame 相同内容生成不同 key", () => {
  const first = sandbox.makeQuestionKey(rawQuestion(), options(), 0);
  const second = sandbox.makeQuestionKey(rawQuestion(), options(), 777);
  assert.notStrictEqual(first, second);
});

test("同一 frame 两道相同题目只保留一道", () => {
  const data = merge([frame(0, [rawQuestion(), rawQuestion()])]);
  assert.strictEqual(data.questions.length, 1);
  assert.strictEqual(data.stats.duplicates, 1);
  assert.strictEqual(data.questions[0].frameId, 0);
});

test("不同 frame 两道相同题目保留两道，并各自保留 frameId", () => {
  const data = merge([
    frame(0, [rawQuestion()]),
    frame(777, [rawQuestion()])
  ]);
  assert.strictEqual(data.questions.length, 2);
  assert.strictEqual(data.stats.duplicates, 0);
  assert.strictEqual(
    data.questions.map((question) => question.frameId).join(","),
    "0,777"
  );
});

test("章节身份缺失时不同 frame 的相同题目仍然保留", () => {
  const data = merge(
    [frame(0, [rawQuestion()]), frame(777, [rawQuestion()])],
    analysis({
      chapterId: null,
      chapterIdSource: null,
      chapterIdStatus: "missing",
      chapterFrameId: null,
      chapterFrameStatus: "missing"
    })
  );
  assert.strictEqual(data.questions.length, 2);
  assert.strictEqual(data.stats.duplicates, 0);
  assert.strictEqual(
    data.questions.every((question) => question.chapterId === null),
    true
  );
  assert.strictEqual(
    data.questions.every(
      (question) => question.chapterLinkStatus === "missing"
    ),
    true
  );
});

test("部分可读题目在不同 frame 中重复时保留两道", () => {
  const partial = rawQuestion({
    stem: null,
    textStatus: "mixed",
    stemTextStatus: "protected_text",
    options: [
      { label: "A", text: null, textStatus: "protected_text" },
      { label: "B", text: null, textStatus: "protected_text" }
    ]
  });
  const data = merge([
    frame(0, [partial]),
    frame(777, [partial])
  ]);
  assert.strictEqual(data.questions.length, 2);
  assert.strictEqual(data.stats.duplicates, 0);
  assert.strictEqual(
    data.questions.map((question) => question.frameId).join(","),
    "0,777"
  );
  assert.strictEqual(
    data.questions.every((question) => question.textStatus === "mixed"),
    true
  );
});

test("同一 frame 内部分可读重复题仍正常去重", () => {
  const partial = rawQuestion({
    stem: null,
    textStatus: "mixed",
    stemTextStatus: "protected_text",
    options: [
      { label: "A", text: null, textStatus: "protected_text" },
      { label: "B", text: null, textStatus: "protected_text" }
    ]
  });
  const data = merge([frame(0, [partial, partial])]);
  assert.strictEqual(data.questions.length, 1);
  assert.strictEqual(data.stats.duplicates, 1);
});

test("原有题型区分逻辑不受影响", () => {
  const single = rawQuestion({ stem: "同题干" });
  const judgment = rawQuestion({ type: "judgment", stem: "同题干" });
  const data = merge([frame(0, [single, judgment])]);
  assert.strictEqual(data.questions.length, 2);
  assert.strictEqual(
    data.questions.map((question) => question.type).join(","),
    "single_choice,judgment"
  );
});

console.log("");
if (failed > 0) {
  console.error(`测试失败：${failed} 个用例未通过`);
  process.exitCode = 1;
} else {
  console.log("全部题目去重专项测试通过");
}
