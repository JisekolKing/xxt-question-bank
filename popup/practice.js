"use strict";

/**
 * 学习通题库助手 · 模拟练习纯数据层
 *
 * 只负责组卷、答案解析与判分；不读取 DOM，不修改题库。
 */

(function (root, factory) {
  const api = factory();
  root.QuestionPractice = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeAnswer(value) {
    if (value == null) return "";
    return String(value)
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .split("")
      .filter((letter, index, letters) => letters.indexOf(letter) === index)
      .sort()
      .join("");
  }

  function normalizeMode(mode) {
    return mode === "random" ? "random" : "sequential";
  }

  function createSession(questions, options) {
    const opts = options || {};
    const source = Array.isArray(questions) ? questions.slice() : [];
    const mode = normalizeMode(opts.mode);
    const random =
      typeof opts.random === "function" ? opts.random : Math.random;
    if (mode === "random") {
      for (let index = source.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        const temp = source[index];
        source[index] = source[swap];
        source[swap] = temp;
      }
    }
    return {
      mode,
      questions: source,
      total: source.length
    };
  }

  function correctValue(question) {
    const answer = question && question.correctAnswer;
    if (
      !answer ||
      answer.status !== "visible" ||
      !answer.value ||
      !normalizeAnswer(answer.value)
    ) {
      return null;
    }
    return normalizeAnswer(answer.value);
  }

  function gradeAnswer(question, userAnswer) {
    const expected = correctValue(question);
    const actual = normalizeAnswer(userAnswer);
    if (!expected) {
      return {
        result: "unknown",
        userAnswer: actual,
        correctAnswer: null
      };
    }
    return {
      result: actual === expected ? "correct" : "incorrect",
      userAnswer: actual,
      correctAnswer: expected
    };
  }

  function answerText(question, value) {
    const options = Array.isArray(question && question.options)
      ? question.options
      : [];
    const normalized = normalizeAnswer(value);
    if (!normalized) return "";
    return normalized
      .split("")
      .map((letter) => {
        const option = options.find(
          (item) => normalizeAnswer(item.label) === letter
        );
        return option && option.text ? option.text : letter;
      })
      .join("；");
  }

  function createAttemptId(nowValue, sequence) {
    const base = Number.isFinite(nowValue) ? nowValue : Date.now();
    const suffix = Number.isFinite(sequence) ? sequence : Math.random();
    return `attempt_${base}_${String(suffix).replace(/[^a-zA-Z0-9]/g, "")}`;
  }

  function buildSummary(answers, startedAt, finishedAt, totalOverride) {
    const list = Array.isArray(answers) ? answers.filter(Boolean) : [];
    const correct = list.filter((item) => item.result === "correct").length;
    const incorrect = list.filter((item) => item.result === "incorrect")
      .length;
    const unknown = list.filter((item) => item.result === "unknown").length;
    const answered = list.length;
    const total =
      Number.isFinite(totalOverride) && totalOverride >= answered
        ? totalOverride
        : answered;
    const start = Number.isFinite(startedAt) ? startedAt : 0;
    const end = Number.isFinite(finishedAt) ? finishedAt : start;
    return {
      total,
      answered,
      correct,
      incorrect,
      unknown,
      accuracy: answered > 0 ? Math.round((correct / answered) * 100) : 0,
      elapsedMs: Math.max(0, end - start)
    };
  }

  function buildDeepSeekPrompt(question) {
    const item = question || {};
    const stem = String(item.stem || "").trim();
    if (!stem) return "";
    const options = Array.isArray(item.options) ? item.options : [];
    const optionLines = options
      .filter((option) => option && option.label)
      .map(
        (option) =>
          `${option.label}. ${
            option.text ||
            (option.textStatus === "ok" ? "" : "（文字不可读）")
          }`
      )
      .join("\n");
    return [
      "你是一名课程辅导老师。请独立解答下面这道课程练习题，不要假设我已经知道答案，也不要只给结论。",
      "",
      "请严格按以下结构输出：",
      "1. 正确答案：如果是多选题，请列出全部正确选项。",
      "2. 详细解析：解释为什么选它。",
      "3. 逐项排除：说明其他选项为什么错。",
      "4. 关键知识点：这道题对应的知识点。",
      "5. 易错提醒：最容易混淆的地方。",
      "6. 如果题目信息不足，请明确指出，不要编造。",
      "",
      "题目：",
      stem,
      ...(optionLines ? ["", "选项：", optionLines] : [])
    ].join("\n");
  }

  const api = {
    normalizeAnswer,
    createSession,
    correctValue,
    gradeAnswer,
    answerText,
    createAttemptId,
    buildSummary,
    buildDeepSeekPrompt
  };
  return api;
});
