"use strict";

/**
 * URL 课程索引测试（开发工具，不参与插件运行）。
 * 使用内存 local storage 模拟 chrome.storage.local，不访问浏览器或网络。
 */

const assert = require("node:assert");
const path = require("node:path");

const CourseIndex = require(path.join(__dirname, "..", "popup", "course-index.js"));

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
    has(key) {
      return data.has(key);
    }
  };
}

const COURSE_ID = "1001";
const CLASS_ID = "2001";
const CPI = "3001";

function courseHomeUrl(overrides) {
  const values = {
    courseid: COURSE_ID,
    clazzid: CLASS_ID,
    cpi: CPI,
    enc: "must-not-be-stored",
    ...overrides
  };
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value != null && value !== "") {
      params.set(key, value);
    }
  });
  return `https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?${params}`;
}

function homeworkUrl(overrides) {
  const values = {
    courseId: COURSE_ID,
    classId: CLASS_ID,
    cpi: CPI,
    knowledgeid: "4001",
    enc: "must-not-be-stored",
    ...overrides
  };
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value != null && value !== "") {
      params.set(key, value);
    }
  });
  return `https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?${params}`;
}

function homeResult(name) {
  return {
    pageType: "courseHome",
    courseName: name,
    courseNameSource: "页面标题（推断）"
  };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("课程页 A 保存索引，新标签页作业页 A 成功关联", async () => {
  const storage = createMemoryStorage();
  const record = await CourseIndex.saveIndex(
    storage,
    homeResult("课程A"),
    courseHomeUrl(),
    1000
  );
  assert.strictEqual(record.courseName, "课程A");
  assert.strictEqual(record.courseId, COURSE_ID);
  assert.strictEqual(record.classId, CLASS_ID);
  assert.strictEqual(record.cpi, CPI);
  assert.strictEqual(record.source, "页面标题（推断）");

  const match = await CourseIndex.findIndex(storage, homeworkUrl());
  assert.strictEqual(match.status, "ok");
  assert.strictEqual(match.record.courseName, "课程A");
});

test("课程页关闭后，作业页仍能关联", async () => {
  const storage = createMemoryStorage();
  await CourseIndex.saveIndex(storage, homeResult("课程A"), courseHomeUrl(), 1000);
  // 没有 tab/session 参与，模拟课程页已经关闭。
  const match = await CourseIndex.findIndex(storage, homeworkUrl());
  assert.strictEqual(match.status, "ok");
  assert.strictEqual(match.record.courseName, "课程A");
});

test("不同 courseId 拒绝关联", async () => {
  const storage = createMemoryStorage();
  await CourseIndex.saveIndex(storage, homeResult("课程A"), courseHomeUrl(), 1000);
  const match = await CourseIndex.findIndex(
    storage,
    homeworkUrl({ courseId: "9999" })
  );
  assert.strictEqual(match.status, "none");
  assert.strictEqual(match.record, null);
});

test("不同 classId/clazzid 拒绝关联", async () => {
  const storage = createMemoryStorage();
  await CourseIndex.saveIndex(storage, homeResult("课程A"), courseHomeUrl(), 1000);
  const match = await CourseIndex.findIndex(
    storage,
    homeworkUrl({ classId: "9999" })
  );
  assert.strictEqual(match.status, "none");
  assert.strictEqual(match.record, null);
});

test("双方 cpi 不一致拒绝关联", async () => {
  const storage = createMemoryStorage();
  await CourseIndex.saveIndex(storage, homeResult("课程A"), courseHomeUrl(), 1000);
  const match = await CourseIndex.findIndex(
    storage,
    homeworkUrl({ cpi: "9999" })
  );
  assert.strictEqual(match.status, "none");
  assert.strictEqual(match.record, null);
});

test("只有一方有 cpi 时拒绝关联", async () => {
  const storage = createMemoryStorage();
  await CourseIndex.saveIndex(storage, homeResult("课程A"), courseHomeUrl(), 1000);
  const matchWithoutCpi = await CourseIndex.findIndex(
    storage,
    homeworkUrl({ cpi: null })
  );
  assert.strictEqual(matchWithoutCpi.status, "none");

  const storageWithoutCpi = createMemoryStorage();
  await CourseIndex.saveIndex(
    storageWithoutCpi,
    homeResult("课程A"),
    courseHomeUrl({ cpi: null }),
    1000
  );
  const matchWithCpi = await CourseIndex.findIndex(
    storageWithoutCpi,
    homeworkUrl()
  );
  assert.strictEqual(matchWithCpi.status, "none");
});

test("双方都没有 cpi 时仍可按 courseId + classId 关联", async () => {
  const storage = createMemoryStorage();
  await CourseIndex.saveIndex(
    storage,
    homeResult("课程A"),
    courseHomeUrl({ cpi: null }),
    1000
  );
  const match = await CourseIndex.findIndex(
    storage,
    homeworkUrl({ cpi: null })
  );
  assert.strictEqual(match.status, "ok");
  assert.strictEqual(match.record.courseName, "课程A");
});

test("缺少课程标识时返回 null", async () => {
  const storage = createMemoryStorage();
  const missing = await CourseIndex.findIndex(
    storage,
    "https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?knowledgeid=1"
  );
  assert.strictEqual(missing.status, "none");

  const saved = await CourseIndex.saveIndex(
    storage,
    homeResult("课程A"),
    "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu",
    1000
  );
  assert.strictEqual(saved, null);
});

test("同一课程索引不会被其他课程覆盖", async () => {
  const storage = createMemoryStorage();
  await CourseIndex.saveIndex(
    storage,
    homeResult("课程A"),
    courseHomeUrl(),
    1000
  );
  await CourseIndex.saveIndex(
    storage,
    homeResult("课程B"),
    courseHomeUrl({
      courseid: "9001",
      clazzid: "9002",
      cpi: "9003"
    }),
    2000
  );

  const matchA = await CourseIndex.findIndex(storage, homeworkUrl());
  const matchB = await CourseIndex.findIndex(
    storage,
    homeworkUrl({
      courseId: "9001",
      classId: "9002",
      cpi: "9003"
    })
  );
  assert.strictEqual(matchA.status, "ok");
  assert.strictEqual(matchA.record.courseName, "课程A");
  assert.strictEqual(matchB.status, "ok");
  assert.strictEqual(matchB.record.courseName, "课程B");
});

test("URL 别名和大小写归一，且不保存 enc", async () => {
  const storage = createMemoryStorage();
  const record = await CourseIndex.saveIndex(
    storage,
    homeResult("课程A"),
    courseHomeUrl(),
    1000
  );
  const identifiers = CourseIndex.readUrlIdentifiers(homeworkUrl());
  assert.strictEqual(identifiers.courseId, COURSE_ID);
  assert.strictEqual(identifiers.classId, CLASS_ID);
  assert.strictEqual(identifiers.cpi, CPI);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(record, "enc"), false);
  assert.strictEqual(record.courseId, COURSE_ID);
  assert.strictEqual(record.classId, CLASS_ID);
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

  console.log(`\nURL 课程索引测试：${tests.length - failed}/${tests.length} 通过`);
  if (failed > 0) {
    process.exitCode = 1;
  }
})();
