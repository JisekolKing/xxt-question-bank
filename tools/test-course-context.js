"use strict";

/**
 * 课程上下文与章节识别测试（开发工具，不参与插件运行）。
 * 使用内存 storage 模拟 chrome.storage.session，不访问浏览器或网络。
 */

const assert = require("node:assert");
const path = require("node:path");

const CourseContext = require(path.join(__dirname, "..", "popup", "course-context.js"));
const Classifier = require(path.join(__dirname, "..", "popup", "classifier.js"));

const TTL = CourseContext.TTL_MS;

function createMemoryStorage() {
  const data = new Map();
  return {
    async get(key) {
      if (key == null) {
        return Object.fromEntries(data);
      }
      return { [key]: data.get(key) };
    },
    async set(values) {
      Object.entries(values || {}).forEach(([key, value]) => {
        data.set(key, value);
      });
    },
    async remove(key) {
      data.delete(key);
    },
    has(key) {
      return data.has(key);
    }
  };
}

const TAB_1 = { id: 1, windowId: 10 };
const TAB_2 = { id: 2, windowId: 10 };
const HOME_URL = "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu";
const HOMEWORK_URL = "https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew";

function homeResult(courseName) {
  return {
    pageType: "courseHome",
    courseName,
    courseNameSource: "页面标题（推断）"
  };
}

function homeworkResult() {
  return {
    pageType: "homework",
    courseName: null,
    courseNameSource: null
  };
}

async function save(storage, name, tab, url, now) {
  return CourseContext.saveContext(
    storage,
    tab,
    homeResult(name),
    url,
    [],
    now
  );
}

