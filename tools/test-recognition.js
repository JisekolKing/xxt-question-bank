"use strict";

/**
 * 识别规则单元测试（可选开发工具，不参与插件运行）。
 *
 * 运行：
 *   node tools/test-recognition.js
 *
 * 这些用例不使用真实学习通账号，只验证“给定页面数据时”的判断规则，
 * 避免把章节名当课程名、把普通页面硬猜成测验等错误。
 */

const assert = require("node:assert");
const { classify, isChaoxingHost } = require("../popup/classifier.js");

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

function expectType(result, pageType, label) {
  assert.strictEqual(result.pageType, pageType, `pageType 应为 ${pageType}`);
  assert.strictEqual(result.label, label, `label 应为 ${label}`);
}

console.log("学习通页面识别测试\n");

test("域名判断：只接受 chaoxing.com / chaoxing.cn 及其子域名", () => {
  assert.strictEqual(isChaoxingHost("chaoxing.com"), true);
  assert.strictEqual(isChaoxingHost("mooc1.chaoxing.com"), true);
  assert.strictEqual(isChaoxingHost("i.chaoxing.cn"), true);
  assert.strictEqual(isChaoxingHost("chaoxing.com.evil.example"), false);
  assert.strictEqual(isChaoxingHost("notchaoxing.com"), false);
});

test("章节测验：标题 + 一级标题 + /work/ 入口，识别课程名", () => {
  const result = classify({
    url: "https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=1&classId=2&workId=3",
    title: "章节测验 - 高等数学 - 学习通",
    frames: [
      {
        title: "章节测验",
        headings: [{ tag: "h1", text: "章节测验" }],
        breadcrumbs: [
          {
            text: "我的课程",
            href: "https://mooc1.chaoxing.com/mooc-ans/visit/courselistdata?courseId=1"
          },
          {
            text: "高等数学",
            href: "https://mooc1.chaoxing.com/mooc-ans/visit/courselistdata?courseId=1"
          },
          { text: "章节测验", href: "" }
        ],
        courseCandidates: []
      }
    ]
  });

  assert.strictEqual(result.isChaoxing, true);
  expectType(result, "chapterQuiz", "章节测验");
  assert.strictEqual(result.courseName, "高等数学");
  assert.strictEqual(result.courseNameSource, "面包屑导航");
  assert.strictEqual(result.confidence, "high");
});

test("课程主页：courselistdata 路径 + 课程标题元素", () => {
  const result = classify({
    url: "https://mooc1.chaoxing.com/mooc-ans/visit/courselistdata?courseId=99",
    title: "高等数学 - 学习通",
    frames: [
      {
        title: "高等数学",
        headings: [{ tag: "h1", text: "高等数学" }],
        breadcrumbs: [],
        courseCandidates: [{ text: "高等数学", source: "selector" }]
      }
    ]
  });

  expectType(result, "courseHome", "课程主页");
  assert.strictEqual(result.courseName, "高等数学");
  assert.strictEqual(result.courseNameSource, "课程标题元素");
  assert.strictEqual(result.confidence, "medium");
});

test("章节名称：从可见章节标题元素提取，且不与课程名混淆", () => {
  const result = classify({
    url: "https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?workId=4",
    title: "章节测验 - 高等数学 - 学习通",
    frames: [
      {
        title: "章节测验",
        headings: [{ tag: "h1", text: "章节测验" }],
        breadcrumbs: [],
        courseCandidates: [{ text: "高等数学", source: "selector" }],
        chapterCandidates: [{ text: "第一章 函数与极限", source: "selector" }]
      }
    ]
  });

  assert.strictEqual(result.courseName, "高等数学");
  assert.strictEqual(result.chapterName, "第一章 函数与极限");
  assert.strictEqual(result.chapterNameSource, "章节标题元素");
});

test("课程作业：作业详情标题优先于章节测验入口", () => {
  const result = classify({
    url: "https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?workId=5",
    title: "作业详情 - 线性代数 - 学习通",
    frames: [
      {
        title: "作业详情",
        headings: [{ tag: "h1", text: "作业详情" }],
        breadcrumbs: [],
        courseCandidates: []
      }
    ]
  });

  expectType(result, "homework", "课程作业");
  assert.strictEqual(result.courseName, "线性代数");
});

test("随堂练习：标题与网址共同确认", () => {
  const result = classify({
    url: "https://mooc1.chaoxing.com/mooc-ans/practice/index?courseId=7",
    title: "随堂练习 - 大学物理 - 学习通",
    frames: [
      {
        title: "随堂练习",
        headings: [{ tag: "h1", text: "随堂练习" }],
        breadcrumbs: [],
        courseCandidates: []
      }
    ]
  });

  expectType(result, "practice", "随堂练习");
  assert.strictEqual(result.courseName, "大学物理");
});

