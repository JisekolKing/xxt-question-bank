"use strict";

/**
 * 作业答案页脱敏夹具。
 *
 * 结构来自真实 /mooc-ans/mooc2/work/view 页面：
 * - 外层 .fanyaMarking.TiMu 是整页包装，不是单题；
 * - 单题边界是 .questionLi；
 * - 选项是 li.workTextWrap；
 * - 判断题选项是没有 class 的 li[tabindex="0"]；
 * - 答案块是 .mark_answer。
 *
 * 题目文字、课程名和答案均已替换为通用测试数据。
 */

const firstAnswerPage = `
  <div class="fanyaMarking TiMu">
    <div class="page-title">作业标题：测试作业一</div>
    <div class="questionLi fontLabel singleQuesId">
      <h3 class="mark_name">1. (单选题) 第一题（ ）</h3>
      <ul class="workTextWrapList">
        <li class="workTextWrap">A. 选项甲</li>
        <li class="workTextWrap">B. 选项乙</li>
        <li class="workTextWrap">C. 选项丙</li>
        <li class="workTextWrap">D. 选项丁</li>
      </ul>
      <div class="mark_answer" tabindex="0">
        <div class="mark_key clearfix">
          <span class="colorDeep marginRight40 fl">
            <i class="fontWeight custom-style">我的答案:</i>
            <span class="stuAnswerContent">C</span>
          </span>
          <span class="element-invisible-hidden">C : 隐藏答案文本不可读取</span>
          <span class="colorGreen marginRight40 fl">
            <i class="fontWeight custom-style">正确答案:</i>
            <span class="rightAnswerContent workTextWrap" hidden>A</span>
            <span class="rightAnswerContent workTextWrap" style="display: none">D</span>
            <span class="rightAnswerContent workTextWrap">C<span class="element-invisible-hidden">隐藏子文本</span></span>
          </span>
        </div>
        <div class="mark_score">
          <span class="marking_dui"></span>
          <div class="totalScore fr"><i class="custom-style">5</i>分</div>
        </div>
      </div>
    </div>

    <div class="questionLi fontLabel singleQuesId">
      <h3 class="mark_name">2. (单选题) 第二题（ ）</h3>
      <ul class="workTextWrapList">
        <li class="workTextWrap">A. 选项甲</li>
        <li class="workTextWrap">B. 选项乙</li>
        <li class="workTextWrap">C. 选项丙</li>
        <li class="workTextWrap">D. 选项丁</li>
      </ul>
      <div class="mark_answer" tabindex="0">
        <div class="mark_key clearfix">
          <span class="colorDeep marginRight40 fl">
            <i class="fontWeight custom-style">我的答案:</i>
            <span class="stuAnswerContent">B</span>
          </span>
          <span class="colorGreen marginRight40 fl">
            <i class="fontWeight custom-style">正确答案:</i>
            <span class="rightAnswerContent workTextWrap" aria-hidden="true">D</span>
            <span class="rightAnswerContent workTextWrap">A</span>
          </span>
        </div>
        <div class="mark_score">
          <span class="marking_cuo"></span>
          <div class="totalScore fr"><i class="custom-style">0</i>分</div>
        </div>
      </div>
    </div>
  </div>
`;

