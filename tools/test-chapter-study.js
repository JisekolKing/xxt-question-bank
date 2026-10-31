"use strict";

/**
 * 课程学习页目录测试（开发工具，不参与插件运行）。
 * 使用 linkedom 构造 #coursetree 结构，不访问真实页面。
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");

const ROOT = path.join(__dirname, "..");
const snapshotSource = fs.readFileSync(
  path.join(ROOT, "content", "snapshot.js"),
  "utf8"
);

vm.runInThisContext(snapshotSource, { filename: "snapshot.js" });
const Classifier = require(path.join(ROOT, "popup", "classifier.js"));

const COURSE_URL = "https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1&classId=2&cpi=3";
const TOP_URL = "https://mooc1.chaoxing.com/mycourse/stu?courseId=1";

function createDocument(html) {
  const { document, window } = parseHTML(
    `<!doctype html><html><head><title>学生学习页面</title></head><body>${html}</body></html>`
  );
  globalThis.document = document;
  globalThis.window = window;
  globalThis.location = { href: COURSE_URL };
  window.getComputedStyle = () => ({
    visibility: "visible",
    display: "block",
    opacity: "1"
  });

  // linkedom 没有布局；让可见性检查通过。
  document.querySelectorAll("*").forEach((element) => {
    element.getBoundingClientRect = () => ({
      width: 100,
      height: 20,
      top: 0,
      left: 0,
      right: 100,
      bottom: 20
    });
  });

  return { document, window };
}

function catalogTree(selectedMarkup) {
  return `
    <div id="coursetree">
      <ul>
        <li>
          <div class="posCatalog_select firstLayer">
            <span class="posCatalog_title">第1章 药理学总论——绪言</span>
          </div>
          <div class="posCatalog_level">
            <ul>
              <li>${selectedMarkup}</li>
            </ul>
          </div>
        </li>
      </ul>
    </div>
  `;
}

function sectionMarkup(text, extraClass, id) {
  return `<div class="posCatalog_select posCatalog_active ${extraClass || ""}"${
    id ? ` id="${id}"` : ""
  }>
    <span class="posCatalog_name">${text}</span>
  </div>`;
}

function snapshot(html, frameId) {
  createDocument(html);
  const result = globalThis.collectPageSnapshot();
  if (typeof frameId === "number") {
    result.frameId = frameId;
  }
  return result;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("/mycourse/stu 仍识别为 courseHome", () => {
  const result = Classifier.classify({
    url: TOP_URL,
    title: "药理学",
    frames: []
  });
  assert.strictEqual(result.pageType, "courseHome");
  assert.strictEqual(result.courseName, "药理学");
});

test("/mycourse/studentstudy 识别为 chapterStudy，且不使用“学生学习页面”当课程名", () => {
  const result = Classifier.classify({
    url: COURSE_URL,
    title: "学生学习页面",
    frames: [{ title: "学生学习页面", courseCandidates: [] }]
  });
  assert.strictEqual(result.pageType, "chapterStudy");
  assert.strictEqual(result.label, "课程学习");
  assert.strictEqual(result.courseName, null);
});

test("当前选中小节能提取 chapterName 和 parentChapterName", () => {
  const data = snapshot(catalogTree(sectionMarkup("1.3 三、新药开发与研究")));
  assert.strictEqual(data.catalog.chapterName, "1.3 三、新药开发与研究");
  assert.strictEqual(data.catalog.parentChapterName, "第1章 药理学总论——绪言");
});

test("目录能通过 classifier 产出章节和上级章节", () => {
  const data = snapshot(catalogTree(sectionMarkup("1.3 三、新药开发与研究")));
  const result = Classifier.classify({
    url: COURSE_URL,
    title: "学生学习页面",
    frames: [data]
  });
  assert.strictEqual(result.pageType, "chapterStudy");
  assert.strictEqual(result.chapterName, "1.3 三、新药开发与研究");
  assert.strictEqual(result.parentChapterName, "第1章 药理学总论——绪言");
});

test("选中节点自身 id 作为 chapterId，并传递到 classifier", () => {
  const data = snapshot(
    catalogTree(
      sectionMarkup("1.3 三、新药开发与研究", "", "cur1231902406")
    ),
    0
  );
  assert.strictEqual(data.catalog.chapterId, "cur1231902406");
  assert.strictEqual(data.catalog.chapterIdSource, "coursetree");
  assert.strictEqual(data.catalog.chapterIdStatus, "stable");

  const result = Classifier.classify({
    url: COURSE_URL,
    title: "学生学习页面",
    frames: [data]
  });
  assert.strictEqual(result.chapterId, "cur1231902406");
  assert.strictEqual(result.chapterIdSource, "coursetree");
  assert.strictEqual(result.chapterIdStatus, "stable");
  assert.strictEqual(result.chapterFrameId, 0);
  assert.strictEqual(result.chapterFrameStatus, "stable");
});

test("选中节点没有 id 时标记缺失，不用章节名生成 id", () => {
  const data = snapshot(catalogTree(sectionMarkup("1.3 小节")));
  assert.strictEqual(data.catalog.chapterId, null);
  assert.strictEqual(data.catalog.chapterIdSource, null);
  assert.strictEqual(data.catalog.chapterIdStatus, "missing");

  const result = Classifier.classify({
    url: COURSE_URL,
    title: "学生学习页面",
    frames: [data]
  });
  assert.strictEqual(result.chapterId, null);
  assert.strictEqual(result.chapterIdStatus, "missing");
});

test("没有目录时 chapterId 明确缺失", () => {
  const data = snapshot("<div>无目录</div>");
  assert.strictEqual(data.catalog, null);

  const result = Classifier.classify({
    url: COURSE_URL,
    title: "学生学习页面",
    frames: [data]
  });
  assert.strictEqual(result.chapterId, null);
  assert.strictEqual(result.chapterIdSource, null);
  assert.strictEqual(result.chapterIdStatus, "missing");
  assert.strictEqual(result.chapterFrameId, null);
});

test("多个不同 chapterId 时标记 ambiguous，不任选一个", () => {
  const first = snapshot(
    catalogTree(sectionMarkup("1.1 小节一", "", "cur111")),
    0
  );
  const second = snapshot(
    catalogTree(sectionMarkup("1.2 小节二", "", "cur222")),
    1
  );

  const result = Classifier.classify({
    url: COURSE_URL,
    title: "学生学习页面",
    frames: [first, second]
  });
  assert.strictEqual(result.chapterId, null);
  assert.strictEqual(result.chapterIdStatus, "ambiguous");
  assert.strictEqual(result.chapterFrameStatus, "ambiguous");
});

test("章节名清洗：保留题库名称，拒绝题量/满分", () => {
  const cases = [
    ["2.8 题库02-001", "2.8 题库02-001"],
    ["20题", null],
    ["20 道题", null],
    ["共20题", null],
    ["共 20 道题", null],
    ["总计20题", null],
    ["满分100", null],
    ["100分", null]
  ];

  cases.forEach(([name, expected]) => {
    const data = snapshot(catalogTree(sectionMarkup(name)));
    const result = Classifier.classify({
      url: COURSE_URL,
      title: "学生学习页面",
      frames: [data]
    });
    assert.strictEqual(result.chapterName, expected, name);
  });
});

test("没有选中项时不伪造 chapterName", () => {
  const data = snapshot(catalogTree(`<div class="posCatalog_select"><span class="posCatalog_name">1.1 小节</span></div>`));
  assert.strictEqual(data.catalog, null);
  const result = Classifier.classify({
    url: COURSE_URL,
    title: "学生学习页面",
    frames: [data]
  });
  assert.strictEqual(result.chapterName, null);
});

test("没有 #coursetree 时安全返回 null", () => {
  const data = snapshot("<div>无目录</div>");
  assert.strictEqual(data.catalog, null);
});

test("多个可见选中项时只读取唯一节点，不猜测", () => {
  const data = snapshot(
    catalogTree(
      `${sectionMarkup("1.1 小节一")}<div class="posCatalog_select posCatalog_active"><span class="posCatalog_name">1.2 小节二</span></div>`
    )
  );
  assert.strictEqual(data.catalog, null);
});

test("选中的是上级章节时允许 chapterName 为上级章节，parent 为空", () => {
  const html = `
    <div id="coursetree">
      <ul>
        <li>
          <div class="posCatalog_select firstLayer posCatalog_active">
            <span class="posCatalog_title">第1章 药理学总论——绪言</span>
          </div>
        </li>
      </ul>
    </div>
  `;
  const data = snapshot(html);
  assert.strictEqual(data.catalog.chapterName, "第1章 药理学总论——绪言");
  assert.strictEqual(data.catalog.parentChapterName, null);
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

  console.log(`\n课程学习页目录测试：${tests.length - failed}/${tests.length} 通过`);
  if (failed > 0) {
    process.exitCode = 1;
  }
})();
