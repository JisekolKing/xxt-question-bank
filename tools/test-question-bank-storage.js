"use strict";

/**
 * 本地题库存储层测试（开发工具，不参与插件运行）。
 * 使用内存 mock 模拟 chrome.storage.local，不访问真实 Edge。
 */

const assert = require("node:assert");
const path = require("node:path");
const Storage = require(path.join(
  __dirname,
  "..",
  "popup",
  "question-bank-storage.js"
));

let failed = 0;
const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createMock(options = {}) {
  const data = {};
  let setCount = 0;
  const mock = {
    data,
    async get(keys) {
      if (options.failGet) {
        throw new Error("get failed");
      }
      if (keys === null) {
        return clone(data);
      }
      if (typeof keys === "string") {
        return { [keys]: clone(data[keys]) };
      }
      if (Array.isArray(keys)) {
        const result = {};
        keys.forEach((key) => {
          result[key] = clone(data[key]);
        });
        return result;
      }
      return {};
    },
    async set(entries) {
      setCount += 1;
      if (options.failSet && options.failSet(entries, setCount)) {
        throw new Error(options.failMessage || "set failed");
      }
      if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      Object.keys(entries || {}).forEach((key) => {
        data[key] = clone(entries[key]);
      });
    },
    async remove(keys) {
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
        delete data[key];
      });
    }
  };
  return mock;
}

const NOW = 1780000000000;
const INDEX_KEY_NAME = "questionBank:v1:index";
let clock = NOW;
function now() {
  clock += 1;
  return clock;
}

function createMockLocks() {
  const tails = new Map();
  return {
    async request(name, options, callback) {
      const previous = tails.get(name) || Promise.resolve();
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      tails.set(name, previous.then(() => gate));
      await previous;
      try {
        return await callback();
      } finally {
        release();
      }
    }
  };
}

function context(overrides = {}) {
  return {
    courseId: "266489679",
    classId: "789012",
    cpi: "345678",
    pageType: "homework",
    now: now(),
    ...overrides
  };
}

function question(overrides = {}) {
  return {
    type: "single_choice",
    number: 1,
    course: "药理学",
    chapter: "2.8 题库02-001",
    parentChapterName: "第二章",
    stem: "存储题干",
    stemTextStatus: "ok",
    options: [
      { label: "A", text: "选项甲", textStatus: "ok" },
      { label: "B", text: "选项乙", textStatus: "ok" }
    ],
    optionCount: 2,
    textStatus: "ok",
    textMessage: "",
    chapterId: "cur1231902406",
    chapterIdSource: "coursetree",
    chapterIdStatus: "stable",
    chapterFrameId: 0,
    chapterFrameStatus: "stable",
    frameId: 777,
    chapterLinkStatus: "direct",
    sourceUrl:
      "https://mooc1.chaoxing.com/mooc-ans/mooc2/work/view?token=secret",
    sourceTitle: "作业详情",
    media: [],
    answer: {
      user: "B",
      correct: "A",
      result: "incorrect",
      score: 0,
      correctStatus: "visible",
      userText: "选项乙",
      correctText: "选项甲"
    },
    ...overrides
  };
}

function createStore(mock) {
  return Storage.createStorage({ storage: mock, now });
}

console.log("本地题库存储层测试\n");

test("正式题目保存和读取", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const saved = await store.saveOfficialQuestion(question(), context());

  assert.strictEqual(saved.ok, true);
  assert.strictEqual(saved.action, "insert");

  const courses = await store.getCourses();
  assert.strictEqual(courses.ok, true);
  assert.strictEqual(courses.courses.length, 1);
  assert.strictEqual(courses.courses[0].courseName, "药理学");

  const chapters = await store.getChapters(saved.courseKey);
  assert.strictEqual(chapters.ok, true);
  assert.strictEqual(chapters.chapters.length, 1);
  assert.strictEqual(chapters.chapters[0].questionCount, 1);

  const questions = await store.getQuestions(saved.chapterKey);
  assert.strictEqual(questions.ok, true);
  assert.strictEqual(questions.questions.length, 1);
  assert.strictEqual(questions.questions[0].questionKey, saved.questionKey);

  const single = await store.getQuestion(saved.questionKey);
  assert.strictEqual(single.ok, true);
  assert.strictEqual(single.source, "official");
});

