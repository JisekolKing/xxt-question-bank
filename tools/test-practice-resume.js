"use strict";

/**
 * 模拟练习断点存储测试（开发工具，不访问真实浏览器）。
 */

const assert = require("node:assert");
const path = require("node:path");
const Resume = require(path.join(
  __dirname,
  "..",
  "popup",
  "practice-resume.js"
));

let failed = 0;
const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createStorage() {
  const data = {};
  return {
    data,
    async get(key) {
      if (key === null) return clone(data);
      if (typeof key === "string") return { [key]: clone(data[key]) };
      return {};
    },
    async set(entries) {
      Object.keys(entries).forEach((name) => {
        data[name] = clone(entries[name]);
      });
    },
    async remove(key) {
      delete data[key];
    }
  };
}

function question(index) {
  return {
    questionKey: `q_${index}`,
    stem: `第 ${index} 题`,
    type: "single_choice",
    options: [
      { label: "A", text: "选项甲" },
      { label: "B", text: "选项乙" }
    ],
    correctAnswer: { value: "A", status: "visible" }
  };
}

function snapshot() {
  return {
    schemaVersion: 1,
    courseKey: "course_1",
    courseName: "药理学",
    scope: "chapter",
    chapterKey: "chapter_1",
    chapterName: "第一章",
    selectedChapterKeys: ["chapter_1"],
    mode: "sequential",
    chapterCount: 1,
    questions: [question(1), question(2)],
    index: 1,
    answers: [
      {
        result: "correct",
        userAnswer: "A",
        correctAnswer: "A",
        questionKey: "q_1"
      }
    ],
    selection: ["B"],
    submitted: false,
    startedAt: 100
  };
}

test("保存、读取和清除练习断点", async () => {
  const storage = createStorage();
  const store = Resume.createResumeStore({
    storage,
    now: () => 1234
  });
  const saved = await store.save(snapshot());
  assert.strictEqual(saved.ok, true);
  assert.strictEqual(saved.snapshot.savedAt, 1234);
  assert.strictEqual(saved.snapshot.questions.length, 2);
  assert.strictEqual(saved.snapshot.index, 1);
  assert.deepStrictEqual(saved.snapshot.selection, ["B"]);

  const loaded = await store.load();
  assert.strictEqual(loaded.ok, true);
  assert.strictEqual(loaded.snapshot.courseName, "药理学");
  assert.strictEqual(loaded.snapshot.answers.length, 1);

  const cleared = await store.clear();
  assert.strictEqual(cleared.ok, true);
  const afterClear = await store.load();
  assert.strictEqual(afterClear.ok, true);
  assert.strictEqual(afterClear.snapshot, null);
});

test("非法断点不会被恢复", async () => {
  const storage = createStorage();
  const store = Resume.createResumeStore({ storage });
  const result = await store.save({
    schemaVersion: 1,
    questions: [],
    index: 99
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(
    Resume.normalizeSnapshot({
      schemaVersion: 1,
      questions: [],
      index: 0
    }),
    null
  );
});

test("恢复时索引越界会回到第一题", () => {
  const normalized = Resume.normalizeSnapshot({
    ...snapshot(),
    index: 999
  });
  assert.strictEqual(normalized.index, 0);
});

console.log("模拟练习断点存储测试\n");

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
    console.log("全部模拟练习断点存储测试通过");
  }
})();