const secondAnswerPage = `
  <div class="fanyaMarking TiMu">
    <div class="page-title">作业标题：测试作业二</div>

    <div class="questionLi fontLabel singleQuesId">
      <h3 class="mark_name">1. (单选题) 第一题（ ）</h3>
      <ul class="workTextWrapList">
        <li class="workTextWrap">A. 选项甲</li>
        <li class="workTextWrap">B. 选项乙</li>
      </ul>
      <div class="mark_answer" tabindex="0">
        <div class="mark_key clearfix">
          <span class="colorDeep marginRight40 fl">
            <i class="fontWeight custom-style">我的答案:</i>
            <span class="stuAnswerContent">A</span>
          </span>
          <span class="element-invisible-hidden">隐藏文本不可读取</span>
        </div>
        <div class="mark_score">
          <div class="totalScore fr"><i class="custom-style">20</i>分</div>
        </div>
      </div>
    </div>

    <div class="questionLi fontLabel singleQuesId">
      <h3 class="mark_name">2. (单选题) 第二题（ ）</h3>
      <ul class="workTextWrapList">
        <li class="workTextWrap">A. 选项甲</li>
        <li class="workTextWrap">B. 选项乙</li>
      </ul>
      <div class="mark_answer" tabindex="0">
        <div class="mark_key clearfix">
          <span class="colorDeep marginRight40 fl">
            <i class="fontWeight custom-style">我的答案:</i>
            <span class="stuAnswerContent">D</span>
          </span>
        </div>
        <div class="mark_score">
          <div class="totalScore fr"><i class="custom-style">20</i>分</div>
        </div>
      </div>
    </div>

    <div class="questionLi fontLabel singleQuesId">
      <h3 class="mark_name">3. (多选题) 多选题目（ ）</h3>
      <ul class="workTextWrapList">
        <li class="workTextWrap">A. 选项甲</li>
        <li class="workTextWrap">B. 选项乙</li>
        <li class="workTextWrap">C. 选项丙</li>
        <li class="workTextWrap">D. 选项丁</li>
      </ul>
      <div class="mark_answer" tabindex="0">
        <div class="mark_key clearfix">
          <span class="colorDeep marginRight40 fl">
            <i class="fontWeight custom-style">我的答案:</i>
            <span class="stuAnswerContent">AD</span>
          </span>
        </div>
        <div class="mark_score">
          <div class="totalScore fr"><i class="custom-style">10</i>分</div>
        </div>
      </div>
    </div>

    <div class="questionLi fontLabel singleQuesId">
      <h3 class="mark_name">4. (判断题) 判断题目一（ ）</h3>
      <ul class="judgmentOptions">
        <li tabindex="0">A. 对</li>
        <li tabindex="0">B. 错</li>
      </ul>
      <div class="mark_answer" tabindex="0">
        <div class="mark_key clearfix">
          <span class="colorDeep marginRight40 fl">
            <i class="fontWeight custom-style">我的答案:</i>
            <span class="stuAnswerContent">对</span>
          </span>
        </div>
        <div class="mark_score">
          <div class="totalScore fr"><i class="custom-style">20</i>分</div>
        </div>
      </div>
    </div>

    <div class="questionLi fontLabel singleQuesId" typename="判断题">
      <h3 class="mark_name">5. (判断题) 判断题目二（ ）</h3>
      <ul class="judgmentOptions">
        <li tabindex="0">A. 对</li>
        <li tabindex="0">B. 错</li>
      </ul>
      <div class="mark_answer" tabindex="0">
        <div class="mark_key clearfix">
          <span class="colorDeep marginRight40 fl">
            <i class="fontWeight custom-style">我的答案:</i>
            <span class="stuAnswerContent">错</span>
          </span>
        </div>
        <div class="mark_score">
          <div class="totalScore fr"><i class="custom-style">20</i>分</div>
        </div>
      </div>
    </div>
  </div>
`;

const chapterAnswerPage = `
  <div class="TiMu newTiMu ans-cc singleQuesId" typename="单选题">
    <div class="Zy_TItle"><span class="q_type">单选题</span>1. 章节第一题（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
      <li><span class="fl">C、</span><div class="answer_p">选项丙</div></li>
      <li><span class="fl">D、</span><div class="answer_p">选项丁</div></li>
    </ul>
    <div class="newAnswerBx">
      <span class="answerFont fl">我的答案：</span>
      <span class="myAnswer">A</span>
      <span class="answerFont fl">正确答案：</span>
      <span class="correctAnswer">A</span>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>2. 章节第二题（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
      <li><span class="fl">C、</span><div class="answer_p">选项丙</div></li>
      <li><span class="fl">D、</span><div class="answer_p">选项丁</div></li>
    </ul>
    <div class="newAnswerBx">
      <span class="answerFont fl">我的答案：</span>
      <span class="myAnswer">我的答案：B</span>
      <span class="answerFont fl">正确答案：</span>
      <span class="correctAnswer">正确答案：C</span>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>3. 章节第三题（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
    </ul>
    <div class="newAnswerBx">
      <span class="answerFont fl">我的答案：</span>
      <span class="myAnswer">A</span>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>4. 章节第四题（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
    </ul>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">多选题</span>5. 章节第五题（ ）</div>
    <ul class="Zy_ulTop">
      <li role="checkbox"><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li role="checkbox"><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
      <li role="checkbox"><span class="fl">C、</span><div class="answer_p">选项丙</div></li>
      <li role="checkbox"><span class="fl">D、</span><div class="answer_p">选项丁</div></li>
    </ul>
    <div class="newAnswerBx">
      <span class="answerFont fl">我的答案：</span>
      <span class="myAnswer">AD</span>
      <span class="answerFont fl">正确答案：</span>
      <span class="correctAnswer">BD</span>
    </div>
  </div>
`;

