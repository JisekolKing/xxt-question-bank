"use strict";

/**
 * 答案卡片 UI 单元测试（开发工具，不参与插件运行）。
 * 用 VM 加载 popup.js，并用 linkedom 提供最小 DOM；
 * 不访问浏览器、网络、Cookie 或真实页面。
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");

const ROOT = path.join(__dirname, "..");
const source = fs.readFileSync(
  path.join(ROOT, "popup", "popup.js"),
  "utf8"
);
const { document } = parseHTML("<!doctype html><html><body></body></html>");

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  document,
  navigator: { userAgent: "" },
  chrome: {}
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "popup.js" });

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

function options() {
  return [
    { label: "A", text: "选项甲", textStatus: "ok" },
    { label: "B", text: "选项乙", textStatus: "ok" },
    { label: "C", text: "选项丙", textStatus: "ok" },
    { label: "D", text: "选项丁", textStatus: "ok" }
  ];
}

console.log("答案卡片 UI 测试\n");

test("多选 AD 映射到选项文字，未知结果显示“未知”", () => {
  const answer = sandbox.buildAnswer(
    {
      user: "AD",
      correct: null,
      result: "unknown",
      score: 10,
      correctStatus: "not_visible"
    },
    options()
  );

  assert.strictEqual(answer.userText, "选项甲；选项丁");
  assert.strictEqual(answer.correct, null);
  assert.strictEqual(answer.correctText, null);
  assert.strictEqual(answer.result, "unknown");
  assert.strictEqual(answer.score, 10);
});

test("正确答案缺失时卡片明确显示“未展示”", () => {
  const answer = sandbox.buildAnswer(
    {
      user: "A",
      correct: null,
      result: "unknown",
      score: 20,
      correctStatus: "not_visible"
    },
    options()
  );
  const card = sandbox.createAnswerBlock(answer);
  const text = card.textContent;

  assert.match(text, /我的答案/);
  assert.match(text, /A（选项甲）/);
  assert.match(text, /正确答案/);
  assert.match(text, /未展示/);
  assert.match(text, /答题结果/);
  assert.match(text, /未知/);
  assert.match(text, /分数/);
  assert.match(text, /20 分/);
});

test("正确答案与错误结果分别显示", () => {
  const answer = sandbox.buildAnswer(
    {
      user: "B",
      correct: "A",
      result: "incorrect",
      score: 0,
      correctStatus: "visible"
    },
    options()
  );
  const card = sandbox.createAnswerBlock(answer);
  const text = card.textContent;

  assert.match(text, /B（选项乙）/);
  assert.match(text, /A（选项甲）/);
  assert.match(text, /错误/);
  assert.match(text, /0 分/);
});

console.log("");
if (failed > 0) {
  console.error(`测试失败：${failed} 个用例未通过`);
  process.exitCode = 1;
} else {
  console.log("全部答案卡片 UI 测试通过");
}
