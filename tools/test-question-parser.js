"use strict";

/**
 * 单选题解析器测试（开发工具，不参与插件运行）。
 *
 * 运行（需要 linkedom）：
 *   cd tools
 *   pnpm install
 *   node test-question-parser.js
 *
 * 这些夹具模拟学习通常见的 .TiMu / .questionLi 结构，
 * 用于验证题干清洗、选项对应、题型过滤、图片/公式引用和去重。
 * 真实页面的选择器仍需在 Edge 中验证。
 */

let parseHTML;

try {
  ({ parseHTML } = require("linkedom"));
} catch (error) {
  console.error(
    "缺少测试依赖 linkedom。请在 tools 目录执行：pnpm install"
  );
  process.exit(2);
}

const path = require("node:path");
const assert = require("node:assert");

const {
  firstAnswerPage,
  secondAnswerPage,
  chapterAnswerPage,
  chapterGradedAnswerPage,
  chapterComparisonPage
} = require("./fixtures/answer-pages");

require(path.join(__dirname, "..", "content", "question-parser.js"));

const extract = globalThis.extractSingleChoiceQuestions;

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

function parse(html) {
  const { document, window } = parseHTML(
    "<!doctype html><html><body>" + html + "</body></html>"
  );
  globalThis.document = document;
  globalThis.window = window;
  return extract({ requireVisible: false });
}

function homeworkQuestionMarkup(number, optionCount) {
  const labels = "ABCDE".slice(0, optionCount).split("");
  const options = labels
    .map((label) => {
      const text = label === "E" ? "从性显性" : `第${number}题选项${label}`;
      return `
        <div class="answerBg" role="radio">
          <span class="num_option" data="${label}">${label}</span>
          <div class="answer_p">${text}</div>
          <input type="hidden" name="answer" value="">
        </div>`;
    })
    .join("");

  return `
    <div class="questionLi fontLabel singleQuesId" typename="单选题">
      <h3 class="mark_name">
        ${number}.
        <span class="colorShallow">(单选题, 1.5分)</span>
        <p>第${number}题题干（ ）</p>
      </h3>
      <div class="stem_answer">${options}</div>
    </div>`;
}

console.log("学习通题目解析测试\n");