const chapterGradedAnswerPage = `
  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>1. 批改正确题（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
      <li><span class="fl">C、</span><div class="answer_p">选项丙</div></li>
      <li><span class="fl">D、</span><div class="answer_p">选项丁</div></li>
    </ul>
    <div class="newAnswerBx">
      <div class="myAnswerBx">
        <div class="answerScore">
          <span class="CorrectOrNot"><span class="marking_dui"></span></span>
        </div>
      </div>
      <div class="myAnswer">
        <span class="answerFont fl">我的答案：</span>
        <span class="answerCon">D</span>
      </div>
      <div class="correctAnswer">
        <span class="answerFont fl">正确答案：</span>
        <span class="answerCon">D</span>
      </div>
      <div class="scoreNum">2.0</div>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>2. 批改错误题一（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
      <li><span class="fl">C、</span><div class="answer_p">选项丙</div></li>
      <li><span class="fl">D、</span><div class="answer_p">选项丁</div></li>
    </ul>
    <div class="newAnswerBx">
      <div class="myAnswerBx">
        <div class="answerScore">
          <span class="CorrectOrNot"><span class="marking_cuo"></span></span>
        </div>
      </div>
      <div class="myAnswer">
        <span class="answerFont fl">我的答案：</span>
        <span class="answerCon">E</span>
      </div>
      <div class="correctAnswer">
        <span class="answerFont fl">正确答案：</span>
        <span class="answerCon">A</span>
      </div>
      <div class="scoreNum">0.0</div>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>3. 批改错误题二（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
      <li><span class="fl">C、</span><div class="answer_p">选项丙</div></li>
      <li><span class="fl">D、</span><div class="answer_p">选项丁</div></li>
    </ul>
    <div class="newAnswerBx">
      <div class="myAnswerBx">
        <div class="answerScore">
          <span class="CorrectOrNot"><span class="marking_cuo"></span></span>
        </div>
      </div>
      <div class="myAnswer">
        <span class="answerFont fl">我的答案：</span>
        <span class="answerCon">E</span>
      </div>
      <div class="correctAnswer">
        <span class="answerFont fl">正确答案：</span>
        <span class="answerCon">C</span>
      </div>
      <div class="scoreNum">0.0</div>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>4. 无批改标记题（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
    </ul>
    <div class="newAnswerBx">
      <div class="myAnswer">
        <span class="answerFont fl">我的答案：</span>
        <span class="answerCon">A</span>
      </div>
      <div class="correctAnswer">
        <span class="answerFont fl">正确答案：</span>
        <span class="answerCon">A</span>
      </div>
      <div class="scoreNum">2.0</div>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>5. 没有正确答案题（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
    </ul>
    <div class="newAnswerBx">
      <div class="myAnswer">
        <span class="answerFont fl">我的答案：</span>
        <span class="answerCon">A</span>
      </div>
      <div class="scoreNum">2.0</div>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>6. 没有分数题（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
    </ul>
    <div class="newAnswerBx">
      <div class="myAnswerBx">
        <div class="answerScore">
          <span class="CorrectOrNot"><span class="marking_dui"></span></span>
        </div>
      </div>
      <div class="myAnswer">
        <span class="answerFont fl">我的答案：</span>
        <span class="answerCon">A</span>
      </div>
      <div class="correctAnswer">
        <span class="answerFont fl">正确答案：</span>
        <span class="answerCon">A</span>
      </div>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>7. 同时存在两种标记题（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
    </ul>
    <div class="newAnswerBx">
      <div class="myAnswerBx">
        <div class="answerScore">
          <span class="CorrectOrNot">
            <span class="marking_dui"></span>
            <span class="marking_cuo"></span>
          </span>
        </div>
      </div>
      <div class="myAnswer">
        <span class="answerFont fl">我的答案：</span>
        <span class="answerCon">A</span>
      </div>
      <div class="correctAnswer">
        <span class="answerFont fl">正确答案：</span>
        <span class="answerCon">A</span>
      </div>
      <div class="scoreNum">2.0</div>
    </div>
  </div>
`;

