"use strict";

/** 模拟练习纯数据层测试。 */

const assert = require("node:assert");
const path = require("node:path");
const Practice = require(path.join(__dirname, "..", "popup", "practice.js"));

let failed = 0;
const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

function question(overrides = {}) {
  return {
    questionKey: "q_1",
    number: 1,
    type: "single_choice",
    stem: "题干",
    options: [
      { label: "A", text: "甲" },
      { label: "B", text: "乙" }
    ],
    correctAnswer: {
      value: "A",
      text: "甲",
      status: "visible"
    },
    teacherAnalysis: null,
    ...overrides
  };
}

test("答案解析标准化单选、多选和判断", () => {
  assert.strictEqual(Practice.normalizeAnswer(" a "), "A");
  assert.strictEqual(Practice.normalizeAnswer("c,a"), "AC");
  assert.strictEqual(Practice.normalizeAnswer("B"), "B");
  assert.strictEqual(Practice.normalizeAnswer(null), "");
});

test("顺序练习保持原顺序", () => {
  const session = Practice.createSession(
    [question({ questionKey: "q1" }), question({ questionKey: "q2" })],
    { mode: "sequential" }
  );
  assert.strictEqual(session.mode, "sequential");
  assert.strictEqual(session.total, 2);
  assert.strictEqual(session.questions[0].questionKey, "q1");
});

test("随机练习使用注入随机源且不丢题", () => {
  const session = Practice.createSession(
    [question({ questionKey: "q1" }), question({ questionKey: "q2" })],
    { mode: "random", random: () => 0 }
  );
  assert.strictEqual(session.mode, "random");
  assert.strictEqual(session.total, 2);
  assert.deepStrictEqual(
    session.questions.map((item) => item.questionKey).sort(),
    ["q1", "q2"]
  );
});

test("单选、多选、判断的判分", () => {
  assert.strictEqual(
    Practice.gradeAnswer(question(), "A").result,
    "correct"
  );
  assert.strictEqual(
    Practice.gradeAnswer(question(), "B").result,
    "incorrect"
  );
  assert.strictEqual(
    Practice.gradeAnswer(
      question({
        type: "multiple_choice",
        correctAnswer: { value: "AC", status: "visible" }
      }),
      "CA"
    ).result,
    "correct"
  );
  assert.strictEqual(
    Practice.gradeAnswer(
      question({
        type: "judgment",
        correctAnswer: { value: "B", status: "visible" }
      }),
      "B"
    ).result,
    "correct"
  );
});

test("答案未知时不推断正确或错误", () => {
  const result = Practice.gradeAnswer(
    question({ correctAnswer: null }),
    "A"
  );
  assert.strictEqual(result.result, "unknown");
  assert.strictEqual(result.correctAnswer, null);
});

test("答案文本映射", () => {
  assert.strictEqual(Practice.answerText(question(), "A"), "甲");
  assert.strictEqual(Practice.answerText(question(), "B"), "乙");
});

test("总结正确率和用时", () => {
  const summary = Practice.buildSummary(
    [
      { result: "correct" },
      { result: "incorrect" },
      { result: "unknown" }
    ],
    1000,
    6000,
    3
  );
  assert.strictEqual(summary.total, 3);
  assert.strictEqual(summary.correct, 1);
  assert.strictEqual(summary.incorrect, 1);
  assert.strictEqual(summary.unknown, 1);
  assert.strictEqual(summary.accuracy, 33);
  assert.strictEqual(summary.elapsedMs, 5000);
});

console.log("模拟练习数据层测试\n");

(async () => {
  for (const item of tests) {
    try {
      await item.run();
      console.log(`  ✓ ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${item.name}`);
      console.error(`    ${error.message}`);
    }
  }
  console.log("");
  if (failed > 0) {
    console.error(`测试失败：${failed} 个用例未通过`);
    process.exitCode = 1;
  } else {
    console.log("全部模拟练习数据层测试通过");
  }
})();
