"use strict";

/**
 * 字体还原模块测试（开发工具，不参与插件运行）。
 *
 * 使用参考项目提供的真实学习通加密字体子集，验证：
 *   - Typr 解析；
 *   - MD5 路径哈希；
 *   - 映射表查表；
 *   - 假字到真实汉字的还原；
 *   - 未知字符不会被静默当作已还原。
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");

const ROOT = path.join(__dirname, "..");
for (const relative of [
  "content/vendor/typr.js",
  "content/vendor/cxsecret-table.js",
  "content/cxsecret.js",
  "content/question-parser.js"
]) {
  vm.runInThisContext(
    fs.readFileSync(path.join(ROOT, relative), "utf8"),
    { filename: relative }
  );
}

const cx = globalThis.CXSecret;
assert.ok(cx, "CXSecret 未初始化");
assert.ok(cx.hasTable > 20000, "映射表条目不足");
assert.strictEqual(
  cx.md5Hex("abc"),
  "900150983cd24fb0d6963f7d28e17f72",
  "MD5 实现不正确"
);

const fontPath = path.join(
  ROOT,
  "tools",
  "fixtures",
  "cxsecret-ceramic.ttf"
);

// 真实字体夹具不随公开仓库分发。保留本地开发能力，
// 公开 CI 在没有夹具时只检查映射表和算法，不把缺失当成失败。
if (!fs.existsSync(fontPath)) {
  console.log(
    "✓ cxsecret 映射表/MD5 测试通过（未包含字体夹具，跳过字体解码用例）"
  );
  process.exit(0);
}

const fontBytes = fs.readFileSync(fontPath);
const info = cx.analyzeFont(fontBytes);
assert.strictEqual(info.mapped, 31);
assert.strictEqual(info.unknown, 0);

const fake =
  "【单选题】中国硅酸玢协吪编著吥82版《中国陶瓷史》唚吢，瓷妑出现吤（）时期。";
const expected =
  "【单选题】中国硅酸盐协会编著的82版《中国陶瓷史》认为，瓷器出现于（）时期。";

const decoded = cx.decodeText(fake, info);
assert.strictEqual(decoded.complete, true);
assert.strictEqual(decoded.encoded, 7);
assert.strictEqual(decoded.unknown, 0);
assert.strictEqual(decoded.text, expected);
assert.strictEqual(cx.decodeText("plain text", info).text, "plain text");
assert.strictEqual(cx.decodeText("plain text", null).complete, false);

const fakeCore =
  "中国硅酸玢协吪编著吥82版《中国陶瓷史》唚吢，瓷妑出现吤（）时期。";
const expectedCore =
  "中国硅酸盐协会编著的82版《中国陶瓷史》认为，瓷器出现于（）时期。";
const fontBase64 = fontBytes.toString("base64");

const html = `<!doctype html><html><head>
  <style>
    @font-face {
      font-family: 'font-cxsecret';
      src: url(data:font/ttf;base64,${fontBase64}) format('truetype');
    }
  </style>
</head><body>
  <div class="TiMu">
    <div class="Zy_TItle">
      <span class="newZy_TItle">【单选题】</span>
      <div class="font-cxsecret"><p>${fakeCore}</p></div>
    </div>
    <ul class="Zy_ulTop">
      <li role="radio">
        <span class="num_option" data="A">A</span>
        <a class="after font-cxsecret"><p>${fakeCore}</p></a>
      </li>
      <li role="radio">
        <span class="num_option" data="B">B</span>
        <a class="after"><p>普通选项</p></a>
      </li>
    </ul>
  </div>
</body></html>`;

const { document, window } = parseHTML(html);
globalThis.document = document;
globalThis.window = window;
globalThis.location = { href: "https://mooc1.chaoxing.com/test" };

const result = globalThis.extractSingleChoiceQuestions({
  requireVisible: false
});
assert.strictEqual(result.questions.length, 1);
assert.strictEqual(result.stats.extracted, 1);
assert.strictEqual(result.questions[0].stem, expectedCore);
assert.strictEqual(result.questions[0].options[0].text, expectedCore);
assert.strictEqual(result.questions[0].textStatus, "ok");

console.log(
  "✓ cxsecret 字体还原测试通过：31 个字形，7 个假字，0 个未知，解析器端到端还原"
);