test("其他学习通页面：不硬猜类型、不编造课程名", () => {
  const result = classify({
    url: "https://i.chaoxing.com/base",
    title: "学习通",
    frames: [
      {
        title: "学习通",
        headings: [{ tag: "h1", text: "个人空间" }],
        breadcrumbs: [],
        courseCandidates: []
      }
    ]
  });

  expectType(result, "other", "其他学习通页面");
  assert.strictEqual(result.courseName, null);
  assert.strictEqual(result.confidence, "none");
});

test("非学习通页面：不做任何页面注入", () => {
  const result = classify({
    url: "https://www.example.com/article/1",
    title: "示例文章",
    frames: []
  });

  assert.strictEqual(result.isChaoxing, false);
  expectType(result, "notChaoxing", "非学习通页面");
  assert.strictEqual(result.courseName, null);
});

test("伪造域名 chaoxing.com.evil.example 不被当成学习通", () => {
  const result = classify({
    url: "https://chaoxing.com.evil.example/login",
    title: "学习通登录",
    frames: []
  });

  assert.strictEqual(result.isChaoxing, false);
});

test("章节名不能被当成课程名", () => {
  const result = classify({
    url: "https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?workId=8",
    title: "章节测验 - 第一章 函数 - 学习通",
    frames: [
      {
        title: "章节测验 - 第一章 函数 - 学习通",
        headings: [{ tag: "h1", text: "章节测验" }],
        breadcrumbs: [],
        courseCandidates: []
      }
    ]
  });

  expectType(result, "chapterQuiz", "章节测验");
  assert.strictEqual(result.courseName, null);
});

test("考试页面：明确标记为本阶段不处理", () => {
  const result = classify({
    url: "https://mooc1.chaoxing.com/mooc-ans/exam/test/reVersionTestStartNew?courseId=1",
    title: "考试 - 学习通",
    frames: []
  });

  assert.strictEqual(result.pageType, "other");
  assert.match(result.label, /考试页面/);
  assert.strictEqual(result.examLike, true);
  assert.strictEqual(result.courseName, null);
});

test("多框架合并：类型在主框架、课程名在子框架", () => {
  const result = classify({
    url: "https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?workId=9",
    title: "学习通",
    frames: [
      {
        title: "学习通",
        headings: [],
        breadcrumbs: [],
        courseCandidates: []
      },
      {
        title: "章节测验 - 数据结构 - 学习通",
        headings: [{ tag: "h1", text: "章节测验" }],
        breadcrumbs: [
          {
            text: "数据结构",
            href: "https://mooc1.chaoxing.com/mooc-ans/visit/courselistdata?courseId=3"
          }
        ],
        courseCandidates: []
      }
    ]
  });

  expectType(result, "chapterQuiz", "章节测验");
  assert.strictEqual(result.courseName, "数据结构");
});

test("面包屑没有课程链接时，不把章节文字当课程名", () => {
  const result = classify({
    url: "https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?workId=10",
    title: "学习通",
    frames: [
      {
        title: "学习通",
        headings: [{ tag: "h1", text: "章节测验" }],
        breadcrumbs: [{ text: "第一章 函数", href: "" }],
        courseCandidates: []
      }
    ]
  });

  expectType(result, "chapterQuiz", "章节测验");
  assert.strictEqual(result.courseName, null);
});

test("非课程页的页面标题不会被推断成课程名", () => {
  const result = classify({
    url: "https://i.chaoxing.com/base",
    title: "高等数学 - 学习通",
    frames: []
  });

  expectType(result, "other", "其他学习通页面");
  assert.strictEqual(result.courseName, null);
});

test("只有网址、没有页面数据时，也能判断课程主页", () => {
  const result = classify({
    url: "https://mooc1.chaoxing.com/mooc-ans/visit/courselistdata?courseId=1",
    title: "",
    frames: []
  });

  expectType(result, "courseHome", "课程主页");
  assert.strictEqual(result.courseName, null);
});

test("无效网址返回“无法识别”，不抛异常", () => {
  const result = classify({ url: "not a url", title: "", frames: [] });
  assert.strictEqual(result.pageType, "unknown");
  assert.strictEqual(result.isChaoxing, false);
});

console.log("");
if (failed > 0) {
  console.error(`测试失败：${failed} 个用例未通过`);
  process.exitCode = 1;
} else {
  console.log("全部测试通过");
}