test("合并读取同一课程全部章节题目", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const first = await store.saveOfficialQuestion(question(), context());
  await store.saveOfficialQuestion(
    question({
      chapter: "2.9 题库02-002",
      chapterId: "cur1231902407",
      stem: "第二章题目",
      number: 1
    }),
    context()
  );
  await store.saveOfficialQuestion(
    question({
      chapter: "其他课程章节",
      chapterId: "cur9999999999",
      stem: "其他课程题目",
      number: 1
    }),
    context({ courseId: "999999999", classId: "888888888" })
  );
  const result = await store.getCourseQuestions(first.courseKey);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.chapterCount, 2);
  assert.strictEqual(result.questions.length, 2);
  assert.deepStrictEqual(
    result.questions.map((item) => item.stem).sort(),
    ["第二章题目", "存储题干"].sort()
  );
});

test("按选中章节合并读取题目", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const first = await store.saveOfficialQuestion(question(), context());
  const second = await store.saveOfficialQuestion(
    question({
      chapter: "2.9 题库02-002",
      chapterId: "cur1231902407",
      stem: "第二个章节题目"
    }),
    context()
  );
  const result = await store.getQuestionsByChapters([
    first.chapterKey,
    second.chapterKey
  ]);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.chapterCount, 2);
  assert.strictEqual(result.questions.length, 2);
});

test("宽松保存可保存跨 frame 题目并标记未验证", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const result = await store.saveUnverifiedQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.question.verification, "frame_unverified");
  assert.strictEqual(result.question.chapterLinkStatus, "cross_frame");
});

test("descendant 可正式保存", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const result = await store.saveOfficialQuestion(
    question({ chapterLinkStatus: "descendant" }),
    context()
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.action, "insert");
});

test("pending 独立保存且不进入正式章节", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const saved = await store.savePendingQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  );

  assert.strictEqual(saved.ok, true);
  assert.strictEqual(saved.action, "insert");

  const official = await store.getQuestions(saved.chapterKey);
  assert.strictEqual(official.ok, true);
  assert.strictEqual(official.questions.length, 0);

  const pending = await store.getPendingQuestions();
  assert.strictEqual(pending.ok, true);
  assert.strictEqual(pending.questions.length, 1);
  assert.strictEqual(pending.questions[0].importTarget, "pending");
  assert.strictEqual(pending.questions[0].courseName, "药理学");
  assert.strictEqual(pending.questions[0].chapterName, "2.8 题库02-001");
  assert.strictEqual(pending.questions[0].courseId, "266489679");
  assert.strictEqual(pending.questions[0].classId, "789012");
  assert.strictEqual(pending.questions[0].cpi, "345678");

  const direct = await store.saveOfficialQuestion(
    question({ chapterLinkStatus: "direct" }),
    context()
  );
  assert.strictEqual(direct.ok, true);
  assert.strictEqual(direct.action, "insert");
  const officialAfter = await store.getQuestions(saved.chapterKey);
  assert.strictEqual(officialAfter.questions.length, 1);
});

test("pending 不能通过正式保存接口写入", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const result = await store.saveOfficialQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  );

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, "NOT_OFFICIAL");
  assert.strictEqual(mock.data[store.INDEX_KEY], undefined);
});

test("重复导入不会重复增加题目", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const first = await store.saveOfficialQuestion(question(), context());
  const second = await store.saveOfficialQuestion(
    question({ textMessage: "再次导入" }),
    context()
  );

  assert.strictEqual(first.ok, true);
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.action, "update");

  const questions = await store.getQuestions(first.chapterKey);
  assert.strictEqual(questions.questions.length, 1);
});

test("正确答案不会被空值覆盖", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const first = await store.saveOfficialQuestion(question(), context());
  await store.saveOfficialQuestion(
    question({
      answer: {
        user: null,
        correct: null,
        result: "unknown",
        score: null,
        correctStatus: "not_visible",
        userText: null,
        correctText: null
      }
    }),
    context()
  );

  const single = await store.getQuestion(first.questionKey);
  assert.strictEqual(single.question.correctAnswer.value, "A");
});

