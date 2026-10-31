"use strict";

/**
 * 完整题库网页测试（开发工具，不参与插件运行）。
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
const Practice = require(path.join(__dirname, "..", "popup", "practice.js"));

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(
  path.join(ROOT, "popup", "library.html"),
  "utf8"
);
const JS = fs.readFileSync(
  path.join(ROOT, "popup", "library.js"),
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

function question(overrides = {}) {
  return {
    type: "single_choice",
    number: 1,
    course: "药理学",
    chapter: "2.8 题库02-001",
    parentChapterName: "第二章",
    stem: "完整网页测试题干",
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

function context() {
  return {
    courseId: "266489679",
    classId: "789012",
    cpi: "345678",
    pageType: "homework",
    now: 1780000000000
  };
}

function createPage() {
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
      storage: { local, session: createLocalStorage() }
    },
    QuestionBank: Bank,
    QuestionBankStorage: Storage,
    QuestionPractice: Practice
  };
  vm.createContext(sandbox);
  vm.runInContext(JS, sandbox, { filename: "library.js" });
  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  return { sandbox, document, local, window };
}

let failed = 0;
const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

test("完整网页包含题库、练习、pending 和备份区域", () => {
  const scripts = Array.from(
    HTML.matchAll(/<script\s+src="([^"]+)"/g)
  ).map((match) => match[1]);
  assert.ok(scripts.includes("question-bank.js"));
  assert.ok(scripts.includes("question-bank-storage.js"));
  assert.ok(scripts.includes("practice.js"));
  assert.ok(scripts.includes("library.js"));
  assert.match(HTML, /id="view-questions"/);
  assert.match(HTML, /id="view-practice"/);
  assert.match(HTML, /id="view-pending"/);
  assert.match(HTML, /id="view-backup"/);
});

test("空题库显示明确空状态", async () => {
  const { document } = createPage();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(
    document.getElementById("course-list").textContent,
    /还没有本地课程/
  );
});

test("正式题目在完整网页中显示", async () => {
  const { document, local } = createPage();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const store = Storage.createStorage({
    storage: {
      async get(keys) {
        if (keys === null) return clone(local.data);
        return { [keys]: clone(local.data[keys]) };
      },
      async set(entries) {
        Object.keys(entries).forEach((key) => {
          local.data[key] = clone(entries[key]);
        });
      },
      async remove() {}
    },
    now: Date.now,
    locks: null
  });
  await store.saveOfficialQuestion(question(), context());
  const { document: fresh } = createPageWithStorage(local);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.ok(fresh.querySelectorAll(".question-card").length >= 1);
  assert.match(fresh.getElementById("library-meta").textContent, /上级|章节/);
});

function createPageWithStorage(local) {
  const { document, window } = parseHTML(HTML);
  window.confirm = () => true;
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
    chrome: { storage: { local, session: createLocalStorage() } },
    QuestionBank: Bank,
    QuestionBankStorage: Storage,
    QuestionPractice: Practice
  };
  vm.createContext(sandbox);
  vm.runInContext(JS, sandbox, { filename: "library.js" });
  document.dispatchEvent(new window.Event("DOMContentLoaded"));
  return { sandbox, document, local, window };
}

test("搜索可以过滤完整网页题目", async () => {
  const { document, local } = createPage();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const store = Storage.createStorage({
    storage: {
      async get(keys) {
        if (keys === null) return clone(local.data);
        return { [keys]: clone(local.data[keys]) };
      },
      async set(entries) {
        Object.keys(entries).forEach((key) => {
          local.data[key] = clone(entries[key]);
        });
      },
      async remove() {}
    },
    now: Date.now,
    locks: null
  });
  await store.saveOfficialQuestion(question(), context());
  const { document: fresh, window: freshWindow } = createPageWithStorage(local);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const search = fresh.getElementById("question-search");
  search.value = "不存在的内容";
  search.dispatchEvent(new freshWindow.Event("input", { bubbles: true }));
  assert.match(
    fresh.getElementById("full-question-list").textContent,
    /没有符合筛选条件/
  );
});

test("完整网页支持练习答题和总结", async () => {
  const { local } = createPage();
  const store = Storage.createStorage({
    storage: {
      async get(keys) {
        if (keys === null) return clone(local.data);
        return { [keys]: clone(local.data[keys]) };
      },
      async set(entries) {
        Object.keys(entries).forEach((key) => {
          local.data[key] = clone(entries[key]);
        });
      },
      async remove() {}
    },
    now: Date.now,
    locks: null
  });
  await store.saveOfficialQuestion(question(), context());
  const { document: fresh, window: freshWindow } = createPageWithStorage(local);
  await new Promise((resolve) => setTimeout(resolve, 150));
  fresh.querySelector('[data-view="practice"]').click();
  await new Promise((resolve) => setTimeout(resolve, 80));
  fresh.getElementById("practice-start").click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const input = Array.from(
    fresh.querySelectorAll("#practice-question input")
  ).find((item) => item.value === "A");
  input.checked = true;
  input.setAttribute("checked", "checked");
  input.dispatchEvent(new freshWindow.Event("change", { bubbles: true }));
  fresh.getElementById("practice-submit").click();
  assert.match(
    fresh.getElementById("practice-feedback").textContent,
    /回答正确/
  );
  fresh.getElementById("practice-next").click();
  assert.strictEqual(
    fresh.getElementById("practice-summary").hidden,
    false
  );
});

console.log("完整题库网页测试\n");

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
    console.log("全部完整题库网页测试通过");
  }
})();