const chapterComparisonPage = `
  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>1. 单选相同（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
    </ul>
    <div class="newAnswerBx">
      <div class="myAnswer"><span class="answerFont fl">我的答案：</span><span class="answerCon">B</span></div>
      <div class="correctAnswer"><span class="answerFont fl">正确答案：</span><span class="answerCon">B</span></div>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>2. 单选不同（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
      <li><span class="fl">C、</span><div class="answer_p">选项丙</div></li>
    </ul>
    <div class="newAnswerBx">
      <div class="myAnswer"><span class="answerFont fl">我的答案：</span><span class="answerCon">A</span></div>
      <div class="correctAnswer"><span class="answerFont fl">正确答案：</span><span class="answerCon">C</span></div>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">多选题</span>3. 多选相同（ ）</div>
    <ul class="Zy_ulTop">
      <li role="checkbox"><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li role="checkbox"><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
      <li role="checkbox"><span class="fl">C、</span><div class="answer_p">选项丙</div></li>
      <li role="checkbox"><span class="fl">D、</span><div class="answer_p">选项丁</div></li>
    </ul>
    <div class="newAnswerBx">
      <div class="myAnswer"><span class="answerFont fl">我的答案：</span><span class="answerCon">ABC</span></div>
      <div class="correctAnswer"><span class="answerFont fl">正确答案：</span><span class="answerCon">abc</span></div>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">多选题</span>4. 多选不同（ ）</div>
    <ul class="Zy_ulTop">
      <li role="checkbox"><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li role="checkbox"><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
      <li role="checkbox"><span class="fl">C、</span><div class="answer_p">选项丙</div></li>
      <li role="checkbox"><span class="fl">D、</span><div class="answer_p">选项丁</div></li>
    </ul>
    <div class="newAnswerBx">
      <div class="myAnswer"><span class="answerFont fl">我的答案：</span><span class="answerCon">ABC</span></div>
      <div class="correctAnswer"><span class="answerFont fl">正确答案：</span><span class="answerCon">ABD</span></div>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>5. 相同但判错（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
    </ul>
    <div class="newAnswerBx">
      <div class="myAnswerBx"><div class="answerScore"><span class="CorrectOrNot"><span class="marking_cuo"></span></span></div></div>
      <div class="myAnswer"><span class="answerFont fl">我的答案：</span><span class="answerCon">A</span></div>
      <div class="correctAnswer"><span class="answerFont fl">正确答案：</span><span class="answerCon">A</span></div>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>6. 不同但判对（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
    </ul>
    <div class="newAnswerBx">
      <div class="myAnswerBx"><div class="answerScore"><span class="CorrectOrNot"><span class="marking_dui"></span></span></div></div>
      <div class="myAnswer"><span class="answerFont fl">我的答案：</span><span class="answerCon">A</span></div>
      <div class="correctAnswer"><span class="answerFont fl">正确答案：</span><span class="answerCon">B</span></div>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>7. 两种标记（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
    </ul>
    <div class="newAnswerBx">
      <div class="myAnswerBx">
        <div class="answerScore">
          <span class="CorrectOrNot">
            <span class="marking_dui"></span>
            <span class="marking_cuo"></span>
          </span>
        </div>
      </div>
      <div class="myAnswer"><span class="answerFont fl">我的答案：</span><span class="answerCon">A</span></div>
      <div class="correctAnswer"><span class="answerFont fl">正确答案：</span><span class="answerCon">A</span></div>
    </div>
  </div>

  <div class="TiMu newTiMu ans-cc singleQuesId">
    <div class="Zy_TItle"><span class="q_type">单选题</span>8. 没有正确答案（ ）</div>
    <ul class="Zy_ulTop">
      <li><span class="fl">A、</span><div class="answer_p">选项甲</div></li>
      <li><span class="fl">B、</span><div class="answer_p">选项乙</div></li>
    </ul>
    <div class="newAnswerBx">
      <div class="myAnswer"><span class="answerFont fl">我的答案：</span><span class="answerCon">A</span></div>
    </div>
  </div>
`;

module.exports = {
  firstAnswerPage,
  secondAnswerPage,
  chapterAnswerPage,
  chapterGradedAnswerPage,
  chapterComparisonPage
};
