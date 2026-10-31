"use strict";

/**
 * 章节身份与 frame 来源测试（开发工具，不参与插件运行）。
 * 用 VM 加载 popup.js，验证 buildQuestion 的 chapterId/frameId/link 状态。
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
    { label: "A", text: "对", textStatus: "ok" },
    { label: "B", text: "错", textStatus: "ok" }
  ];
}

function rawQuestion(overrides = {}) {
  return {
    number: 1,
    type: "judgment",
    stem: "判断题",
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
      chapterName: "2.8 题库02-001",
      parentChapterName: "第二章",
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

console.log("章节身份与 frame 来源测试\n");

test("目录和题目在同一 frame 时标记 direct", () => {
  const data = sandbox.mergeQuestionFrames(
    [frame(0, [rawQuestion()])],
    analysis()
  );
  const question = data.questions[0];

  assert.strictEqual(question.frameId, 0);
  assert.strictEqual(question.chapterId, "cur1231902406");
  assert.strictEqual(question.chapterIdStatus, "stable");
  assert.strictEqual(question.chapterFrameId, 0);
  assert.strictEqual(question.chapterFrameStatus, "stable");
  assert.strictEqual(question.chapterLinkStatus, "direct");
});

test("目录和题目在不同 frame 时标记 cross_frame", () => {
  const data = sandbox.mergeQuestionFrames(
    [frame(777, [rawQuestion()])],
    analysis()
  );
  const question = data.questions[0];

  assert.strictEqual(question.frameId, 777);
  assert.strictEqual(question.chapterId, "cur1231902406");
  assert.strictEqual(question.chapterIdStatus, "stable");
  assert.strictEqual(question.chapterFrameId, 0);
  assert.strictEqual(question.chapterFrameStatus, "stable");
  assert.strictEqual(question.chapterLinkStatus, "cross_frame");
});

test("题目 frame 是目录 frame 的后代时标记 descendant", () => {
  const base = analysis();
  base.frameTree = [
    { frameId: 0, parentFrameId: -1 },
    { frameId: 777, parentFrameId: 0 }
  ];
  const data = sandbox.mergeQuestionFrames(
    [frame(777, [rawQuestion()])],
    base
  );
  const question = data.questions[0];

  assert.strictEqual(question.chapterLinkStatus, "descendant");
  assert.strictEqual(question.chapterFrameId, 0);
  assert.strictEqual(question.frameId, 777);
});

test("题目 frame 与目录 frame 是兄弟时不标记 descendant", () => {
  const base = analysis({ chapterFrameId: 777 });
  base.frameTree = [
    { frameId: 0, parentFrameId: -1 },
    { frameId: 777, parentFrameId: 0 },
    { frameId: 888, parentFrameId: 0 }
  ];
  const data = sandbox.mergeQuestionFrames(
    [frame(888, [rawQuestion()])],
    base
  );
  const question = data.questions[0];

  assert.strictEqual(question.chapterLinkStatus, "cross_frame");
});

test("多个含题目 frame 时标记 ambiguous", () => {
  const data = sandbox.mergeQuestionFrames(
    [frame(0, [rawQuestion()]), frame(2, [rawQuestion({ stem: "第二题" })])],
    analysis()
  );

  assert.strictEqual(data.questions.length, 2);
  assert.strictEqual(
    data.questions.every(
      (question) => question.chapterLinkStatus === "ambiguous"
    ),
    true
  );
});

test("章节 ID 缺失时不伪造稳定身份", () => {
  const data = sandbox.mergeQuestionFrames(
    [frame(0, [rawQuestion()])],
    analysis({
      chapterId: null,
      chapterIdSource: null,
      chapterIdStatus: "missing",
      chapterFrameId: null,
      chapterFrameStatus: "missing"
    })
  );
  const question = data.questions[0];

  assert.strictEqual(question.chapterId, null);
  assert.strictEqual(question.chapterIdStatus, "missing");
  assert.strictEqual(question.chapterFrameId, null);
  assert.strictEqual(question.chapterFrameStatus, "missing");
  assert.strictEqual(question.chapterLinkStatus, "missing");
});

test("多个不同 chapterId 不生成稳定身份", () => {
  const data = sandbox.mergeQuestionFrames(
    [frame(0, [rawQuestion()])],
    analysis({
      chapterId: null,
      chapterIdSource: null,
      chapterIdStatus: "ambiguous",
      chapterFrameId: null,
      chapterFrameStatus: "ambiguous"
    })
  );
  const question = data.questions[0];

  assert.strictEqual(question.chapterId, null);
  assert.strictEqual(question.chapterIdStatus, "ambiguous");
  assert.strictEqual(question.chapterLinkStatus, "ambiguous");
});

console.log("");
if (failed > 0) {
  console.error(`测试失败：${failed} 个用例未通过`);
  process.exitCode = 1;
} else {
  console.log("全部章节身份与 frame 来源测试通过");
}