test("partial 不覆盖 complete", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const first = await store.saveOfficialQuestion(question(), context());
  const partial = await store.saveOfficialQuestion(
    question({
      textStatus: "mixed",
      stemTextStatus: "protected_text",
      options: [
        { label: "A", text: "选项甲", textStatus: "protected_text" },
        { label: "B", text: "选项乙", textStatus: "protected_text" }
      ]
    }),
    context()
  );

  assert.strictEqual(partial.ok, false);
  const single = await store.getQuestion(first.questionKey);
  assert.strictEqual(single.question.identityQuality, "complete");
  assert.strictEqual(single.question.stem, "存储题干");
});

test("不同课程和章节数据隔离", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const a = await store.saveOfficialQuestion(question(), context());
  const b = await store.saveOfficialQuestion(
    question({
      course: "另一门课",
      chapter: "另一章",
      chapterId: "curB",
      chapterLinkStatus: "direct"
    }),
    context({ courseId: "999", classId: "888" })
  );

  assert.strictEqual(a.ok, true);
  assert.strictEqual(b.ok, true);
  assert.notStrictEqual(a.chapterKey, b.chapterKey);

  const aQuestions = await store.getQuestions(a.chapterKey);
  const bQuestions = await store.getQuestions(b.chapterKey);
  assert.strictEqual(aQuestions.questions.length, 1);
  assert.strictEqual(bQuestions.questions.length, 1);
  assert.strictEqual(
    bQuestions.questions[0].courseKey !== aQuestions.questions[0].courseKey,
    true
  );
});

test("删除题目后索引正确", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const saved = await store.saveOfficialQuestion(question(), context());

  const deleted = await store.deleteQuestion(
    saved.questionKey,
    saved.chapterKey
  );
  assert.strictEqual(deleted.ok, true);

  const chapters = await store.getChapters(saved.courseKey);
  assert.strictEqual(chapters.chapters[0].questionCount, 0);
  const questions = await store.getQuestions(saved.chapterKey);
  assert.strictEqual(questions.questions.length, 0);
});

test("删除章节后清理正式和 pending 数据", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const official = await store.saveOfficialQuestion(question(), context());
  await store.savePendingQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  );

  const deleted = await store.deleteChapter(official.chapterKey);
  assert.strictEqual(deleted.ok, true);
  assert.strictEqual(deleted.removedOfficial, true);
  assert.strictEqual(deleted.removedPending, true);

  const questions = await store.getQuestions(official.chapterKey);
  assert.strictEqual(questions.questions.length, 0);
  const pending = await store.getPendingQuestions();
  assert.strictEqual(pending.questions.length, 0);
});

test("索引损坏后可以重建", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const saved = await store.saveOfficialQuestion(question(), context());
  mock.data[store.INDEX_KEY] = { schemaVersion: 1, courses: {} };

  const rebuilt = await store.rebuildIndexes();
  assert.strictEqual(rebuilt.ok, true);
  const courses = await store.getCourses();
  assert.strictEqual(courses.courses.length, 1);
  const chapters = await store.getChapters(saved.courseKey);
  assert.strictEqual(chapters.chapters[0].questionCount, 1);
});

test("写入失败不会假装成功", async () => {
  const mock = createMock({ failSet: () => true });
  const store = createStore(mock);
  const result = await store.saveOfficialQuestion(question(), context());

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, "STORAGE_WRITE_FAILED");
  assert.strictEqual(mock.data[store.INDEX_KEY], undefined);
});

test("storage quota exceeded 返回明确错误", async () => {
  const mock = createMock({
    failSet: () => true,
    failMessage: "QUOTA_BYTES quota exceeded"
  });
  const store = createStore(mock);
  const result = await store.saveOfficialQuestion(question(), context());

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, "STORAGE_QUOTA_EXCEEDED");
});