async function load(storage, tab, url, now) {
  return CourseContext.loadContext(
    storage,
    tab,
    homeworkResult(),
    url,
    now
  );
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("课程主页 document.title 能产生课程名", () => {
  const result = Classifier.classify({
    url: HOME_URL,
    title: "课程A",
    frames: [{
      title: "课程A",
      headings: [],
      breadcrumbs: [],
      courseCandidates: [],
      chapterCandidates: []
    }]
  });
  assert.strictEqual(result.pageType, "courseHome");
  assert.strictEqual(result.courseName, "课程A");
  assert.strictEqual(result.courseNameSource, "页面标题（推断）");
});

test("课程A保存，同 tab 同课程作业页读取成功", async () => {
  const storage = createMemoryStorage();
  await save(storage, "课程A", TAB_1, HOME_URL, 1000);
  const result = await load(storage, TAB_1, HOMEWORK_URL, 2000);
  assert.strictEqual(result.status, "ok");
  assert.strictEqual(result.courseName, "课程A");
});

test("课程B覆盖课程A", async () => {
  const storage = createMemoryStorage();
  await save(storage, "课程A", TAB_1, HOME_URL, 1000);
  await save(storage, "课程B", TAB_1, HOME_URL, 2000);
  const result = await load(storage, TAB_1, HOMEWORK_URL, 3000);
  assert.strictEqual(result.status, "ok");
  assert.strictEqual(result.courseName, "课程B");
});

test("不同 tab 读取失败", async () => {
  const storage = createMemoryStorage();
  await save(storage, "课程A", TAB_1, HOME_URL, 1000);
  const result = await load(storage, TAB_2, HOMEWORK_URL, 2000);
  assert.strictEqual(result.status, "none");
  assert.strictEqual(result.courseName, null);
  // tab1 的上下文不能被 tab2 删除
  assert.strictEqual(storage.has(CourseContext.storageKey(1)), true);
});

test("无上下文直接进入作业页返回 null", async () => {
  const storage = createMemoryStorage();
  const result = await load(storage, TAB_1, HOMEWORK_URL, 1000);
  assert.strictEqual(result.status, "none");
  assert.strictEqual(result.courseName, null);
});

test("上下文过期返回 null 并清理", async () => {
  const storage = createMemoryStorage();
  await save(storage, "课程A", TAB_1, HOME_URL, 1000);
  const result = await load(storage, TAB_1, HOMEWORK_URL, 1000 + TTL + 1);
  assert.strictEqual(result.status, "none");
  assert.strictEqual(result.courseName, null);
  assert.strictEqual(storage.has(CourseContext.storageKey(1)), false);
});

test("courseId 不一致返回 null 并清理", async () => {
  const storage = createMemoryStorage();
  const homeUrl = `${HOME_URL}?courseId=100`;
  const homeworkUrl = `${HOMEWORK_URL}?courseId=200`;
  await save(storage, "课程A", TAB_1, homeUrl, 1000);
  const result = await load(storage, TAB_1, homeworkUrl, 2000);
  assert.strictEqual(result.status, "none");
  assert.strictEqual(result.courseName, null);
  assert.strictEqual(storage.has(CourseContext.storageKey(1)), false);
});

test("双方 courseId 一致时允许关联", async () => {
  const storage = createMemoryStorage();
  await save(storage, "课程A", TAB_1, `${HOME_URL}?courseId=100`, 1000);
  const result = await load(
    storage,
    TAB_1,
    `${HOMEWORK_URL}?courseId=100`,
    2000
  );
  assert.strictEqual(result.status, "ok");
  assert.strictEqual(result.courseName, "课程A");
});

test("仅课程页有 courseId 时拒绝关联并清理", async () => {
  const storage = createMemoryStorage();
  await save(storage, "课程A", TAB_1, `${HOME_URL}?courseId=100`, 1000);
  const result = await load(storage, TAB_1, HOMEWORK_URL, 2000);
  assert.strictEqual(result.status, "none");
  assert.strictEqual(result.courseName, null);
  assert.strictEqual(storage.has(CourseContext.storageKey(1)), false);
});

test("仅作业页有 courseId 时拒绝关联并清理", async () => {
  const storage = createMemoryStorage();
  await save(storage, "课程A", TAB_1, HOME_URL, 1000);
  const result = await load(
    storage,
    TAB_1,
    `${HOMEWORK_URL}?courseId=100`,
    2000
  );
  assert.strictEqual(result.status, "none");
  assert.strictEqual(result.courseName, null);
  assert.strictEqual(storage.has(CourseContext.storageKey(1)), false);
});

test("双方无 courseId 时，同 tab 有效期内允许关联", async () => {
  const storage = createMemoryStorage();
  await save(storage, "课程A", TAB_1, HOME_URL, 1000);
  const result = await load(storage, TAB_1, HOMEWORK_URL, 1000 + TTL - 1);
  assert.strictEqual(result.status, "ok");
  assert.strictEqual(result.courseName, "课程A");
});

test("可见课程链接可提供 courseId 并用于作业页校验", async () => {
  const storage = createMemoryStorage();
  const frames = [{
    courseLinks: [
      {
        text: "课程A",
        href: `${HOME_URL}?courseId=777`
      }
    ]
  }];
  await CourseContext.saveContext(
    storage,
    TAB_1,
    homeResult("课程A"),
    HOME_URL,
    frames,
    1000
  );
  const result = await load(
    storage,
    TAB_1,
    `${HOMEWORK_URL}?courseId=777`,
    2000
  );
  assert.strictEqual(result.status, "ok");
  assert.strictEqual(result.courseName, "课程A");
});

test(".ceyan_name h3 能识别“题库03-001”", () => {
  const result = Classifier.classify({
    url: HOMEWORK_URL,
    title: "做作业",
    frames: [{
      title: "做作业",
      headings: [],
      breadcrumbs: [],
      courseCandidates: [],
      chapterCandidates: [
        { text: "题库03-001", source: "selector", hint: ".ceyan_name h3" }
      ]
    }]
  });
  assert.strictEqual(result.chapterName, "题库03-001");
  assert.strictEqual(result.chapterNameSource, "章节标题元素");
});

test("普通 heading 中的“题库03-001”仍然拒绝", () => {
  const result = Classifier.classify({
    url: HOMEWORK_URL,
    title: "做作业",
    frames: [{
      title: "做作业",
      headings: [{ tag: "h3", text: "题库03-001" }],
      breadcrumbs: [],
      courseCandidates: [],
      chapterCandidates: [{ text: "题库03-001", source: "selector" }]
    }]
  });
  assert.strictEqual(result.chapterName, null);
});

test("课程名和章节名不会互相覆盖", () => {
  const result = Classifier.classify({
    url: HOMEWORK_URL,
    title: "做作业",
    frames: [{
      title: "做作业",
      headings: [],
      breadcrumbs: [],
      courseCandidates: [{ text: "课程A", source: "selector" }],
      chapterCandidates: [
        { text: "题库03-001", source: "selector", hint: ".ceyan_name h3" }
      ]
    }]
  });
  assert.strictEqual(result.courseName, "课程A");
  assert.strictEqual(result.chapterName, "题库03-001");
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

  console.log(`\n课程上下文测试：${tests.length - failed}/${tests.length} 通过`);
  if (failed > 0) {
    process.exitCode = 1;
  }
})();
