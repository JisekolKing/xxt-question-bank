"use strict";

/**
 * 题库管理 UI 接入测试（开发工具，不参与插件运行）。
 * 使用 linkedom + mock chrome.storage.local，不访问真实 Edge。
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");
const Bank = require(path.join(__dirname, "..", "popup", "question-bank.js"));
const Storage = require(path.join(
  __dirname,
  "..",
  "popup",
  "question-bank-storage.js"
));
const Practice = require(path.join(
  __dirname,
  "..",
  "popup",
  "practice.js"
));

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(
  path.join(ROOT, "popup", "popup.html"),
  "utf8"
);
const POPUP_JS = fs.readFileSync(
  path.join(ROOT, "popup", "popup.js"),
  "utf8"
);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createLocalStorage() {
  const data = {};
  return {
    data,
    async get(keys) {
      if (keys === null) return clone(data);
      if (typeof keys === "string") return { [keys]: clone(data[keys]) };
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
}

function createSandbox() {
  const { document, window } = parseHTML(HTML);
  window.confirm = () => true;
  const local = createLocalStorage();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    Blob,
    FileReader: class {},
    document,
    window,
    navigator: { userAgent: "test", locks: null },
    chrome: {
      runtime: {
        id: "test-extension",
        getManifest: () => ({ version: "0.9.0" })
      },
      storage: {
        local,
        session: createLocalStorage()
      }
    },
    QuestionBank: Bank,
    QuestionBankStorage: Storage,
    QuestionPractice: Practice,
    CourseIndex: require(path.join(ROOT, "popup", "course-index.js")),
    CourseContext: require(path.join(ROOT, "popup", "course-context.js"))
  };
  vm.createContext(sandbox);
  vm.runInContext(POPUP_JS, sandbox, { filename: "popup.js" });
  sandbox.cacheElements();
  return { sandbox, document, local, window };
}

function context(overrides = {}) {
  return {
    courseId: "266489679",
    classId: "789012",
    cpi: "345678",
    pageType: "homework",
    now: 1780000000000,
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
    stem: "UI 测试题干",
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
    frameId: 0,
    chapterLinkStatus: "direct",
    sourceUrl: "https://mooc1.chaoxing.com/mooc-ans/work/view?token=secret",
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

function analysis(overrides = {}) {
  return {
    rawUrl:
      "https://mooc1.chaoxing.com/mooc-ans/work/view?courseId=266489679&classId=789012&cpi=345678",
    pageTitle: "作业详情",
    result: {
      courseName: "药理学",
      pageType: "homework",
      chapterName: "2.8 题库02-001",
      chapterId: "cur1231902406",
      chapterIdStatus: "stable",
      chapterIdSource: "coursetree",
      chapterFrameId: 0,
      chapterFrameStatus: "stable",
      chapterLinkStatus: "direct",
      isChaoxing: true,
      examLike: false,
      label: "作业",
      ...overrides
    },
    frames: [],
    tab: { id: 1 }
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

let failed = 0;
const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

test("popup.html 加载题库脚本且顺序正确", () => {
  const scripts = Array.from(
    documentScripts(HTML)
  );
  const bank = scripts.indexOf("question-bank.js");
  const storage = scripts.indexOf("question-bank-storage.js");
  const popup = scripts.indexOf("popup.js");
  assert.ok(bank >= 0);
  assert.ok(storage > bank);
  assert.ok(popup > storage);
  assert.match(HTML, /id="panel-library"/);
  assert.match(HTML, /id="save-extract-button"/);
  assert.match(HTML, /id="pending-confirm"/);
  assert.match(HTML, /id="import-file"/);
});

function documentScripts(source) {
  return Array.from(source.matchAll(/<script\s+src="([^"]+)"/g)).map(
    (match) => match[1].replace(/^.*\//, "")
  );
}

test("初始化后题库管理区域可用", async () => {
  const { sandbox, document } = createSandbox();
  await sandbox.init();
  assert.ok(document.getElementById("tab-library"));
  assert.ok(document.getElementById("panel-library"));
  sandbox.activateTab("library");
  assert.strictEqual(
    document.getElementById("panel-library").hidden,
    false
  );
});

test("保存摘要区分正式、pending 和拒绝", async () => {
  const { sandbox } = createSandbox();
  const data = {
    questions: [
      question(),
      question({ chapterLinkStatus: "cross_frame" }),
      question({
        chapterId: null,
        chapterIdStatus: "missing",
        chapterLinkStatus: "missing"
      })
    ]
  };
  const ctx = context();
  const plan = sandbox.buildSaveExtractionPlan(data, ctx);

  assert.strictEqual(plan.official.length, 1);
  assert.strictEqual(plan.pending.length, 1);
  assert.strictEqual(plan.rejected.length, 1);
});

test("正式保存后课程、章节和题目列表可见", async () => {
  const { sandbox, document } = createSandbox();
  const data = sandbox.mergeQuestionFrames(
    [frame(0, [question()])],
    analysis()
  );
  const ctx = context();
  sandbox.renderQuestions(
    data,
    analysis(),
    sandbox.buildSaveExtractionPlan(data, ctx),
    ctx
  );
  await sandbox.handleSaveExtraction();
  await sandbox.refreshLibrary({ silent: true });

  const courses = document.querySelectorAll("#library-course option");
  assert.ok(courses.length >= 2);
  const chapters = document.querySelectorAll("#library-chapter option");
  assert.ok(chapters.length >= 2);
  const questions = document.querySelectorAll(
    "#library-questions .bank-question"
  );
  assert.strictEqual(questions.length, 1);
  assert.match(
    document.getElementById("save-status").textContent,
    /新增 1/
  );
});

test("pending 列表显示课程、章节和原因", async () => {
  const { sandbox, document } = createSandbox();
  const store = sandbox.getQuestionStore();
  await store.savePendingQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  );
  await sandbox.refreshPending();

  const cards = document.querySelectorAll("#pending-list .pending-card");
  assert.strictEqual(cards.length, 1);
  assert.match(cards[0].textContent, /药理学/);
  assert.match(cards[0].textContent, /跨 frame/);
});

test("删除题目时 UI 传入 chapterKey", async () => {
  const { sandbox, document } = createSandbox();
  const store = sandbox.getQuestionStore();
  const saved = await store.saveOfficialQuestion(question(), context());
  await sandbox.refreshLibrary({ silent: true });
  sandbox.activateTab("library");
  await sandbox.loadQuestionsForChapter(saved.chapterKey);

  let called = null;
  const original = store.deleteQuestion;
  store.deleteQuestion = async (questionKey, chapterKey) => {
    called = { questionKey, chapterKey };
    return { ok: true };
  };
  const button = document.querySelector(
    "#library-questions .bank-question .mini-button--danger"
  );
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepStrictEqual(called, {
    questionKey: saved.questionKey,
    chapterKey: saved.chapterKey
  });
  store.deleteQuestion = original;
});

test("索引自动恢复和并发降级提示", async () => {
  const { sandbox, document, local } = createSandbox();
  const store = sandbox.getQuestionStore();
  await store.saveOfficialQuestion(question(), context());
  delete local.data[store.INDEX_KEY];

  await sandbox.refreshLibrary({ silent: true });
  assert.match(
    document.getElementById("library-status").textContent,
    /自动重建/
  );
  assert.strictEqual(
    document.getElementById("library-warning").hidden,
    false
  );
});

test("pending 人工确认会重新构造官方记录并保留失败原记录", async () => {
  const { sandbox } = createSandbox();
  const pendingResult = sandbox.QuestionBank.toBankQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  );
  const pending = pendingResult.question;
  const course = {
    courseKey: pending.courseKey,
    courseId: "266489679",
    classId: "789012",
    cpi: "345678",
    courseName: "药理学"
  };
  const chapter = {
    chapterKey: pending.chapterKey,
    chapterId: pending.chapterId,
    chapterIdStatus: "stable",
    chapterName: pending.chapterName,
    parentChapterName: pending.parentChapterName
  };
  const raw = sandbox.pendingToOfficialQuestion(pending, course, chapter);
  assert.strictEqual(raw.chapterLinkStatus, "direct");
  assert.strictEqual(raw.chapterId, chapter.chapterId);

  const store = sandbox.getQuestionStore();
  const save = await store.saveOfficialQuestion(raw, context());
  assert.strictEqual(save.ok, true);

  const badChapter = { ...chapter, chapterId: null };
  const badRaw = sandbox.pendingToOfficialQuestion(
    pending,
    course,
    badChapter
  );
  const failed = await store.saveOfficialQuestion(badRaw, context());
  assert.strictEqual(failed.ok, false);
});

test("UI 导出备份后显示完成状态", async () => {
  const { sandbox, document } = createSandbox();
  const store = sandbox.getQuestionStore();
  await store.saveOfficialQuestion(question(), context());
  await sandbox.exportBackup();
  assert.match(
    document.getElementById("backup-status").textContent,
    /已导出/
  );
});

test("已识别课程和章节匹配时自动预选", async () => {
  const { sandbox } = createSandbox();
  const store = sandbox.getQuestionStore();
  const official = await store.saveOfficialQuestion(question(), context());
  const pendingSaved = await store.savePendingQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  );
  await sandbox.refreshLibrary({ silent: true });
  const pending = (await store.getPendingQuestions()).questions[0];

  await sandbox.openPendingConfirm(pending);
  assert.strictEqual(
    sandbox.document.getElementById("pending-course").value,
    official.courseKey
  );
  assert.strictEqual(
    sandbox.document.getElementById("pending-chapter").value,
    official.chapterKey
  );
  assert.strictEqual(
    sandbox.document.getElementById("pending-confirm-button").disabled,
    false
  );
  assert.strictEqual(pendingSaved.ok, true);

  await sandbox.confirmPendingQuestion();
  const officialQuestions = await store.getQuestions(official.chapterKey);
  assert.strictEqual(officialQuestions.questions.length, 1);
  const pendingAfter = await store.getPendingQuestions();
  assert.strictEqual(pendingAfter.questions.length, 0);
});

test("只有课程匹配时保留课程选择并提示章节", async () => {
  const { sandbox } = createSandbox();
  const store = sandbox.getQuestionStore();
  const official = await store.saveOfficialQuestion(question(), context());
  await store.savePendingQuestion(
    question({
      chapterId: "curDifferent",
      chapterName: "完全不同的章节",
      chapterLinkStatus: "cross_frame"
    }),
    context()
  );
  await sandbox.refreshLibrary({ silent: true });
  const pending = (await store.getPendingQuestions()).questions[0];

  await sandbox.openPendingConfirm(pending);
  assert.strictEqual(
    sandbox.document.getElementById("pending-course").value,
    official.courseKey
  );
  assert.ok(!sandbox.document.getElementById("pending-chapter").value);
  assert.strictEqual(
    sandbox.document.getElementById("pending-confirm-button").disabled,
    true
  );
  assert.match(
    sandbox.document.getElementById("pending-confirm-warning").textContent,
    /没有找到|请选择/
  );
});

test("同名章节多个匹配时不自动选定", async () => {
  const { sandbox } = createSandbox();
  const store = sandbox.getQuestionStore();
  const first = await store.saveOfficialQuestion(
    question({ chapterId: "curA", chapterName: "同名章节" }),
    context()
  );
  await store.saveOfficialQuestion(
    question({ chapterId: "curB", chapterName: "同名章节" }),
    context()
  );
  await store.savePendingQuestion(
    question({
      chapterId: "curC",
      chapterName: "同名章节",
      chapterLinkStatus: "cross_frame"
    }),
    context()
  );
  await sandbox.refreshLibrary({ silent: true });
  const pending = (await store.getPendingQuestions()).questions[0];

  await sandbox.openPendingConfirm(pending);
  assert.ok(!sandbox.document.getElementById("pending-chapter").value);
  assert.strictEqual(
    sandbox.document.getElementById("pending-confirm-button").disabled,
    true
  );
  assert.match(
    sandbox.document.getElementById("pending-confirm-warning").textContent,
    /多个同名章节/
  );
  assert.strictEqual(first.ok, true);
});

test("同名课程多个匹配时不自动选定", async () => {
  const { sandbox } = createSandbox();
  const store = sandbox.getQuestionStore();
  await store.saveOfficialQuestion(question(), context());
  await store.saveOfficialQuestion(
    question({ chapterId: "curOther", chapterName: "另一章" }),
    context({ courseId: "999999", classId: "888888", cpi: null })
  );
  await store.savePendingQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context({ courseId: "777777", classId: "666666", cpi: null })
  );
  await sandbox.refreshLibrary({ silent: true });
  const pending = (await store.getPendingQuestions()).questions[0];

  await sandbox.openPendingConfirm(pending);
  assert.ok(!sandbox.document.getElementById("pending-course").value);
  assert.strictEqual(
    sandbox.document.getElementById("pending-confirm-button").disabled,
    true
  );
  assert.match(
    sandbox.document.getElementById("pending-confirm-warning").textContent,
    /多个同名课程|请选择/
  );
});

test("没有稳定 chapterId 时禁止正式确认", async () => {
  const { sandbox, local } = createSandbox();
  const store = sandbox.getQuestionStore();
  const official = await store.saveOfficialQuestion(question(), context());
  const shardKey = `questionBank:v1:chapter:${official.courseKey}:${official.chapterKey}`;
  local.data[shardKey].chapterId = null;
  local.data[shardKey].chapterIdStatus = "missing";
  await store.rebuildIndexes();
  await sandbox.refreshLibrary({ silent: true });
  const pendingSaved = await store.savePendingQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  );
  const pending = (await store.getPendingQuestions()).questions[0];

  await sandbox.openPendingConfirm(pending);
  assert.strictEqual(
    sandbox.document.getElementById("pending-confirm-button").disabled,
    true
  );
  assert.match(
    sandbox.document.getElementById("pending-confirm-warning").textContent,
    /稳定 chapterId/
  );
  assert.strictEqual(pendingSaved.ok, true);
});

test("用户修改课程后清空旧章节选择", async () => {
  const { sandbox } = createSandbox();
  const store = sandbox.getQuestionStore();
  await store.saveOfficialQuestion(question(), context());
  await store.saveOfficialQuestion(
    question({ chapterId: "curOther", chapterName: "另一章" }),
    context({ courseId: "999999", classId: "888888", cpi: null })
  );
  await store.savePendingQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  );
  await sandbox.refreshLibrary({ silent: true });
  const pending = (await store.getPendingQuestions()).questions[0];
  await sandbox.openPendingConfirm(pending);

  const courses = Array.from(
    sandbox.document.querySelectorAll("#pending-course option")
  );
  const otherCourse = courses.find((option) => option.value === "c_other");
  const second = courses.find(
    (option) => option.value && option.value !== pending.courseKey
  );
  assert.ok(second);
  sandbox.setSelectValue(
    sandbox.document.getElementById("pending-course"),
    second.value
  );
  await sandbox.loadPendingChapters(second.value, { autoSelect: false });
  assert.ok(!sandbox.document.getElementById("pending-chapter").value);
});

test("UI 导入部分失败时显示 IMPORT_PARTIAL 状态", async () => {
  const { sandbox, document, local } = createSandbox();
  const store = sandbox.getQuestionStore();
  await store.saveOfficialQuestion(question(), context());
  const backup = (await store.exportData()).backup;
  const originalSet = local.set;
  let failed = false;
  local.set = async (entries) => {
    if (!failed && entries && entries["questionBank:v1:index"]) {
      failed = true;
      throw new Error("index failure");
    }
    return originalSet(entries);
  };

  await sandbox.confirmImportBackup(backup);
  assert.match(
    document.getElementById("backup-status").textContent,
    /IMPORT_PARTIAL/
  );
  assert.match(
    document.getElementById("backup-status").textContent,
    /rollbackSucceeded/
  );
});

test("模拟练习可以答题、判分并生成总结", async () => {
  const { sandbox, document, window } = createSandbox();
  const store = sandbox.getQuestionStore();
  await store.saveOfficialQuestion(question(), context());
  await sandbox.refreshPracticeSetup();
  await sandbox.startPracticeSession();

  assert.strictEqual(
    document.getElementById("practice-session").hidden,
    false
  );
  const inputs = Array.from(
    document.querySelectorAll("#practice-question input")
  );
  assert.ok(inputs.length >= 2);
  const correct = inputs.find((input) => input.value === "A");
  correct.checked = true;
  correct.setAttribute("checked", "checked");
  correct.dispatchEvent(new window.Event("change", { bubbles: true }));
  await sandbox.submitPracticeAnswer();
  assert.match(
    document.getElementById("practice-feedback").textContent,
    /回答正确/
  );
  await sandbox.nextPracticeQuestion();
  assert.strictEqual(
    document.getElementById("practice-summary").hidden,
    false
  );
  assert.match(
    document.getElementById("practice-summary-text").textContent,
    /正确率/
  );
});

test("课程合并题库合并同一课程全部章节", async () => {
  const { sandbox, document } = createSandbox();
  const store = sandbox.getQuestionStore();
  await store.saveOfficialQuestion(question(), context());
  await store.saveOfficialQuestion(
    question({
      chapter: "2.9 题库02-002",
      chapterId: "cur1231902407",
      stem: "第二章节测试题干"
    }),
    context()
  );
  await sandbox.refreshPracticeSetup();
  sandbox.setSelectValue(
    document.getElementById("practice-scope"),
    "course"
  );
  await sandbox.startPracticeSession();
  assert.strictEqual(
    document.getElementById("practice-session").hidden,
    false
  );
  assert.match(
    document.getElementById("practice-progress-text").textContent,
    /1 \/ 2/
  );
});

test("练习页可复制题目提示词并打开 DeepSeek", async () => {
  const { sandbox, document } = createSandbox();
  const store = sandbox.getQuestionStore();
  await store.saveOfficialQuestion(question(), context());
  await sandbox.refreshPracticeSetup();
  await sandbox.startPracticeSession();
  let copied = "";
  let opened = "";
  sandbox.navigator.clipboard = {
    async writeText(value) {
      copied = value;
    }
  };
  sandbox.chrome.tabs = {
    create({ url }) {
      opened = url;
    }
  };
  await sandbox.askPracticeDeepSeek();
  assert.match(copied, /你是一名课程辅导老师/);
  assert.match(copied, /UI 测试题干/);
  assert.strictEqual(opened, "https://chat.deepseek.com/");
  assert.match(
    document.getElementById("practice-ai-status").textContent,
    /提示词已复制/
  );
});

test("自选章节模式可勾选多个章节", async () => {
  const { sandbox, document, window } = createSandbox();
  const store = sandbox.getQuestionStore();
  await store.saveOfficialQuestion(question(), context());
  await store.saveOfficialQuestion(
    question({
      chapter: "2.9 题库02-002",
      chapterId: "cur1231902407",
      stem: "多选章节第二题"
    }),
    context()
  );
  await sandbox.refreshPracticeSetup();
  sandbox.setSelectValue(
    document.getElementById("practice-scope"),
    "selected"
  );
  const scopeSelect = document.getElementById("practice-scope");
  const selectedScope = Array.from(scopeSelect.options).find(
    (option) => option.value === "selected"
  );
  selectedScope.selected = true;
  const picker = document.getElementById("practice-chapter-picker");
  const inputs = Array.from(
    picker.querySelectorAll("input[type=checkbox]")
  );
  assert.strictEqual(inputs.length, 2);
  inputs.forEach((input) => {
    input.checked = true;
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await sandbox.startPracticeSession();
  assert.match(
    document.getElementById("practice-progress-text").textContent,
    /1 \/ 2/
  );
});

test("宽松保存可将跨 frame 题目写入并标记未验证", async () => {
  const { sandbox } = createSandbox();
  const data = {
    questions: [question({ chapterLinkStatus: "cross_frame" })]
  };
  data.stats = frame(0, data.questions).result.stats;
  const ctx = context();
  sandbox.renderQuestions(
    data,
    analysis({ chapterLinkStatus: "cross_frame" }),
    sandbox.buildSaveExtractionPlan(data, ctx),
    ctx
  );
  await sandbox.handleLenientSave();
  const store = sandbox.getQuestionStore();
  const courses = await store.getCourses();
  const chapters = await store.getChapters(
    courses.courses[0].courseKey
  );
  const questions = await store.getQuestions(
    chapters.chapters[0].chapterKey
  );
  assert.strictEqual(questions.questions.length, 1);
  assert.strictEqual(
    questions.questions[0].verification,
    "frame_unverified"
  );
});

test("UI 导出本次解析 JSON 不包含完整 sourceUrl", async () => {
  const { sandbox } = createSandbox();
  const data = {
    questions: [question()]
  };
  data.stats = frame(0, data.questions).result.stats;
  const ctx = context();
  sandbox.renderQuestions(
    data,
    analysis(),
    sandbox.buildSaveExtractionPlan(data, ctx),
    ctx
  );
  assert.doesNotThrow(() => sandbox.exportExtractionJson());
  assert.match(
    sandbox.document.getElementById("save-status").textContent,
    /导出/
  );
});

console.log("题库管理 UI 接入测试\n");

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
    console.log("全部题库管理 UI 接入测试通过");
  }
})();