test("索引写入失败时明确标记数据已写入", async () => {
  const mock = createMock({
    failSet: (entries) =>
      Boolean(entries && entries[INDEX_KEY_FOR_TEST])
  });
  const store = createStore(mock);
  const result = await store.saveOfficialQuestion(question(), context());

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, "INDEX_WRITE_FAILED");
  assert.strictEqual(result.error.dataSaved, true);
});

const INDEX_KEY_FOR_TEST = Storage.createStorage({
  storage: createMock(),
  now
}).INDEX_KEY;

test("并发写入不会造成数据覆盖", async () => {
  const mock = createMock({ delayMs: 5 });
  const store = createStore(mock);
  const first = await Promise.all([
    store.saveOfficialQuestion(question({ number: 1 }), context()),
    store.saveOfficialQuestion(
      question({ number: 2, stem: "第二道题干" }),
      context()
    )
  ]);

  assert.strictEqual(first[0].ok, true);
  assert.strictEqual(first[1].ok, true);
  const questions = await store.getQuestions(first[0].chapterKey);
  assert.strictEqual(questions.questions.length, 2);
});

test("JSON 导出内容完整", async () => {
  const mock = createMock();
  const store = createStore(mock);
  await store.saveOfficialQuestion(question(), context());
  await store.savePendingQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  );

  const exported = await store.exportData();
  assert.strictEqual(exported.ok, true);
  assert.strictEqual(exported.backup.schemaVersion, 1);
  assert.strictEqual(exported.backup.official.length, 1);
  assert.strictEqual(exported.backup.pending.length, 1);
  assert.ok(exported.backup.official[0].questions);
});

test("非法备份文件不能污染现有数据", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const saved = await store.saveOfficialQuestion(question(), context());
  const backup = (await store.exportData()).backup;
  backup.official[0].questions[saved.questionKey].questionKey = "q_invalid";

  const result = await store.importData(backup);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, "INVALID_BACKUP");

  const questions = await store.getQuestions(saved.chapterKey);
  assert.strictEqual(questions.questions.length, 1);
  assert.strictEqual(
    questions.questions[0].questionKey,
    saved.questionKey
  );
});

test("备份恢复后数量和身份信息正确", async () => {
  const sourceMock = createMock();
  const source = createStore(sourceMock);
  const official = await source.saveOfficialQuestion(question(), context());
  await source.savePendingQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  );
  const backup = (await source.exportData()).backup;

  const targetMock = createMock();
  const target = createStore(targetMock);
  const imported = await target.importData(backup);
  assert.strictEqual(imported.ok, true);

  const questions = await target.getQuestions(official.chapterKey);
  assert.strictEqual(questions.questions.length, 1);
  assert.strictEqual(questions.questions[0].chapterId, "cur1231902406");
  assert.strictEqual(questions.questions[0].canonicalIdentity.chapter.chapterId, "cur1231902406");

  const pending = await target.getPendingQuestions();
  assert.strictEqual(pending.questions.length, 1);
});

test("存储统计包含正式和 pending 数量", async () => {
  const mock = createMock();
  const store = createStore(mock);
  await store.saveOfficialQuestion(question(), context());
  await store.savePendingQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  );

  const stats = await store.getStorageStats();
  assert.strictEqual(stats.ok, true);
  assert.strictEqual(stats.stats.questionCount, 1);
  assert.strictEqual(stats.stats.pendingCount, 1);
  assert.strictEqual(stats.stats.chapterCount, 1);
});

test("多实例在 Web Locks 下不会互相覆盖", async () => {
  const mock = createMock();
  const locks = createMockLocks();
  const first = Storage.createStorage({ storage: mock, locks, now });
  const second = Storage.createStorage({ storage: mock, locks, now });

  const results = await Promise.all([
    first.saveOfficialQuestion(question({ number: 1 }), context()),
    second.saveOfficialQuestion(
      question({ number: 2, stem: "第二道题干" }),
      context()
    )
  ]);
  assert.strictEqual(results.every((item) => item.ok), true);

  const questions = await first.getQuestions(results[0].chapterKey);
  assert.strictEqual(questions.questions.length, 2);
});

