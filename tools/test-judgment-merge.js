"use strict";

/**
 * 判断题合并/去重回归测试（开发工具，不参与插件运行）。
 * 用 VM 加载 popup.js，验证 mergeQuestionFrames() 不再丢弃 judgment，
 * 以及 buildQuestion() 能保留正确答案为 null 的批改结果。
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

const analysis = {
  rawUrl: "https://mooc1.chaoxing.com/mooc-ans/mooc2/work/view",
  pageTitle: "作业详情",
  result: {
    courseName: "测试课程",
    chapterName: "测试章节",
    parentChapterName: null
  },
  frames: []
};

function options() {
  return [
    { label: "A", text: "对", textStatus: "ok" },
    { label: "B", text: "错", textStatus: "ok" }
  ];
}

function judgmentRaw(overrides = {}) {
  return {
    number: 4,
    type: "judgment",
    stem: "判断题题干（ ）",
    stemTextStatus: "ok",
    options: options(),
    optionCount: 2,
    textStatus: "ok",
    textMessage: "",
    answer: {
      user: "对",
      correct: null,
      result: "unknown",
      score: 20,
      correctStatus: "not_visible"
    },
    media: [],
    ...overrides
  };
}

function singleRaw(overrides = {}) {
  return {
    number: 1,
    type: "single_choice",
    stem: "判断题题干（ ）",
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

function frame(questions) {
  return {
    frameId: 0,
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

console.log("判断题合并/去重测试\n");

test("judgment 能通过 mergeQuestionFrames()", () => {
  const data = sandbox.mergeQuestionFrames(
    [frame([judgmentRaw()])],
    analysis
  );

  assert.strictEqual(data.questions.length, 1);
  assert.strictEqual(data.questions[0].type, "judgment");
});

test("makeQuestionKey() 保留 judgment，不归为 single_choice", () => {
  const judgmentKey = sandbox.makeQuestionKey(
    judgmentRaw(),
    options()
  );
  const singleKey = sandbox.makeQuestionKey(singleRaw(), options());

  assert.notStrictEqual(judgmentKey, singleKey);
  assert.match(judgmentKey, /^judgment/);
  assert.match(singleKey, /^single_choice/);
});

test("judgment 进入 buildQuestion() 和最终列表", () => {
  const data = sandbox.mergeQuestionFrames(
    [frame([judgmentRaw()])],
    analysis
  );
  const question = data.questions[0];

  assert.ok(question);
  assert.strictEqual(question.type, "judgment");
  assert.strictEqual(question.answer.user, "对");
  assert.strictEqual(question.answer.correct, null);
  assert.strictEqual(question.answer.result, "unknown");
  assert.strictEqual(question.answer.score, 20);
  assert.strictEqual(question.answer.correctStatus, "not_visible");
});

test("未公布正确答案时卡片显示未展示，且不推测答案", () => {
  const question = sandbox.buildQuestion(
    judgmentRaw(),
    options(),
    analysis
  );
  const card = sandbox.createQuestionCard(question);
  const text = card.textContent;

  assert.match(text, /判断题/);
  assert.match(text, /我的答案/);
  assert.match(text, /我的答案对/);
  assert.match(text, /正确答案/);
  assert.match(text, /正确答案未展示/);
  assert.match(text, /答题结果/);
  assert.match(text, /未知/);
  assert.match(text, /20 分/);
  assert.doesNotMatch(text, /正确答案：对/);
});

test("相同题干/选项的 judgment 与 single_choice 不会被错误去重", () => {
  const data = sandbox.mergeQuestionFrames(
    [frame([singleRaw(), judgmentRaw()])],
    analysis
  );

  assert.strictEqual(data.questions.length, 2);
  assert.strictEqual(
    Array.from(data.questions, (question) => question.type).join(","),
    "single_choice,judgment"
  );
  assert.strictEqual(data.stats.duplicates, 0);
});

test("judgment 与现有单选、多选互不影响", () => {
  const multiple = singleRaw({
    number: 2,
    type: "multiple_choice",
    stem: "多选题题干（ ）"
  });
  const data = sandbox.mergeQuestionFrames(
    [frame([singleRaw(), multiple, judgmentRaw()])],
    analysis
  );

  assert.strictEqual(
    Array.from(data.questions, (question) => question.type).join(","),
    "single_choice,multiple_choice,judgment"
  );
  assert.strictEqual(data.stats.structures, 3);
});

console.log("");
if (failed > 0) {
  console.error(`测试失败：${failed} 个用例未通过`);
  process.exitCode = 1;
} else {
  console.log("全部判断题合并/去重测试通过");
}