test("考试/练习结构 .TiMu：题干完整、四个选项、排除答案区", () => {
  const result = parse(`
    <div class="TiMu">
      <div class="Zy_TItle clearfix">
        <div class="fl clearfix">
          <span class="q_type">单选题</span>
          <span class="q_num">1</span>
          <span class="font-cx">（2分）</span>
          成人正常安静状态下的心率范围是（ ）
        </div>
      </div>
      <ul class="Cy_ulTop">
        <li><span class="fl">A、</span><div class="answer_p">60～100次/分</div></li>
        <li><span class="fl">B、</span><div class="answer_p">100～120次/分</div></li>
        <li><span class="fl">C、</span><div class="answer_p">40～60次/分</div></li>
        <li><span class="fl">D、</span><div class="answer_p">120～140次/分</div></li>
      </ul>
      <div class="Py_answer clearfix">正确答案：A 我的答案：A</div>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  const question = result.questions[0];
  assert.strictEqual(question.number, 1);
  assert.strictEqual(question.stem, "成人正常安静状态下的心率范围是（ ）");
  assert.strictEqual(question.options.length, 4);
  assert.deepStrictEqual(question.options[0], {
    label: "A",
    text: "60～100次/分",
    textStatus: "ok"
  });
  assert.doesNotMatch(JSON.stringify(question), /正确答案/);
});

test("作业结构 .questionLi：题干去掉序号/题型/分值，保留医学术语", () => {
  const result = parse(`
    <div class="questionLi">
      <h3 class="mark_name">2.（单选题）【2分】下列哪种细胞参与体液免疫（ ）</h3>
      <ul class="mark_letter">
        <li><label><input type="radio" name="q2" value="A"><span>A. B淋巴细胞</span></label></li>
        <li><label><input type="radio" name="q2" value="B"><span>B. T淋巴细胞</span></label></li>
        <li><label><input type="radio" name="q2" value="C"><span>C. 中性粒细胞</span></label></li>
        <li><label><input type="radio" name="q2" value="D"><span>D. 红细胞</span></label></li>
      </ul>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  const question = result.questions[0];
  assert.strictEqual(question.number, 2);
  assert.strictEqual(question.stem, "下列哪种细胞参与体液免疫（ ）");
  assert.strictEqual(question.options.length, 4);
  assert.strictEqual(question.options[0].text, "B淋巴细胞");
});

test("多选题解析为 multiple_choice，不再跳过", () => {
  const result = parse(`
    <div class="TiMu">
      <div class="Zy_TItle"><span class="q_type">多选题</span>5. 以下属于恶性肿瘤的有（ ）</div>
      <ul class="Cy_ulTop">
        <li><span class="fl">A、</span><div class="answer_p">癌</div></li>
        <li><span class="fl">B、</span><div class="answer_p">肉瘤</div></li>
      </ul>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  assert.strictEqual(result.questions[0].type, "multiple_choice");
  assert.strictEqual(result.questions[0].options.length, 2);
  assert.strictEqual(result.stats.skippedMultiple, 0);
});

test("判断题解析为 judgment，并保留对/错选项", () => {
  const result = parse(`
    <div class="questionLi" typename="判断题">
      <h3 class="mark_name">6.（判断题）正常成人血液约占体重的 8%（ ）</h3>
      <ul class="mark_letter">
        <li><input type="radio" name="q6" value="A"><span>A. 正确</span></li>
        <li><input type="radio" name="q6" value="B"><span>B. 错误</span></li>
      </ul>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  assert.strictEqual(result.questions[0].type, "judgment");
  assert.strictEqual(result.questions[0].options.length, 2);
  assert.strictEqual(result.stats.skippedOtherType, 0);
});

test("无法确定题型时不强行分类", () => {
  const result = parse(`
    <div class="questionLi">
      <h3 class="mark_name">7. 以下哪项正确（ ）</h3>
      <div class="option">甲</div>
      <div class="option">乙</div>
    </div>
  `);

  assert.strictEqual(result.questions.length, 0);
  assert.strictEqual(result.stats.skippedUnknownType, 1);
});

test("题干里出现“单选题”三个字不会被误判", () => {
  const result = parse(`
    <div class="questionLi">
      <h3 class="mark_name">8. 关于单选题的命题特点，下列说法正确的是（ ）</h3>
      <div class="option">甲</div>
      <div class="option">乙</div>
    </div>
  `);

  assert.strictEqual(result.questions.length, 0);
  assert.strictEqual(result.stats.skippedUnknownType, 1);
});

test("选项数量不固定：三个选项也保留", () => {
  const result = parse(`
    <div class="questionLi">
      <h3 class="mark_name">9.（单选题）以下哪项正确（ ）</h3>
      <ul class="mark_letter">
        <li><input type="radio" name="q9" value="A"><span>A. 甲</span></li>
        <li><input type="radio" name="q9" value="B"><span>B. 乙</span></li>
        <li><input type="radio" name="q9" value="C"><span>C. 丙</span></li>
      </ul>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  assert.strictEqual(result.questions[0].options.length, 3);
});

test("图片题：保留题干图片和选项图片引用，排除答案图片", () => {
  const result = parse(`
    <div class="questionLi">
      <h3 class="mark_name">10.（单选题）图示病理切片最可能的诊断是（ ）</h3>
      <div class="stem-media"><img src="/files/lesion.png" alt="病理切片"></div>
      <ul class="mark_letter">
        <li><input type="radio" name="q10" value="A"><span>A. 鳞状细胞癌</span></li>
        <li><input type="radio" name="q10" value="B"><span>B. 腺癌</span></li>
        <li><input type="radio" name="q10" value="C"><span><img src="/files/option-c.png" alt=""></span></li>
      </ul>
      <div class="Py_answer"><img src="/files/answer.png" alt="答案图"></div>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  const question = result.questions[0];
  assert.strictEqual(question.options[2].text, "[图片]");

  const stemImage = question.media.find(
    (item) => item.scope === "stem" && item.src === "/files/lesion.png"
  );
  const optionImage = question.media.find(
    (item) => item.scope === "option" && item.option === "C"
  );
  assert.ok(stemImage, "应保留题干图片");
  assert.strictEqual(stemImage.alt, "病理切片");
  assert.ok(optionImage, "应保留选项图片");
  assert.strictEqual(optionImage.src, "/files/option-c.png");
  assert.ok(
    !question.media.some((item) => item.src.includes("answer")),
    "不应读取答案区图片"
  );
});

test("公式题：保留公式图片的 alt 作为公式引用", () => {
  const result = parse(`
    <div class="TiMu">
      <div class="Zy_TItle">11.（单选题）公式 <img class="tex" src="/formula/e.png" alt="E=mc^2"> 中，能量与质量的关系是（ ）</div>
      <ul class="Cy_ulTop">
        <li><span class="fl">A、</span><div class="answer_p">正比</div></li>
        <li><span class="fl">B、</span><div class="answer_p">反比</div></li>
      </ul>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  const media = result.questions[0].media;
  assert.strictEqual(media.length, 1);
  assert.strictEqual(media[0].kind, "formula");
  assert.strictEqual(media[0].alt, "E=mc^2");
});

test("重复题目只保留一份", () => {
  const result = parse(`
    <div class="questionLi">
      <h3 class="mark_name">12.（单选题）重复题（ ）</h3>
      <ul class="mark_letter">
        <li><input type="radio" name="q12a" value="A"><span>A. 甲</span></li>
        <li><input type="radio" name="q12a" value="B"><span>B. 乙</span></li>
      </ul>
    </div>
    <div class="questionLi">
      <h3 class="mark_name">12.（单选题）重复题（ ）</h3>
      <ul class="mark_letter">
        <li><input type="radio" name="q12b" value="A"><span>A. 甲</span></li>
        <li><input type="radio" name="q12b" value="B"><span>B. 乙</span></li>
      </ul>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  assert.strictEqual(result.stats.duplicates, 1);
});

test("隐藏选项不会被读取", () => {
  const result = parse(`
    <div class="TiMu">
      <div class="Zy_TItle"><span class="q_type">单选题</span>13. 隐藏选项测试（ ）</div>
      <ul class="Cy_ulTop">
        <li><span class="fl">A、</span><div class="answer_p">可见甲</div></li>
        <li style="display:none"><span class="fl">B、</span><div class="answer_p">隐藏乙</div></li>
        <li><span class="fl">C、</span><div class="answer_p">可见丙</div></li>
      </ul>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  assert.deepStrictEqual(
    result.questions[0].options.map((option) => option.label),
    ["A", "C"]
  );
});

test("题型标签存在但没有 radio 时仍能识别单选题", () => {
  const result = parse(`
    <div class="questionLi">
      <h3 class="mark_name">14. 以下哪项正确（ ）</h3>
      <span class="font-cx">单选题</span>
      <div class="option-item">A. 甲</div>
      <div class="option-item">B. 乙</div>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  assert.strictEqual(result.questions[0].options.length, 2);
});

test("没有已知容器时用 radio 分组兜底", () => {
  const result = parse(`
    <div class="custom-quiz">
      <div class="custom-title">15. 自定义结构的单选题（ ）</div>
      <label><input type="radio" name="q15" value="A">A. 甲</label>
      <label><input type="radio" name="q15" value="B">B. 乙</label>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  assert.strictEqual(result.questions[0].stem, "自定义结构的单选题（ ）");
  assert.strictEqual(result.questions[0].options.length, 2);
});

test("题干以小数开头时不会误删数字", () => {
  const result = parse(`
    <div class="questionLi">
      <h3 class="mark_name">（单选题）1.5 mg 的药物约相当于多少 μg（ ）</h3>
      <ul class="mark_letter">
        <li><input type="radio" name="q17" value="A"><span>A. 1500 μg</span></li>
        <li><input type="radio" name="q17" value="B"><span>B. 150 μg</span></li>
      </ul>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  assert.match(result.questions[0].stem, /^1\.5 mg 的药物/);
});

test("选项内的答案标记不会进入选项文字", () => {
  const result = parse(`
    <div class="TiMu">
      <div class="Zy_TItle"><span class="q_type">单选题</span>17. 答案标记测试（ ）</div>
      <ul class="Cy_ulTop">
        <li><span class="fl">A、</span><div class="answer_p">甲</div><span class="rightAnswer">正确答案</span></li>
        <li><span class="fl">B、</span><div class="answer_p">乙</div></li>
      </ul>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  assert.strictEqual(result.questions[0].options[0].text, "甲");
  assert.doesNotMatch(JSON.stringify(result.questions[0]), /正确答案/);
});

test("真实结构 .TiMu.newTiMu + li[role=radio]：题型、题号、A-E 选项和受保护文字", () => {
  const result = parse(`
    <div class="singleQuesId">
      <div class="TiMu newTiMu">
        <div class="Zy_TItle clearfix">
          <i>1.</i>
          <span class="newZy_TItle">【单选题】</span>
          <div class="font-cxsecret">
            <p>愖物作用愙愗愝（ ）</p>
          </div>
        </div>
        <ul class="Zy_ulTop w-top">
          <li role="radio">
            <span class="num_option" data="A">A.</span>
            <a class="after font-cxsecret"><p>受保护选项内容A</p></a>
            <input type="hidden" name="answer" value="">
          </li>
          <li role="radio">
            <span class="num_option" data="B">B.</span>
            <a class="after font-cxsecret"><p>受保护选项内容B</p></a>
            <input type="hidden" name="answer" value="">
          </li>
          <li role="radio">
            <span class="num_option" data="C">C.</span>
            <a class="after font-cxsecret"><p>受保护选项内容C</p></a>
            <input type="hidden" name="answer" value="">
          </li>
          <li role="radio">
            <span class="num_option" data="D">D.</span>
            <a class="after font-cxsecret"><p>受保护选项内容D</p></a>
            <input type="hidden" name="answer" value="">
          </li>
          <li role="radio">
            <span class="num_option" data="E">E.</span>
            <a class="after font-cxsecret"><p>受保护选项内容E</p></a>
            <input type="hidden" name="answer" value="">
          </li>
        </ul>
        <input type="hidden" id="answertype405836138" value="0">
      </div>
    </div>
  `);

  assert.strictEqual(result.stats.containers, 1);
  assert.strictEqual(result.stats.structures, 1);
  assert.strictEqual(result.stats.extracted, 0);
  assert.strictEqual(result.stats.protectedText, 1);
  assert.strictEqual(result.questions.length, 1);

  const question = result.questions[0];
  assert.strictEqual(question.type, "single_choice");
  assert.strictEqual(question.number, 1);
  assert.strictEqual(question.stem, null);
  assert.strictEqual(question.textStatus, "protected_text");
  assert.strictEqual(question.optionCount, 5);
  assert.deepStrictEqual(
    question.options.map((option) => option.label),
    ["A", "B", "C", "D", "E"]
  );
  assert.ok(
    question.options.every((option) => option.text === null),
    "受保护选项不应保存文字"
  );
  assert.doesNotMatch(JSON.stringify(question), /愖物作用|受保护选项内容/);
});

test("真实结构正常文字：.newZy_TItle 题型、.num_option 字母、a.after 选项文字", () => {
  const result = parse(`
    <div class="singleQuesId">
      <div class="TiMu newTiMu">
        <div class="Zy_TItle clearfix">
          <i>2</i>
          <span class="newZy_TItle">【单选题】</span>
          <div class="normal-stem"><p>正常题干（ ）</p></div>
        </div>
        <ul class="Zy_ulTop w-top">
          <li role="radio">
            <span class="num_option" data="A">A.</span>
            <a class="after"><p>甲</p></a>
          </li>
          <li role="radio">
            <span class="num_option" data="B">B.</span>
            <a class="after"><p>乙</p></a>
          </li>
        </ul>
      </div>
    </div>
  `);

  assert.strictEqual(result.stats.extracted, 1);
  assert.strictEqual(result.stats.protectedText, 0);

  const question = result.questions[0];
  assert.strictEqual(question.type, "single_choice");
  assert.strictEqual(question.number, 2);
  assert.strictEqual(question.stem, "正常题干（ ）");
  assert.strictEqual(question.textStatus, "ok");
  assert.strictEqual(question.optionCount, 2);
  assert.deepStrictEqual(question.options, [
    { label: "A", text: "甲", textStatus: "ok" },
    { label: "B", text: "乙", textStatus: "ok" }
  ]);
});

test("题干前缀 1 【单选题】：题型和题干都能正确清洗", () => {
  const result = parse(`
    <div class="TiMu">
      <div class="Zy_TItle">1 【单选题】前缀题干（ ）</div>
      <ul class="Cy_ulTop">
        <li><span class="fl">A、</span><div class="answer_p">甲</div></li>
        <li><span class="fl">B、</span><div class="answer_p">乙</div></li>
      </ul>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  assert.strictEqual(result.questions[0].type, "single_choice");
  assert.strictEqual(result.questions[0].number, 1);
  assert.strictEqual(result.questions[0].stem, "前缀题干（ ）");
});

test("章节题库多选题：.num_option_dx、li[role=checkbox]、A-E 五个选项", () => {
  const result = parse(`
    <div class="singleQuesId">
      <div class="TiMu newTiMu">
        <div class="Zy_TItle clearfix">
          <i>3.</i>
          <span class="newZy_TItle">【多选题】</span>
          <div class="normal-stem"><p>以下属于恶性肿瘤的有（ ）</p></div>
        </div>
        <ul class="Zy_ulTop w-top">
          <li role="checkbox">
            <span class="num_option_dx" data="A">A.</span>
            <a class="after"><p>癌</p></a>
            <input type="hidden" name="answer" value="">
          </li>
          <li role="checkbox">
            <span class="num_option_dx" data="B">B.</span>
            <a class="after"><p>肉瘤</p></a>
            <input type="hidden" name="answer" value="">
          </li>
          <li role="checkbox">
            <span class="num_option_dx" data="C">C.</span>
            <a class="after"><p>白血病</p></a>
            <input type="hidden" name="answer" value="">
          </li>
          <li role="checkbox">
            <span class="num_option_dx" data="D">D.</span>
            <a class="after"><p>良性肿瘤</p></a>
            <input type="hidden" name="answer" value="">
          </li>
          <li role="checkbox">
            <span class="num_option_dx" data="E">E.</span>
            <a class="after"><p>以上都是</p></a>
            <input type="hidden" name="answer" value="">
          </li>
        </ul>
      </div>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  const question = result.questions[0];
  assert.strictEqual(question.type, "multiple_choice");
  assert.strictEqual(question.number, 3);
  assert.strictEqual(question.stem, "以下属于恶性肿瘤的有（ ）");
  assert.strictEqual(question.optionCount, 5);
  assert.deepStrictEqual(
    question.options.map((option) => option.label),
    ["A", "B", "C", "D", "E"]
  );
  assert.strictEqual(question.options[4].text, "以上都是");
  assert.strictEqual(result.stats.extracted, 1);
});

test("单选和多选混合页面：数量和类型分别正确", () => {
  const result = parse(`
    <div class="TiMu">
      <div class="Zy_TItle"><span class="q_type">单选题</span>1. 单选题目（ ）</div>
      <ul class="Cy_ulTop">
        <li><span class="fl">A、</span><div class="answer_p">甲</div></li>
        <li><span class="fl">B、</span><div class="answer_p">乙</div></li>
      </ul>
    </div>
    <div class="TiMu">
      <div class="Zy_TItle"><span class="q_type">多选题</span>2. 多选题目（ ）</div>
      <ul class="Cy_ulTop">
        <li><span class="fl">A、</span><div class="answer_p">丙</div></li>
        <li><span class="fl">B、</span><div class="answer_p">丁</div></li>
      </ul>
    </div>
  `);

  assert.strictEqual(result.questions.length, 2);
  assert.deepStrictEqual(
    result.questions.map((question) => question.type),
    ["single_choice", "multiple_choice"]
  );
});

test("课程作业单选题：typename、h3.mark_name p、.stem_answer/.answerBg", () => {
  const result = parse(`
    <div class="homework-page">
      <div class="page-title">作业标题：第一章测试</div>
      <div class="report">举报</div>
      <div class="tips">作业说明：共 10 题，满分 100 分</div>

      <div class="questionLi fontLabel singleQuesId" typename="单选题">
        <h3 class="mark_name">
          1.
          <span class="colorShallow">(单选题, 1.5分)</span>
          <p>正常作业题干（ ）</p>
        </h3>
        <div class="stem_answer">
          <div class="answerBg" role="radio">
            <span class="num_option" data="A">A</span>
            <div class="answer_p">甲</div>
            <input type="hidden" name="answer" value="">
          </div>
          <div class="answerBg" role="radio">
            <span class="num_option" data="B">B</span>
            <div class="answer_p">乙</div>
            <input type="hidden" name="answer" value="">
          </div>
          <div class="answerBg" role="radio">
            <span class="num_option" data="C">C</span>
            <div class="answer_p">丙</div>
            <input type="hidden" name="answer" value="">
          </div>
        </div>
      </div>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  const question = result.questions[0];
  assert.strictEqual(question.type, "single_choice");
  assert.strictEqual(question.number, 1);
  assert.strictEqual(question.stem, "正常作业题干（ ）");
  assert.strictEqual(question.optionCount, 3);
  assert.deepStrictEqual(
    question.options.map((option) => option.label),
    ["A", "B", "C"]
  );
  assert.strictEqual(question.options[0].text, "甲");
  assert.doesNotMatch(
    question.stem,
    /作业标题|举报|作业说明|满分|1\.5分/
  );
});

test("作业页面多选题：正常解析，不再跳过", () => {
  const result = parse(`
    <div class="questionLi fontLabel singleQuesId" typename="多选题">
      <h3 class="mark_name">
        2.
        <span class="colorShallow">(多选题, 2分)</span>
        <p>作业多选题目（ ）</p>
      </h3>
      <div class="stem_answer">
        <div class="answerBg" role="checkbox">
          <span class="num_option" data="A">A</span>
          <div class="answer_p">甲</div>
        </div>
        <div class="answerBg" role="checkbox">
          <span class="num_option" data="B">B</span>
          <div class="answer_p">乙</div>
        </div>
      </div>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  assert.strictEqual(result.questions[0].type, "multiple_choice");
  assert.strictEqual(result.stats.skippedHomeworkUnsupported, 0);
});

test("受保护文字中明确使用宋体时正常提取", () => {
  const result = parse(`
    <div class="TiMu">
      <div class="Zy_TItle">
        <span class="newZy_TItle">【单选题】</span>
        <div class="font-cxsecret">
          <p style="font-family: 宋体">宋体题干（ ）</p>
        </div>
      </div>
      <ul class="Zy_ulTop">
        <li role="radio">
          <span class="num_option" data="A">A.</span>
          <a class="after font-cxsecret"><p style="font-family: 宋体">宋体选项甲</p></a>
        </li>
        <li role="radio">
          <span class="num_option" data="B">B.</span>
          <a class="after font-cxsecret"><p style="font-family: 宋体">宋体选项乙</p></a>
        </li>
      </ul>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  const question = result.questions[0];
  assert.strictEqual(question.textStatus, "ok");
  assert.strictEqual(question.stem, "宋体题干（ ）");
  assert.strictEqual(question.options[0].text, "宋体选项甲");
  assert.strictEqual(result.stats.extracted, 1);
});

test("题干可读但单个选项受保护：标记 mixed，只保留可读部分", () => {
  const result = parse(`
    <div class="TiMu">
      <div class="Zy_TItle">
        <span class="newZy_TItle">【单选题】</span>
        <div class="font-cxsecret">
          <p style="font-family: 宋体">正常题干（ ）</p>
        </div>
      </div>
      <ul class="Zy_ulTop">
        <li role="radio">
          <span class="num_option" data="A">A.</span>
          <a class="after font-cxsecret"><p style="font-family: CXSecretFont">机密选项甲</p></a>
        </li>
        <li role="radio">
          <span class="num_option" data="B">B.</span>
          <a class="after font-cxsecret"><p style="font-family: 宋体">正常选项乙</p></a>
        </li>
      </ul>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  const question = result.questions[0];
  assert.strictEqual(question.textStatus, "mixed");
  assert.strictEqual(question.stemTextStatus, "ok");
  assert.strictEqual(question.stem, "正常题干（ ）");
  assert.strictEqual(question.options[0].text, null);
  assert.strictEqual(question.options[0].textStatus, "protected_text");
  assert.strictEqual(question.options[1].text, "正常选项乙");
  assert.doesNotMatch(JSON.stringify(question), /机密选项甲/);
  assert.strictEqual(result.stats.mixedText, 1);
  assert.strictEqual(result.stats.extracted, 0);
});

test("作业外层 .questionLi 不会被当成一道整页题", () => {
  const result = parse(`
    <div class="questionLi page-wrapper">
      <div class="questionLi fontLabel singleQuesId" typename="单选题">
        <h3 class="mark_name">1. <span class="colorShallow">(单选题, 1分)</span><p>第一题（ ）</p></h3>
        <div class="stem_answer">
          <div class="answerBg" role="radio"><span class="num_option" data="A">A</span><div class="answer_p">甲</div></div>
          <div class="answerBg" role="radio"><span class="num_option" data="B">B</span><div class="answer_p">乙</div></div>
        </div>
      </div>
      <div class="questionLi fontLabel singleQuesId" typename="单选题">
        <h3 class="mark_name">2. <span class="colorShallow">(单选题, 1分)</span><p>第二题（ ）</p></h3>
        <div class="stem_answer">
          <div class="answerBg" role="radio"><span class="num_option" data="A">A</span><div class="answer_p">丙</div></div>
          <div class="answerBg" role="radio"><span class="num_option" data="B">B</span><div class="answer_p">丁</div></div>
        </div>
      </div>
    </div>
  `);

  assert.strictEqual(result.questions.length, 2);
  assert.deepStrictEqual(
    result.questions.map((question) => question.stem),
    ["第一题（ ）", "第二题（ ）"]
  );
});

test("外层 .singleQuesId 包裹三题：4/4/5 选项不能被合并", () => {
  const result = parse(`
    <div class="singleQuesId page-list">
      ${homeworkQuestionMarkup(1, 4)}
      ${homeworkQuestionMarkup(2, 4)}
      ${homeworkQuestionMarkup(3, 5)}
    </div>
  `);

  assert.strictEqual(result.questions.length, 3);
  assert.strictEqual(result.stats.containers, 3);
  assert.deepStrictEqual(
    result.questions.map((question) => question.optionCount),
    [4, 4, 5]
  );
  assert.deepStrictEqual(
    result.questions.map((question) =>
      question.options.map((option) => option.label)
    ),
    [
      ["A", "B", "C", "D"],
      ["A", "B", "C", "D"],
      ["A", "B", "C", "D", "E"]
    ]
  );

  assert.ok(!result.questions[0].options.some((option) => option.label === "E"));
  assert.ok(!result.questions[1].options.some((option) => option.label === "E"));
  assert.strictEqual(result.questions[2].options[4].label, "E");
  assert.strictEqual(result.questions[2].options[4].text, "从性显性");
});

test("三题并列 .questionLi：4/4/5 选项仍完整", () => {
  const result = parse(`
    ${homeworkQuestionMarkup(1, 4)}
    ${homeworkQuestionMarkup(2, 4)}
    ${homeworkQuestionMarkup(3, 5)}
  `);

  assert.strictEqual(result.questions.length, 3);
  assert.deepStrictEqual(
    result.questions.map((question) => question.optionCount),
    [4, 4, 5]
  );
  assert.strictEqual(result.questions[2].options[4].text, "从性显性");
});

test("页面其他文字不会被当成题目", () => {
  const result = parse(`
    <header>课程公告：请按时完成作业</header>
    <div class="TiMu">
      <div class="Zy_TItle">16.（单选题）唯一一道题（ ）</div>
      <ul class="Cy_ulTop">
        <li><span class="fl">A、</span><div class="answer_p">甲</div></li>
        <li><span class="fl">B、</span><div class="answer_p">乙</div></li>
      </ul>
    </div>
    <footer>版权所有</footer>
  `);

  assert.strictEqual(result.questions.length, 1);
  assert.strictEqual(result.questions[0].stem, "唯一一道题（ ）");
});

test("页面上没有题目时返回空结果和统计", () => {
  const result = parse("<main><p>这里没有题目</p></main>");
  assert.strictEqual(result.questions.length, 0);
  assert.strictEqual(result.stats.containers, 0);
});

test("答案页样本一：我的答案、正确答案、对错和分数", () => {
  const result = parse(firstAnswerPage);

  assert.strictEqual(result.questions.length, 2);
  assert.strictEqual(result.stats.containers, 2);

  const correctQuestion = result.questions[0];
  assert.strictEqual(correctQuestion.type, "single_choice");
  assert.strictEqual(correctQuestion.optionCount, 4);
  assert.strictEqual(correctQuestion.answer.user, "C");
  assert.strictEqual(correctQuestion.answer.correct, "C");
  assert.strictEqual(correctQuestion.answer.correctText, "选项丙");
  assert.strictEqual(correctQuestion.answer.result, "correct");
  assert.strictEqual(correctQuestion.answer.score, 5);
  assert.strictEqual(correctQuestion.answer.correctStatus, "visible");

  const incorrectQuestion = result.questions[1];
  assert.strictEqual(incorrectQuestion.answer.user, "B");
  assert.strictEqual(incorrectQuestion.answer.correct, "A");
  assert.strictEqual(incorrectQuestion.answer.correctText, "选项甲");
  assert.strictEqual(incorrectQuestion.answer.result, "incorrect");
  assert.strictEqual(incorrectQuestion.answer.score, 0);
  assert.strictEqual(incorrectQuestion.answer.correctStatus, "visible");
});

test("答案页样本二：只有我的答案和分数，正确答案必须为 null", () => {
  const result = parse(secondAnswerPage);

  assert.strictEqual(result.questions.length, 5);
  assert.deepStrictEqual(
    result.questions.map((question) => question.type),
    [
      "single_choice",
      "single_choice",
      "multiple_choice",
      "judgment",
      "judgment"
    ]
  );

  const single = result.questions[0];
  assert.strictEqual(single.answer.user, "A");
  assert.strictEqual(single.answer.correct, null);
  assert.strictEqual(single.answer.result, "unknown");
  assert.strictEqual(single.answer.score, 20);
  assert.strictEqual(single.answer.correctStatus, "not_visible");

  const multiple = result.questions[2];
  assert.strictEqual(multiple.answer.user, "AD");
  assert.strictEqual(multiple.answer.correct, null);
  assert.strictEqual(multiple.answer.result, "unknown");
  assert.strictEqual(multiple.answer.score, 10);
  assert.strictEqual(multiple.answer.correctText, null);

  const judgment = result.questions[3];
  assert.strictEqual(judgment.answer.user, "对");
  assert.strictEqual(judgment.answer.correct, null);
  assert.strictEqual(judgment.answer.result, "unknown");
  assert.strictEqual(judgment.answer.score, 20);
  assert.deepStrictEqual(
    judgment.options.map((option) => option.text),
    ["对", "错"]
  );
});

test("答案页外层 .fanyaMarking.TiMu 不产生假题，隐藏文本不进入答案", () => {
  const first = parse(firstAnswerPage);
  const second = parse(secondAnswerPage);

  assert.strictEqual(first.stats.containers, 2);
  assert.strictEqual(second.stats.containers, 5);
  assert.ok(
    first.questions.every(
      (question) =>
        !question.stem.includes("测试作业一") &&
        !question.stem.includes("题量")
    )
  );
  assert.ok(
    second.questions.every(
      (question) =>
        !question.stem.includes("测试作业二") &&
        !question.stem.includes("题量")
    )
  );

  assert.doesNotMatch(JSON.stringify(first.questions), /隐藏答案文本不可读取/);
  assert.doesNotMatch(JSON.stringify(first.questions), /隐藏子文本/);
  assert.doesNotMatch(JSON.stringify(second.questions), /隐藏文本不可读取/);
});

test("答案页多选题 AD 与判断题选项不会串题", () => {
  const result = parse(secondAnswerPage);
  const multiple = result.questions[2];
  const firstJudgment = result.questions[3];

  assert.deepStrictEqual(
    multiple.options.map((option) => option.label),
    ["A", "B", "C", "D"]
  );
  assert.deepStrictEqual(
    multiple.options.map((option) => option.text),
    ["选项甲", "选项乙", "选项丙", "选项丁"]
  );
  assert.strictEqual(multiple.answer.user, "AD");

  assert.deepStrictEqual(
    firstJudgment.options.map((option) => option.label),
    ["A", "B"]
  );
  assert.deepStrictEqual(
    firstJudgment.options.map((option) => option.text),
    ["对", "错"]
  );
  assert.strictEqual(firstJudgment.answer.user, "对");
  assert.notStrictEqual(firstJudgment.answer.user, "AD");
});

test("答案块没有 mark_key 时 correctStatus 为 unknown", () => {
  const result = parse(`
    <div class="questionLi fontLabel singleQuesId" typename="单选题">
      <h3 class="mark_name">1. (单选题) 结构异常题（ ）</h3>
      <ul class="workTextWrapList">
        <li class="workTextWrap">A. 甲</li>
        <li class="workTextWrap">B. 乙</li>
      </ul>
      <div class="mark_answer">
        <div>页面结构异常</div>
      </div>
    </div>
  `);

  assert.strictEqual(result.questions.length, 1);
  const answer = result.questions[0].answer;
  assert.ok(answer);
  assert.strictEqual(answer.user, null);
  assert.strictEqual(answer.correct, null);
  assert.strictEqual(answer.result, "unknown");
  assert.strictEqual(answer.correctStatus, "unknown");
});

test("章节答案样本：同答案、不同答案、缺少答案、无答案区和多题关联", () => {
  const result = parse(chapterAnswerPage);

  assert.strictEqual(result.questions.length, 5);
  assert.deepStrictEqual(
    result.questions.map((question) => question.type),
    [
      "single_choice",
      "single_choice",
      "single_choice",
      "single_choice",
      "multiple_choice"
    ]
  );

  const same = result.questions[0];
  assert.strictEqual(same.answer.user, "A");
  assert.strictEqual(same.answer.correct, "A");
  assert.strictEqual(same.answer.userText, "选项甲");
  assert.strictEqual(same.answer.correctText, "选项甲");
  assert.strictEqual(same.answer.result, "correct");
  assert.strictEqual(same.answer.score, null);
  assert.strictEqual(same.answer.correctStatus, "visible");

  const different = result.questions[1];
  assert.strictEqual(different.answer.user, "B");
  assert.strictEqual(different.answer.correct, "C");
  assert.strictEqual(different.answer.userText, "选项乙");
  assert.strictEqual(different.answer.correctText, "选项丙");
  assert.strictEqual(different.answer.result, "incorrect");
  assert.strictEqual(different.answer.correctStatus, "visible");

  const onlyUser = result.questions[2];
  assert.strictEqual(onlyUser.answer.user, "A");
  assert.strictEqual(onlyUser.answer.correct, null);
  assert.strictEqual(onlyUser.answer.correctStatus, "not_visible");
  assert.strictEqual(onlyUser.answer.result, "unknown");

  assert.strictEqual(result.questions[3].answer, null);

  const multiple = result.questions[4];
  assert.strictEqual(multiple.answer.user, "AD");
  assert.strictEqual(multiple.answer.correct, "BD");
  assert.strictEqual(multiple.answer.userText, "选项甲；选项丁");
  assert.strictEqual(multiple.answer.correctText, "选项乙；选项丁");
  assert.strictEqual(multiple.answer.result, "unknown");
});

test("章节答案标签不会混入题干/选项，答案按题关联", () => {
  const result = parse(chapterAnswerPage);
  const questions = result.questions;

  questions.forEach((question) => {
    assert.doesNotMatch(question.stem || "", /我的答案|正确答案/);
    question.options.forEach((option) => {
      assert.doesNotMatch(option.text || "", /我的答案|正确答案/);
    });
  });

  assert.strictEqual(questions[0].answer.correct, "A");
  assert.strictEqual(questions[1].answer.correct, "C");
  assert.strictEqual(questions[2].answer.correct, null);
  assert.strictEqual(questions[4].answer.correct, "BD");
  assert.notStrictEqual(questions[0].answer.correct, questions[1].answer.correct);
});

test("章节批改结果：正确/错误/未知、分数和缺失字段", () => {
  const result = parse(chapterGradedAnswerPage);

  assert.strictEqual(result.questions.length, 7);

  const correct = result.questions[0];
  assert.strictEqual(correct.answer.user, "D");
  assert.strictEqual(correct.answer.correct, "D");
  assert.strictEqual(correct.answer.userText, "选项丁");
  assert.strictEqual(correct.answer.correctText, "选项丁");
  assert.strictEqual(correct.answer.result, "correct");
  assert.strictEqual(correct.answer.score, 2);
  assert.strictEqual(correct.answer.correctStatus, "visible");

  const incorrectA = result.questions[1];
  assert.strictEqual(incorrectA.answer.user, "E");
  assert.strictEqual(incorrectA.answer.correct, "A");
  assert.strictEqual(incorrectA.answer.result, "incorrect");
  assert.strictEqual(incorrectA.answer.score, 0);

  const incorrectC = result.questions[2];
  assert.strictEqual(incorrectC.answer.user, "E");
  assert.strictEqual(incorrectC.answer.correct, "C");
  assert.strictEqual(incorrectC.answer.result, "incorrect");
  assert.strictEqual(incorrectC.answer.score, 0);

  const noMark = result.questions[3];
  assert.strictEqual(noMark.answer.user, "A");
  assert.strictEqual(noMark.answer.correct, "A");
  assert.strictEqual(noMark.answer.result, "correct");
  assert.strictEqual(noMark.answer.score, 2);

  const noCorrect = result.questions[4];
  assert.strictEqual(noCorrect.answer.user, "A");
  assert.strictEqual(noCorrect.answer.correct, null);
  assert.strictEqual(noCorrect.answer.correctStatus, "not_visible");
  assert.strictEqual(noCorrect.answer.result, "unknown");
  assert.strictEqual(noCorrect.answer.score, 2);

  const noScore = result.questions[5];
  assert.strictEqual(noScore.answer.result, "correct");
  assert.strictEqual(noScore.answer.score, null);

  const bothMarks = result.questions[6];
  assert.strictEqual(bothMarks.answer.result, "unknown");
  assert.strictEqual(bothMarks.answer.score, 2);
});

test("章节批改标记和分数不串题，也不污染题干/选项", () => {
  const result = parse(chapterGradedAnswerPage);
  const questions = result.questions;

  questions.forEach((question) => {
    assert.doesNotMatch(
      question.stem || "",
      /我的答案[:：]|正确答案[:：]|marking_|scoreNum/
    );
    question.options.forEach((option) => {
      assert.doesNotMatch(
        option.text || "",
        /我的答案[:：]|正确答案[:：]|marking_|scoreNum/
      );
    });
  });

  assert.strictEqual(questions[0].answer.result, "correct");
  assert.strictEqual(questions[1].answer.result, "incorrect");
  assert.strictEqual(questions[2].answer.result, "incorrect");
  assert.strictEqual(questions[3].answer.result, "correct");
  assert.strictEqual(questions[4].answer.result, "unknown");
  assert.strictEqual(questions[5].answer.result, "correct");
  assert.strictEqual(questions[6].answer.result, "unknown");
  assert.strictEqual(questions[0].answer.score, 2);
  assert.strictEqual(questions[1].answer.score, 0);
  assert.strictEqual(questions[2].answer.score, 0);
});

test("无批改标记时按题型比较答案", () => {
  const result = parse(chapterComparisonPage);

  assert.strictEqual(result.questions.length, 8);

  const singleSame = result.questions[0];
  assert.strictEqual(singleSame.type, "single_choice");
  assert.strictEqual(singleSame.answer.result, "correct");

  const singleDifferent = result.questions[1];
  assert.strictEqual(singleDifferent.type, "single_choice");
  assert.strictEqual(singleDifferent.answer.result, "incorrect");

  const multipleSame = result.questions[2];
  assert.strictEqual(multipleSame.type, "multiple_choice");
  assert.strictEqual(multipleSame.answer.user, "ABC");
  assert.strictEqual(multipleSame.answer.correct, "abc");
  assert.strictEqual(multipleSame.answer.result, "correct");

  const multipleDifferent = result.questions[3];
  assert.strictEqual(multipleDifferent.type, "multiple_choice");
  assert.strictEqual(multipleDifferent.answer.result, "unknown");

  const markedIncorrect = result.questions[4];
  assert.strictEqual(markedIncorrect.answer.user, "A");
  assert.strictEqual(markedIncorrect.answer.correct, "A");
  assert.strictEqual(markedIncorrect.answer.result, "incorrect");

  const markedCorrect = result.questions[5];
  assert.strictEqual(markedCorrect.answer.user, "A");
  assert.strictEqual(markedCorrect.answer.correct, "B");
  assert.strictEqual(markedCorrect.answer.result, "correct");

  const bothMarks = result.questions[6];
  assert.strictEqual(bothMarks.answer.result, "unknown");

  const noCorrect = result.questions[7];
  assert.strictEqual(noCorrect.answer.correct, null);
  assert.strictEqual(noCorrect.answer.result, "unknown");
  assert.strictEqual(noCorrect.answer.correctStatus, "not_visible");
});

console.log("");
if (failed > 0) {
  console.error(`测试失败：${failed} 个用例未通过`);
  process.exitCode = 1;
} else {
  console.log("全部题目解析测试通过");
}
