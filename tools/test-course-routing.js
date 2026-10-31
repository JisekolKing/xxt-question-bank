"use strict";

/**
 * 课程上下文路由测试（开发工具，不参与插件运行）。
 * 用 VM 加载 popup.js，验证章节/练习/其他页面的索引查询分支。
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const source = fs.readFileSync(
  path.join(ROOT, "popup", "popup.js"),
  "utf8"
);

function createContext() {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    navigator: { userAgent: "" },
    document: { addEventListener() {} },
    chrome: {
      runtime: { id: "test-extension" },
      storage: {
        local: {},
        session: {}
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "popup.js" });
  return sandbox;
}

function installMocks(sandbox) {
  const calls = {
    saved: 0,
    lookups: [],
    sessionLoads: 0
  };

  sandbox.CourseIndex = {
    readUrlIdentifiers(rawUrl) {
      const url = new URL(rawUrl);
      const courseId = url.searchParams.get("courseId");
      const classId = url.searchParams.get("classId");
      const cpi = url.searchParams.get("cpi");
      return { courseId, classId, cpi };
    },
    async saveIndex() {
      calls.saved += 1;
      return { courseName: "课程A" };
    },
    async findIndex(storage, rawUrl) {
      calls.lookups.push(rawUrl);
      return {
        status: "ok",
        record: {
          courseName: "课程A",
          source: "测试课程页",
          updatedAt: 1000
        }
      };
    }
  };

  sandbox.CourseContext = {
    async saveContext() {
      calls.saved += 1;
      return {};
    },
    async loadContext() {
      calls.sessionLoads += 1;
      return { status: "none", courseName: null };
    }
  };

  return calls;
}

function analysis(pageType, rawUrl, courseName) {
  return {
    tab: { id: 1, windowId: 1 },
    rawUrl,
    frames: [],
    result: {
      pageType,
      courseName: courseName || null,
      courseNameSource: courseName ? "已有来源" : null
    }
  };
}

const BASE =
  "https://mooc1.chaoxing.com/path?courseId=1001&classId=2001&cpi=3001";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("courseHome 普通课程页仍走 save", () => {
  const sandbox = createContext();
  assert.strictEqual(
    sandbox.getCourseContextAction(
      { pageType: "courseHome" },
      "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu"
    ),
    "save"
  );
});

test("courseHome 章节内容页改为 lookup，不保存", async () => {
  const sandbox = createContext();
  const calls = installMocks(sandbox);
  const item = analysis(
    "courseHome",
    "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentstudy?chapterId=1&courseId=1001&classId=2001&cpi=3001"
  );

  await sandbox.applyCourseContext(item);
  assert.strictEqual(calls.saved, 0);
  assert.strictEqual(calls.lookups.length, 1);
  assert.strictEqual(item.result.courseName, "课程A");
});

test("chapterStudy 页面允许查询课程索引", async () => {
  const sandbox = createContext();
  const calls = installMocks(sandbox);
  const item = analysis("chapterStudy", BASE);

  await sandbox.applyCourseContext(item);
  assert.strictEqual(calls.lookups.length, 1);
  assert.strictEqual(item.result.courseName, "课程A");
  assert.strictEqual(item.result.courseNameSource, "URL课程索引关联");
});

test("chapterStudy 标题推断值不阻止索引，也不保存索引", async () => {
  const sandbox = createContext();
  const calls = installMocks(sandbox);
  const item = analysis("chapterStudy", BASE, "学生学习页面");
  item.result.courseNameSource = "页面标题（推断）";

  await sandbox.applyCourseContext(item);
  assert.strictEqual(calls.saved, 0);
  assert.strictEqual(calls.lookups.length, 1);
  assert.strictEqual(item.result.courseName, "课程A");
});

test("chapterQuiz 页面允许查询课程索引", async () => {
  const sandbox = createContext();
  const calls = installMocks(sandbox);
  const item = analysis("chapterQuiz", BASE);

  await sandbox.applyCourseContext(item);
  assert.strictEqual(calls.lookups.length, 1);
  assert.strictEqual(item.result.courseName, "课程A");
  assert.strictEqual(item.result.courseNameSource, "URL课程索引关联");
});

test("practice 页面允许查询课程索引", async () => {
  const sandbox = createContext();
  const calls = installMocks(sandbox);
  const item = analysis("practice", BASE);

  await sandbox.applyCourseContext(item);
  assert.strictEqual(calls.lookups.length, 1);
  assert.strictEqual(item.result.courseName, "课程A");
});

test("other 章节内容页允许查询课程索引", async () => {
  const sandbox = createContext();
  const calls = installMocks(sandbox);
  const item = analysis(
    "other",
    "https://mooc1.chaoxing.com/knowledge/cards?courseId=1001&classId=2001&cpi=3001"
  );

  await sandbox.applyCourseContext(item);
  assert.strictEqual(calls.lookups.length, 1);
  assert.strictEqual(item.result.courseName, "课程A");
});

test("other 非章节页面不无条件查询", async () => {
  const sandbox = createContext();
  const calls = installMocks(sandbox);
  const item = analysis("other", BASE);

  await sandbox.applyCourseContext(item);
  assert.strictEqual(calls.lookups.length, 0);
  assert.strictEqual(item.result.courseName, null);
});

test("章节页没有课程标识时不使用 session 猜测", async () => {
  const sandbox = createContext();
  const calls = installMocks(sandbox);
  const item = analysis(
    "chapterQuiz",
    "https://mooc1.chaoxing.com/work/doHomeWorkNew?chapterId=1"
  );

  await sandbox.applyCourseContext(item);
  assert.strictEqual(calls.lookups.length, 0);
  assert.strictEqual(calls.sessionLoads, 0);
  assert.strictEqual(item.result.courseName, null);
});

test("已有课程名称不会被索引结果覆盖", async () => {
  const sandbox = createContext();
  const calls = installMocks(sandbox);
  const item = analysis("chapterQuiz", BASE, "已有课程名");

  await sandbox.applyCourseContext(item);
  assert.strictEqual(calls.lookups.length, 0);
  assert.strictEqual(item.result.courseName, "已有课程名");
});

test("题目预览数据包含 parentChapterName", () => {
  const sandbox = createContext();
  const question = sandbox.buildQuestion(
    {
      type: "single_choice",
      stem: "题干",
      textStatus: "ok",
      stemTextStatus: "ok"
    },
    [
      { label: "A", text: "甲", textStatus: "ok" },
      { label: "B", text: "乙", textStatus: "ok" }
    ],
    {
      rawUrl: BASE,
      pageTitle: "学生学习页面",
      frames: [],
      result: {
        courseName: "课程A",
        chapterName: "1.3 三、新药开发与研究",
        parentChapterName: "第1章 药理学总论——绪言"
      }
    }
  );
  assert.strictEqual(question.course, "课程A");
  assert.strictEqual(question.chapter, "1.3 三、新药开发与研究");
  assert.strictEqual(question.parentChapterName, "第1章 药理学总论——绪言");
});

(async () => {
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`  ✓ ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${item.name}`);
      console.error(error);
    }
  }

  console.log(`\n课程上下文路由测试：${tests.length - failed}/${tests.length} 通过`);
  if (failed > 0) {
    process.exitCode = 1;
  }
})();