test("锁不可用时明确降级为实例内串行", () => {
  const store = Storage.createStorage({
    storage: createMock(),
    now,
    locks: null
  });
  const info = store.getConcurrencyInfo();
  assert.strictEqual(info.mode, "local");
  assert.strictEqual(info.crossInstanceSafe, false);
  assert.ok(info.warning);
});

test("索引缺失时读取会自动重建", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const saved = await store.saveOfficialQuestion(question(), context());
  delete mock.data[store.INDEX_KEY];

  const courses = await store.getCourses();
  assert.strictEqual(courses.ok, true);
  assert.strictEqual(courses.indexRecovered, true);
  assert.strictEqual(courses.courses.length, 1);

  const chapters = await store.getChapters(saved.courseKey);
  assert.strictEqual(chapters.ok, true);
  assert.strictEqual(chapters.chapters[0].questionCount, 1);
});

test("同 questionKey 不同章节查询时不会盲目返回", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const first = await store.saveOfficialQuestion(question(), context());
  const second = await store.saveOfficialQuestion(
    question({
      chapterId: "curOther",
      chapterName: "另一章",
      chapterLinkStatus: "direct"
    }),
    context()
  );
  const firstShardKey = `questionBank:v1:chapter:${first.courseKey}:${first.chapterKey}`;
  const secondShardKey = `questionBank:v1:chapter:${second.courseKey}:${second.chapterKey}`;
  mock.data[secondShardKey].questions[first.questionKey] =
    clone(mock.data[firstShardKey].questions[first.questionKey]);

  const ambiguous = await store.getQuestion(first.questionKey);
  assert.strictEqual(ambiguous.ok, false);
  assert.strictEqual(ambiguous.error.code, "AMBIGUOUS_QUESTION_KEY");

  const scoped = await store.getQuestion(
    first.questionKey,
    first.chapterKey
  );
  assert.strictEqual(scoped.ok, true);
  assert.strictEqual(scoped.chapterKey, first.chapterKey);
});

test("删除章节可选择保留 pending", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const official = await store.saveOfficialQuestion(question(), context());
  await store.savePendingQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  );

  const deleted = await store.deleteChapter(official.chapterKey, {
    includePending: false
  });
  assert.strictEqual(deleted.ok, true);
  assert.strictEqual(deleted.removedOfficial, true);
  assert.strictEqual(deleted.removedPending, false);
  assert.strictEqual(deleted.pendingRetained, true);

  const pending = await store.getPendingQuestions();
  assert.strictEqual(pending.questions.length, 1);
});

test("备份恢复索引失败时回滚并报告 partial", async () => {
  const source = createStore(createMock());
  await source.saveOfficialQuestion(question(), context());
  const backup = (await source.exportData()).backup;

  let indexFailed = false;
  const targetMock = createMock({
    failSet: (entries) => {
      if (!indexFailed && entries && entries[INDEX_KEY_NAME]) {
        indexFailed = true;
        return true;
      }
      return false;
    }
  });
  const target = createStore(targetMock);
  const result = await target.importData(backup);

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, "IMPORT_PARTIAL");
  assert.strictEqual(result.error.partial, true);
  assert.strictEqual(result.error.rollbackAttempted, true);
  assert.strictEqual(result.error.rollbackSucceeded, true);
  assert.strictEqual(
    Object.keys(targetMock.data).filter((key) =>
      key.startsWith("questionBank:v1:chapter:")
    ).length,
    0
  );
});

test("pending 题目可以单独删除", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const saved = await store.savePendingQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  );
  const deleted = await store.deletePendingQuestion(
    saved.questionKey,
    saved.chapterKey
  );
  assert.strictEqual(deleted.ok, true);
  const pending = await store.getPendingQuestions();
  assert.strictEqual(pending.questions.length, 0);
});

test("保存不会修改传入的原始题目对象", async () => {
  const mock = createMock();
  const store = createStore(mock);
  const input = question();
  const before = JSON.stringify(input);

  await store.saveOfficialQuestion(input, context());
  assert.strictEqual(JSON.stringify(input), before);
});

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
    console.log("全部本地题库存储层测试通过");
  }
})();
