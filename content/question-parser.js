"use strict";

/**
 * 学习通课程题库助手 · 题目解析器
 *
 * 在用户点击「读取当前页面题目」后，由 chrome.scripting.executeScript 注入页面。
 * 当前支持：
 *   - 章节题库：单选题、多选题；
 *   - 课程作业：单选题、多选题、判断题；
 *   - 作业答案页：读取当前题目的“我的答案”“正确答案”、对错标识和分数；
 *   - 按题干/选项分别判断文字是否受保护，不读取受保护文字。
 *
 * 解析策略（按优先级）：
 *   1. 已知题目容器：.TiMu（章节题库）、.questionLi（作业）等；
 *   2. 题型标签：.newZy_TItle、typename、题干前缀等；
 *   3. 选项容器：.Zy_ulTop / .stem_answer / .mark_letter 等；
 *   4. 没有已知容器时，用 radio 分组向上寻找题目容器作为兜底。
 *
 * 注意：函数名 extractSingleChoiceQuestions 为兼容旧调用保留，
 * 实际已支持单选题和多选题。
 *
 * 本函数会被序列化后注入页面，因此必须完全自包含。
 */

globalThis.extractSingleChoiceQuestions = function extractSingleChoiceQuestions(
  config
) {
  "use strict";

  const settings = config || {};
  const requireVisible = settings.requireVisible !== false;
  const maxQuestions =
    Number(settings.maxQuestions) > 0 ? Number(settings.maxQuestions) : 100;

  const QUESTION_SELECTORS = [
    ".TiMu",
    ".singleQuesId",
    ".questionLi[typename]",
    ".questionLi.fontLabel.singleQuesId",
    ".questionLi",
    ".question-item",
    ".que-item",
    ".exam-question",
    ".subject-item",
    ".question",
    "[data-questionid]",
    "[data-question-id]"
  ];

  const STEM_SELECTORS = [
    ".Zy_TItle",
    ".fl.clearfix",
    "h3.mark_name p",
    ".mark_name",
    ".question-title",
    ".questionTitle",
    ".q-title",
    ".que-title",
    ".timu-title",
    ".stem",
    ".question-stem",
    ".questionStem",
    ".question-content"
  ];

  const OPTION_LIST_SELECTORS = [
    ".Cy_ulTop",
    ".Zy_ulTop",
    ".mark_letter",
    ".stem_answer",
    ".option-list",
    ".optionList",
    ".options",
    ".answerList",
    ".answer-list"
  ];

  const OPTION_ITEM_SELECTORS = [
    "ul.Cy_ulTop > li",
    "ul.Zy_ulTop > li",
    ".mark_letter > li",
    ".option-list > li",
    ".optionList > li",
    ".options > li",
    ".answerList > li",
    ".answer-list > li",
    "ul.Zy_ulTop > li[role='radio']",
    "ul.Zy_ulTop > li[role='checkbox']",
    "li[role='radio']",
    "li[role='checkbox']",
    ".stem_answer .answerBg",
    ".answerBg",
    "ul.Cy_ulTop li",
    "ul.Zy_ulTop li",
    ".mark_letter li",
    ".option-list li",
    ".options li",
    ".option-item",
    "[class*='optionItem']",
    "[class*='option-item']",
    ".option",
    ".answer-item",
    // 作业答案详情页（/mooc-ans/mooc2/work/view）的选项结构。
    "li.workTextWrap",
    // 该页面的判断题选项没有 class，只有 tabindex="0"。
    "li[tabindex='0']"
  ];

  const ANSWER_SELECTORS = [
    ".Py_answer",
    ".rightAnswer",
    ".right-answer",
    ".analysis",
    ".answer-analysis",
    ".answerContent",
    ".mark_answer",
    // 章节测验/练习的新答案区，避免标签或答案文字混入题干/选项。
    ".newAnswerBx",
    ".myAnswerBx",
    ".answerScore",
    ".CorrectOrNot",
    ".myAnswer",
    ".correctAnswer",
    ".scoreNum"
  ];

  const OPTION_TEXT_SELECTOR =
    ".after p, .after > p, a.after p, .answer_p, .option-text, .optionText, .option-content, .optionContent, .answer-content";

  const QUESTION_BOUNDARY_SELECTOR =
    ".TiMu, .questionLi, .singleQuesId";

  const stats = {
    containers: 0,
    extracted: 0,
    protectedText: 0,
    mixedText: 0,
    skippedMultiple: 0,
    skippedOtherType: 0,
    skippedUnknownType: 0,
    skippedIncomplete: 0,
    skippedHomeworkUnsupported: 0,
    duplicates: 0,
    inferredLabels: 0
  };

  const questions = [];
  const skipped = [];

  // ---------- 基础工具 ----------

  function normalize(value) {
    return String(value == null ? "" : value)
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function rawReadText(element) {
    if (!element) {
      return "";
    }
    if (
      typeof element.innerText === "string" &&
      element.innerText.trim() !== ""
    ) {
      return element.innerText;
    }
    return element.textContent || "";
  }

  function decodeWithFont(raw, element, forceDecode) {
    const decoder = globalThis.CXSecret;
    if (!decoder || !raw || !element) {
      return null;
    }

    const marked =
      forceDecode === true ||
      (typeof element.closest === "function" &&
        Boolean(element.closest(".font-cxsecret"))) ||
      (typeof element.querySelector === "function" &&
        Boolean(element.querySelector(".font-cxsecret")));

    if (!marked) {
      return null;
    }

    let info;
    try {
      info = decoder.getFontInfo();
    } catch (error) {
      console.warn("cxsecret：读取页面字体失败", error);
      return null;
    }
    if (!info) {
      return null;
    }

    return decoder.decodeText(raw, info);
  }

  function readText(element, forceDecode) {
    const raw = rawReadText(element);
    const decoded = decodeWithFont(raw, element, forceDecode);
    if (decoded && decoded.complete && decoded.changed) {
      return normalize(decoded.text);
    }
    return normalize(raw);
  }

  function toAbsoluteUrl(value) {
    const text = normalize(value);
    if (!text) {
      return "";
    }
    try {
      return new URL(text, location.href).href;
    } catch (error) {
      return text;
    }
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }
    if (element.isConnected === false) {
      return false;
    }
    if (element.hidden || element.hasAttribute("hidden")) {
      return false;
    }
    if (element.getAttribute("aria-hidden") === "true") {
      return false;
    }

    const inlineStyle = element.getAttribute("style") || "";
    if (
      /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:[;\s]|$)/i.test(
        inlineStyle
      )
    ) {
      return false;
    }

    if (!requireVisible) {
      return true;
    }

    if (
      typeof window !== "undefined" &&
      typeof window.getComputedStyle === "function"
    ) {
      const style = window.getComputedStyle(element);
      if (style) {
        if (style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        if (style.opacity === "0") {
          return false;
        }
      }
    }

    if (typeof element.getClientRects === "function") {
      const rects = element.getClientRects();
      if (rects && rects.length === 0) {
        return false;
      }
    }

    return true;
  }

  function isAnswerNode(element) {
    if (!element || typeof element.closest !== "function") {
      return false;
    }
    return Boolean(element.closest(ANSWER_SELECTORS.join(",")));
  }

  function isAnswerNodeVisible(node, root) {
    if (!node || !root || !root.contains(node)) {
      return false;
    }

    let current = node;
    while (current && current !== root.parentElement) {
      if (current.hidden || current.hasAttribute("hidden")) {
        return false;
      }
      if (current.getAttribute("aria-hidden") === "true") {
        return false;
      }

      const className =
        typeof current.className === "string" ? current.className : "";
      if (/\belement-invisible-hidden\b/.test(className)) {
        return false;
      }

      const inlineStyle = current.getAttribute("style") || "";
      if (
        /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:[;\s]|$)/i.test(
          inlineStyle
        )
      ) {
        return false;
      }

      if (
        typeof window !== "undefined" &&
        typeof window.getComputedStyle === "function"
      ) {
        try {
          const style = window.getComputedStyle(current);
          if (
            style &&
            (style.display === "none" ||
              style.visibility === "hidden" ||
              style.opacity === "0")
          ) {
            return false;
          }
        } catch (error) {
          // 样式读取失败时不把节点误判为可见。
          return false;
        }
      }

      current = current.parentElement;
    }

    return true;
  }

  function findVisibleAnswerNode(root, selector) {
    if (!root) {
      return null;
    }
    const nodes = root.querySelectorAll(selector);
    for (const node of nodes) {
      if (isAnswerNodeVisible(node, root)) {
        return node;
      }
    }
    return null;
  }

  function readAnswerText(node) {
    if (!node) {
      return "";
    }

    const clone = node.cloneNode(true);
    clone
      .querySelectorAll(
        ".element-invisible-hidden, [hidden], [aria-hidden='true']"
      )
      .forEach((hiddenNode) => hiddenNode.remove());
    clone.querySelectorAll("[style]").forEach((styledNode) => {
      const style = styledNode.getAttribute("style") || "";
      if (
        /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:[;\s]|$)/i.test(
          style
        )
      ) {
        styledNode.remove();
      }
    });

    return normalize(clone.textContent || "");
  }

  function readAnswerScore(node) {
    if (!node) {
      return null;
    }
    const match = /(\d+(?:\.\d+)?)/.exec(readAnswerText(node));
    if (!match) {
      return null;
    }
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  function extractAnswerInfo(container) {
    if (!container) {
      return null;
    }

    const blocks = Array.from(container.querySelectorAll(".mark_answer"));
    const answerBlock = blocks.find((node) =>
      isAnswerNodeVisible(node, container)
    );
    if (!answerBlock) {
      return null;
    }

    const userNode = findVisibleAnswerNode(
      answerBlock,
      ".stuAnswerContent"
    );
    const correctNode = findVisibleAnswerNode(
      answerBlock,
      ".rightAnswerContent"
    );
    const correctIcon = findVisibleAnswerNode(
      answerBlock,
      ".marking_dui"
    );
    const incorrectIcon = findVisibleAnswerNode(
      answerBlock,
      ".marking_cuo"
    );
    const scoreNode =
      findVisibleAnswerNode(answerBlock, ".totalScore i.custom-style") ||
      findVisibleAnswerNode(answerBlock, ".totalScore");

    const user = readAnswerText(userNode) || null;
    const correct = readAnswerText(correctNode) || null;

    let result = "unknown";
    if (correctIcon && !incorrectIcon) {
      result = "correct";
    } else if (incorrectIcon && !correctIcon) {
      result = "incorrect";
    }

    let correctStatus = "not_visible";
    if (correct) {
      correctStatus = "visible";
    } else if (!answerBlock.querySelector(".mark_key")) {
      correctStatus = "unknown";
    }

    return {
      user,
      correct,
      result,
      score: readAnswerScore(scoreNode),
      correctStatus
    };
  }

  function cleanAnswerText(value) {
    const text = normalize(value);
    if (!text) {
      return null;
    }

    const cleaned = text
      .replace(/^\s*我的答案\s*[:：]?\s*/i, "")
      .replace(/^\s*正确答案\s*[:：]?\s*/i, "")
      .trim();
    return cleaned || null;
  }

  function compareChapterAnswers(questionType, user, correct) {
    if (!user || !correct) {
      return "unknown";
    }

    const left = user.trim().toLowerCase();
    const right = correct.trim().toLowerCase();
    if (!left || !right) {
      return "unknown";
    }

    if (questionType === "single_choice") {
      return left === right ? "correct" : "incorrect";
    }
    if (questionType === "multiple_choice") {
      return left === right ? "correct" : "unknown";
    }
    return "unknown";
  }

  function extractChapterAnswerInfo(container, questionType) {
    if (!container) {
      return null;
    }

    const answerBlock = container.querySelector(".newAnswerBx");
    if (!answerBlock || !isAnswerNodeVisible(answerBlock, container)) {
      return null;
    }

    const userNode =
      findVisibleAnswerNode(answerBlock, ".myAnswer .answerCon") ||
      findVisibleAnswerNode(answerBlock, ".myAnswer");
    const correctNode =
      findVisibleAnswerNode(answerBlock, ".correctAnswer .answerCon") ||
      findVisibleAnswerNode(answerBlock, ".correctAnswer");
    const correctIcon = findVisibleAnswerNode(
      answerBlock,
      ".marking_dui"
    );
    const incorrectIcon = findVisibleAnswerNode(
      answerBlock,
      ".marking_cuo"
    );
    const scoreNode = findVisibleAnswerNode(answerBlock, ".scoreNum");

    const user = cleanAnswerText(readAnswerText(userNode));
    const correct = cleanAnswerText(readAnswerText(correctNode));

    let result = "unknown";
    if (correctIcon && !incorrectIcon) {
      result = "correct";
    } else if (incorrectIcon && !correctIcon) {
      result = "incorrect";
    } else if (!correctIcon && !incorrectIcon) {
      result = compareChapterAnswers(questionType, user, correct);
    }

    return {
      user,
      correct,
      result,
      score: readAnswerScore(scoreNode),
      correctStatus: correct ? "visible" : "not_visible"
    };
  }

  function mapAnswerToOptionText(value, options) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || !/^[A-Za-z]+$/.test(text)) {
      return null;
    }

    const parts = [];
    for (const letter of text.toUpperCase()) {
      const option = options.find(
        (item) => String(item.label || "").toUpperCase() === letter
      );
      if (!option) {
        return null;
      }
      parts.push(option.text || letter);
    }
    return parts.join("；");
  }

  function recordSkip(reason, value) {
    if (skipped.length >= 8) {
      return;
    }
    const preview =
      typeof value === "string" ? value : readText(value);
    skipped.push({
      reason,
      preview: normalize(preview).slice(0, 100)
    });
  }

  // ---------- 题目容器 ----------

  function looksLikeQuestion(node, selector) {
    if (
      /TiMu|questionLi|question-item|que-item|exam-question|subject-item|singleQuesId|data-question/i.test(
        selector
      )
    ) {
      return true;
    }

    const inputs = node.querySelectorAll(
      "input[type=radio], input[type=checkbox]"
    );
    if (inputs.length >= 2) {
      return true;
    }

    const text = readText(node).slice(0, 200);
    return text.length >= 8 && /(^|\s)[A-H][.、．)）]/.test(text);
  }

  function collectRadioFallback(list) {
    const radios = Array.from(
      document.querySelectorAll("input[type=radio]")
    ).filter(isVisible);

    if (radios.length < 2) {
      return;
    }

    const groups = new Map();
    radios.forEach((radio, index) => {
      const name = normalize(radio.getAttribute("name"));
      const key = name ? "name:" + name : "index:" + index;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(radio);
    });

    groups.forEach((group) => {
      if (group.length < 2) {
        return;
      }

      let current = group[0].parentElement;
      while (
        current &&
        current !== document.body &&
        !current.contains(group[group.length - 1])
      ) {
        current = current.parentElement;
      }
      if (!current || current === document.body) {
        return;
      }

      let candidate = null;
      let depth = 0;

      while (current && current !== document.body && depth < 8) {
        if (!current.contains(group[group.length - 1])) {
          break;
        }
        const radiosInside = current.querySelectorAll(
          "input[type=radio]"
        ).length;
        if (radiosInside > group.length) {
          break;
        }
        if (readText(current).length >= 8) {
          candidate = current;
        }
        current = current.parentElement;
        depth += 1;
      }

      if (!candidate) {
        return;
      }
      if (
        list.some(
          (existing) =>
            existing === candidate ||
            existing.contains(candidate) ||
            candidate.contains(existing)
        )
      ) {
        return;
      }
      list.push(candidate);
    });
  }

  function sortByDocumentOrder(list) {
    const comparable = list.every(
      (element) => typeof element.compareDocumentPosition === "function"
    );
    if (!comparable) {
      return list;
    }

    return list.slice().sort((a, b) => {
      if (a === b) {
        return 0;
      }
      const position = a.compareDocumentPosition(b);
      if (position & 4) {
        return -1;
      }
      if (position & 2) {
        return 1;
      }
      return 0;
    });
  }

  function countNestedQuestionBoundaries(node) {
    return node.querySelectorAll(QUESTION_BOUNDARY_SELECTOR).length;
  }

  function collectContainers() {
    const candidates = [];
    const seen = new Set();

    for (const selector of QUESTION_SELECTORS) {
      let nodes;
      try {
        nodes = document.querySelectorAll(selector);
      } catch (error) {
        continue;
      }

      for (const node of nodes) {
        if (seen.has(node) || !isVisible(node)) {
          continue;
        }
        if (!looksLikeQuestion(node, selector)) {
          continue;
        }
        seen.add(node);
        candidates.push({ node, selector });
      }
    }

    // 包含多个题目边界的父容器不是单题容器。
    const singleCandidates = candidates.filter(
      (candidate) => countNestedQuestionBoundaries(candidate.node) <= 1
    );

    // 优先使用最内层单题容器，外层只在没有更具体容器时兜底。
    const selected = singleCandidates.filter(
      (candidate) =>
        !singleCandidates.some(
          (other) =>
            other.node !== candidate.node &&
            candidate.node.contains(other.node)
        )
    );

    if (selected.length === 0) {
      const fallback = [];
      collectRadioFallback(fallback);
      return sortByDocumentOrder(fallback);
    }

    return sortByDocumentOrder(
      selected.slice(0, 200).map((candidate) => candidate.node)
    );
  }

  // ---------- 题干 ----------

  function findStemElement(container) {
    for (const selector of STEM_SELECTORS) {
      let nodes;
      try {
        nodes = container.querySelectorAll(selector);
      } catch (error) {
        continue;
      }

      for (const node of nodes) {
        if (!isVisible(node)) {
          continue;
        }
        if (node.querySelector("input[type=radio], input[type=checkbox]")) {
          continue;
        }
        const text = readText(node);
        if (
          text.length >= 2 ||
          node.querySelector("img, math, mjx-container, .MathJax, .katex")
        ) {
          return node;
        }
      }
    }
    return null;
  }

  function stripNonStem(root) {
    // 学习通新结构：题号是 .Zy_TItle 的直接子元素 <i>，不能混入题干。
    if (root.classList && root.classList.contains("Zy_TItle")) {
      Array.from(root.children).forEach((child) => {
        if (child.tagName.toLowerCase() === "i") {
          child.remove();
        }
      });
    }

    // 先移除“包住 radio/checkbox 的选项标签”，避免选项文字混入题干。
    root
      .querySelectorAll("input[type=radio], input[type=checkbox]")
      .forEach((input) => {
        const wrapper = input.closest(
          "label, li, .option, .option-item, .optionItem, .answer-item"
        );
        if (wrapper && wrapper !== root) {
          wrapper.remove();
        }
      });

    const selectors = [
      "script",
      "style",
      "noscript",
      "input",
      "textarea",
      "select",
      "button",
      ".q_type",
      ".q-type",
      ".question-type",
      ".newZy_TItle",
      ".colorShallow",
      ".q_num",
      ".q-num",
      ".question-number",
      ".num",
      ".score",
      "[class*='score']",
      ".font-cx",
      ".option",
      ".option-item",
      ".optionItem",
      ".answer-item",
      ".stem_answer",
      ".answerBg",
      ...ANSWER_SELECTORS,
      ...OPTION_LIST_SELECTORS
    ];

    selectors.forEach((selector) => {
      let nodes;
      try {
        nodes = root.querySelectorAll(selector);
      } catch (error) {
        return;
      }
      nodes.forEach((node) => node.remove());
    });

    // 只移除“像选项”的列表，保留题干里的普通列表。
    root.querySelectorAll("ul, ol").forEach((list) => {
      const text = readText(list).slice(0, 100);
      const hasInput = Boolean(
        list.querySelector("input[type=radio], input[type=checkbox]")
      );
      if (hasInput || /(^|\s)[A-H][.、．)）]/.test(text)) {
        list.remove();
      }
    });
  }

  function cleanStem(raw) {
    let value = normalize(raw).replace(/\n+/g, " ");
    let previous = "";

    while (value && value !== previous) {
      previous = value;
      value = value
        .replace(/^\s*\d+\s+(?=[【\[（(])/, "")
        .replace(/^\s*\d+\s*[.、．)）](?!\d)\s*/, "")
        .replace(/^\s*[（(]\s*\d+(\.\d+)?\s*分\s*[）)]\s*/, "")
        .replace(/^\s*【\s*\d+\s*】\s*/, "")
        .replace(/^\s*第\s*\d+\s*题\s*[.、．:：]?\s*/, "")
        .replace(
          /^\s*[（(\[【]\s*(单选题|单项选择题|单选|多选题|多项选择题|判断题|填空题|简答题|问答题)\s*[）)\]】]\s*/i,
          ""
        )
        .replace(
          /^\s*(单选题|单项选择题|多选题|判断题|填空题|简答题)\s*[.、．:：]\s*/,
          ""
        );
    }

    value = value
      .replace(/[（(]\s*\d+(\.\d+)?\s*分\s*[）)]/g, " ")
      .replace(/[\[【]\s*\d+(\.\d+)?\s*分\s*[\]】]/g, " ")
      .replace(/分值\s*[:：]\s*\d+(\.\d+)?\s*分/g, " ")
      .replace(/[（(]\s*请选择[^)）]*[）)]/g, " ")
      .replace(/请选择(?:一个|一项)?(?:正确|最佳)?答案[。.]?$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return value
      .replace(/^[\s.、．:：;；]+/, "")
      .replace(/[\s.、．:：;；]+$/, "");
  }

  function extractStemText(container, stemElement) {
    const source = stemElement || container;
    const forceDecode = Boolean(
      source &&
        ((typeof source.closest === "function" &&
          source.closest(".font-cxsecret")) ||
          (typeof source.querySelector === "function" &&
            source.querySelector(".font-cxsecret")))
    );
    const clone = source.cloneNode(true);
    stripNonStem(clone);

    let text = cleanStem(readText(clone, forceDecode));
    if (!text) {
      if (
        clone.querySelector(
          "math, mjx-container, .MathJax, .katex, img.tex, img[src*='latex'], img[src*='math'], img[class*='formula']"
        )
      ) {
        text = "[公式题]";
      } else if (clone.querySelector("img")) {
        text = "[图片题]";
      }
    }
    return text;
  }

  function detectNumber(container, stemElement, index, allowTextFallback) {
    // 学习通新结构：题号在 .Zy_TItle 的直接子元素 <i> 中。
    const directNumber = container.querySelector(".Zy_TItle > i");
    if (directNumber && isVisible(directNumber)) {
      const match = /(\d+)/.exec(readText(directNumber));
      if (match) {
        return Number(match[1]);
      }
    }

    const numberNode = container.querySelector(
      ".q_num, .q-num, .question-number, .num"
    );
    if (numberNode && isVisible(numberNode)) {
      const match = /(\d+)/.exec(readText(numberNode));
      if (match) {
        return Number(match[1]);
      }
    }

    if (allowTextFallback === false) {
      return index + 1;
    }

    const markName = container.querySelector("h3.mark_name");
    if (markName) {
      const markText = readText(markName).slice(0, 40);
      const markNumber =
        /^\s*(\d+)\s*[.、．)）](?!\d)/.exec(markText) ||
        /^\s*第\s*(\d+)\s*题/.exec(markText);
      if (markNumber) {
        return Number(markNumber[1]);
      }
    }

    const raw = readText(stemElement || container).slice(0, 30);
    const bracketMatch = /^\s*第\s*(\d+)\s*题/.exec(raw);
    if (bracketMatch) {
      return Number(bracketMatch[1]);
    }

    const match = /^\s*(\d+)\s*[.、．)）](?!\d)/.exec(raw);
    if (match) {
      return Number(match[1]);
    }

    return index + 1;
  }

  // ---------- 题型 ----------

  function collectTypeLabels(container) {
    const labels = [];
    const selectors = [
      ".q_type",
      ".q-type",
      ".question-type",
      ".newZy_TItle",
      ".colorShallow",
      ".type",
      ".font-cx",
      "[class*='questionType']",
      "[class*='question-type']"
    ];

    selectors.forEach((selector) => {
      let nodes;
      try {
        nodes = container.querySelectorAll(selector);
      } catch (error) {
        return;
      }
      nodes.forEach((node) => {
        if (!isVisible(node)) {
          return;
        }
        const text = readText(node);
        if (text && text.length <= 20) {
          labels.push(text);
        }
      });
    });

    return labels;
  }

  function detectTypeFromText(text) {
    if (/(多选题|多项选择题|不定项选择题)/.test(text)) {
      return "multiple";
    }
    if (/(判断题|是非题)/.test(text)) {
      return "judgment";
    }
    if (/填空题/.test(text)) {
      return "fill";
    }
    if (/(简答题|问答题|论述题)/.test(text)) {
      return "essay";
    }
    if (/(单选题|单项选择题|单项选择|单选)/.test(text)) {
      return "single";
    }
    return "";
  }

  function detectType(container, stem) {
    // 课程作业新结构：容器上直接带 typename="单选题"。
    const typename = normalize(container.getAttribute("typename") || "");
    const typenameKind = detectTypeFromText(typename);
    if (typenameKind) {
      return typenameKind;
    }

    const labels = collectTypeLabels(container).join(" ");
    const labelKind = detectTypeFromText(labels);
    if (labelKind) {
      return labelKind;
    }

    // 只接受题干开头的题型标记，例如“2.（单选题）……”，
    // 避免题干内容里出现“单选题”三个字就被误判。
    const prefix = normalize(stem).slice(0, 40);
    const prefixMatch =
      /^\s*(?:\d+\s*[.、．)）]\s*|\d+\s+)?(?:[（(\[【]\s*)?(单选题|单项选择题|单项选择|单选|多选题|多项选择题|不定项选择题|判断题|是非题|填空题|简答题|问答题|论述题)\s*(?:[）)\]】])?/.exec(
        prefix
      );
    if (prefixMatch) {
      const prefixKind = detectTypeFromText(prefixMatch[1]);
      if (prefixKind) {
        return prefixKind;
      }
    }

    const hasCheckbox = Array.from(
      container.querySelectorAll("input[type=checkbox]")
    ).some(isVisible);
    const hasRadio = Array.from(
      container.querySelectorAll("input[type=radio]")
    ).some(isVisible);

    if (hasCheckbox) {
      return "multiple";
    }
    if (hasRadio) {
      return "single";
    }
    return "unknown";
  }

  // ---------- 选项 ----------

  function optionBelongsToContainer(item, container) {
    if (!item || typeof item.closest !== "function") {
      return true;
    }

    const boundary = item.closest(QUESTION_BOUNDARY_SELECTOR);
    if (!boundary) {
      return true;
    }

    return (
      boundary === container ||
      container.contains(boundary) ||
      boundary.contains(container)
    );
  }

  function collectOptionElements(container) {
    const items = [];

    OPTION_ITEM_SELECTORS.forEach((selector) => {
      let nodes;
      try {
        nodes = container.querySelectorAll(selector);
      } catch (error) {
        return;
      }

      nodes.forEach((node) => {
        if (
          !isVisible(node) ||
          isAnswerNode(node) ||
          !optionBelongsToContainer(node, container)
        ) {
          return;
        }
        if (
          items.some(
            (existing) =>
              existing === node ||
              existing.contains(node) ||
              node.contains(existing)
          )
        ) {
          return;
        }
        items.push(node);
      });
    });

    if (items.length < 2) {
      container
        .querySelectorAll("input[type=radio], input[type=checkbox]")
        .forEach((input) => {
          if (!isVisible(input)) {
            return;
          }
          const item = input.closest(
            "li, label, .option, .option-item, .answer-item"
          );
          if (
            !item ||
            !container.contains(item) ||
            isAnswerNode(item) ||
            !optionBelongsToContainer(item, container)
          ) {
            return;
          }
          if (!items.includes(item)) {
            items.push(item);
          }
        });
    }

    return items;
  }

  function readNumOptionLabel(item) {
    const node = item.querySelector(".num_option, .num_option_dx");
    if (!node) {
      return "";
    }

    const attributes = [
      "data",
      "data-value",
      "data-label",
      "data-option",
      "data-letter",
      "data-answer"
    ];

    for (const name of attributes) {
      const raw = normalize(node.getAttribute(name) || "");
      if (!raw) {
        continue;
      }
      const match =
        /^\s*[（(]?\s*([A-Za-z])\s*[）)]?\s*[.、．:：]?\s*$/.exec(raw);
      if (match) {
        return match[1].toUpperCase();
      }
    }

    const text = readText(node);
    const exact =
      /^\s*[（(]?\s*([A-Za-z])\s*[）)]?\s*[.、．:：]?\s*$/.exec(text);
    if (exact) {
      return exact[1].toUpperCase();
    }

    const anyLetter = /[A-Za-z]/.exec(text);
    return anyLetter ? anyLetter[0].toUpperCase() : "";
  }

  function detectLabel(item, text) {
    const numOptionLabel = readNumOptionLabel(item);
    if (numOptionLabel) {
      return numOptionLabel;
    }

    const input = item.querySelector(
      "input[type=radio], input[type=checkbox]"
    );
    if (input) {
      const value = normalize(
        input.value || input.getAttribute("value") || ""
      );
      if (/^[A-Za-z]$/.test(value)) {
        return value.toUpperCase();
      }
      const dataLabel = normalize(input.getAttribute("data-label") || "");
      if (/^[A-Za-z]$/.test(dataLabel)) {
        return dataLabel.toUpperCase();
      }
    }

    const labelNode = item.querySelector(
      ".option-label, .optionLabel, .label, .fl, .mark_letter-label"
    );
    if (labelNode) {
      const labelText = readText(labelNode);
      const exact =
        /^\s*[（(]?\s*([A-Za-z])\s*[）)]?\s*[.、．:：]?\s*$/.exec(
          labelText
        );
      if (exact) {
        return exact[1].toUpperCase();
      }
    }

    const prefix =
      /^\s*[（(]?\s*([A-Za-z])\s*[）)]?\s*[.、．:：)）]\s*/.exec(text);
    if (prefix) {
      return prefix[1].toUpperCase();
    }

    return "";
  }

  function stripOptionLabel(text) {
    return normalize(text)
      .replace(
        /^\s*[（(]?\s*[A-Za-z]\s*[）)]?\s*[.、．:：)）]\s*/,
        ""
      )
      .trim();
  }

  function readOptionText(item) {
    const clone = item.cloneNode(true);
    const removeSelectors = [
      "input",
      "script",
      "style",
      "button",
      ...ANSWER_SELECTORS
    ];
    removeSelectors.forEach((selector) => {
      clone.querySelectorAll(selector).forEach((node) => node.remove());
    });
    const forceDecode = Boolean(
      (typeof item.closest === "function" &&
        item.closest(".font-cxsecret")) ||
        (typeof item.querySelector === "function" &&
          item.querySelector(".font-cxsecret"))
    );
    return readText(clone, forceDecode);
  }

  function extractOption(item, index) {
    const rawText = readOptionText(item);
    let label = detectLabel(item, rawText);
    let text = stripOptionLabel(rawText);

    const textNode = item.querySelector(OPTION_TEXT_SELECTOR);
    if (textNode && isVisible(textNode)) {
      const candidate = stripOptionLabel(readText(textNode));
      if (candidate) {
        text = candidate;
      }
    }

    const hasImage = Array.from(item.querySelectorAll("img")).some(
      (image) => !isAnswerNode(image)
    );
    const hasFormula = Array.from(
      item.querySelectorAll(
        "math, mjx-container, .MathJax, .katex, img.tex, img[src*='latex'], img[src*='math'], img[class*='formula']"
      )
    ).some((node) => !isAnswerNode(node));

    if (!text) {
      if (hasFormula) {
        text = "[公式]";
      } else if (hasImage) {
        text = "[图片]";
      }
    }

    if (!text) {
      return null;
    }

    let inferred = false;
    if (!label) {
      label = String.fromCharCode(65 + index);
      inferred = true;
    }

    return {
      label,
      text,
      inferred
    };
  }

  function detectProtectedOptionLabel(item) {
    const numOptionLabel = readNumOptionLabel(item);
    if (numOptionLabel) {
      return numOptionLabel;
    }

    const input = item.querySelector(
      "input[type=radio], input[type=checkbox]"
    );
    if (input && isVisible(input)) {
      const value = normalize(
        input.value || input.getAttribute("value") || ""
      );
      if (/^[A-Za-z]$/.test(value)) {
        return value.toUpperCase();
      }
    }

    const labelNode = item.querySelector(
      ".option-label, .optionLabel, .label"
    );
    if (labelNode) {
      const labelText = readText(labelNode);
      const exact =
        /^\s*[（(]?\s*([A-Za-z])\s*[）)]?\s*[.、．:：]?\s*$/.exec(
          labelText
        );
      if (exact) {
        return exact[1].toUpperCase();
      }
    }

    return "";
  }

  // ---------- 图片 / 公式引用 ----------

  function addMedia(item, media, seen) {
    if (!item.src && !item.text) {
      return;
    }
    if (media.length >= 30) {
      return;
    }

    const key = [
      item.kind,
      item.scope,
      item.option || "",
      item.src || "",
      item.text || "",
      item.alt || ""
    ].join("|");

    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    media.push(item);
  }

  function collectMedia(root, scope, optionLabel, media, seen, excluded) {
    if (!root) {
      return;
    }

    const nodes = [];
    let candidates;
    try {
      candidates = root.querySelectorAll(
        "img, math, mjx-container, .MathJax, .katex, [class*='formula'], [class*='math']"
      );
    } catch (error) {
      return;
    }

    candidates.forEach((node) => {
      if (!isVisible(node) || isAnswerNode(node)) {
        return;
      }
      if (excluded && excluded.some((element) => element.contains(node))) {
        return;
      }
      if (nodes.some((existing) => existing.contains(node))) {
        return;
      }
      nodes.push(node);
    });

    nodes.forEach((node) => {
      const tagName = node.tagName.toLowerCase();

      if (tagName === "img") {
        const className = node.getAttribute("class") || "";
        if (/(icon|avatar|logo|emoji|badge)/i.test(className)) {
          return;
        }

        const src = toAbsoluteUrl(
          node.currentSrc ||
            node.src ||
            node.getAttribute("src") ||
            node.getAttribute("data-src") ||
            node.getAttribute("data-original") ||
            node.getAttribute("data-lazy-src") ||
            ""
        );
        const alt = normalize(
          node.getAttribute("alt") || node.getAttribute("title") || ""
        );
        const isFormula = /(latex|math|formula|tex)/i.test(
          className + " " + src
        );

        addMedia(
          {
            kind: isFormula ? "formula" : "image",
            scope,
            option: optionLabel || null,
            src,
            alt
          },
          media,
          seen
        );
        return;
      }

      const text = readText(node);
      if (text && text.length <= 300) {
        addMedia(
          {
            kind: "formula",
            scope,
            option: optionLabel || null,
            text
          },
          media,
          seen
        );
      }
    });
  }

  // ---------- 主流程 ----------

  const READABLE_FONT_PATTERN =
    /(宋体|SimSun|NSimSun|微软雅黑|Microsoft YaHei|黑体|SimHei|楷体|KaiTi|仿宋|FangSong|Arial|Helvetica|Times New Roman)/i;

  function getFontFamily(element) {
    if (!element) {
      return "";
    }

    const ownStyle = element.getAttribute("style") || "";
    const ownMatch = /font-family\s*:\s*([^;]+)/i.exec(ownStyle);
    if (ownMatch) {
      return normalize(ownMatch[1].replace(/["']/g, ""));
    }
    if (element.style && element.style.fontFamily) {
      return normalize(element.style.fontFamily);
    }

    // 浏览器中 computed style 最能反映实际字体；优先于祖先的内联兜底。
    if (
      typeof window !== "undefined" &&
      typeof window.getComputedStyle === "function"
    ) {
      const computed = window.getComputedStyle(element);
      if (computed && computed.fontFamily) {
        return normalize(computed.fontFamily);
      }
    }

    let current = element.parentElement;
    while (current && current.nodeType === 1) {
      const inlineStyle = current.getAttribute("style") || "";
      const inlineMatch = /font-family\s*:\s*([^;]+)/i.exec(inlineStyle);
      if (inlineMatch) {
        return normalize(inlineMatch[1].replace(/["']/g, ""));
      }
      if (current.style && current.style.fontFamily) {
        return normalize(current.style.fontFamily);
      }
      current = current.parentElement;
    }

    return "";
  }

  function isReadableFontFamily(fontFamily) {
    const first = String(fontFamily || "")
      .split(",")[0]
      .replace(/["']/g, "")
      .trim();
    return Boolean(first) && READABLE_FONT_PATTERN.test(first);
  }

  function collectDirectTextElements(root) {
    if (!root) {
      return [];
    }

    const list = [];
    const nodes = [root, ...root.querySelectorAll("*")];

    nodes.forEach((element) => {
      if (!element || element.nodeType !== 1) {
        return;
      }
      if (!String(element.textContent || "").trim()) {
        return;
      }
      const hasDirectText = Array.from(element.childNodes || []).some(
        (node) =>
          node.nodeType === 3 && String(node.nodeValue || "").trim() !== ""
      );
      if (hasDirectText) {
        list.push(element);
      }
    });

    return list;
  }

  /**
   * 对一段题干/选项分别判断文字状态。
   * .font-cxsecret 只是候选标记；如果实际文字元素明确使用宋体等可读字体，
   * 则视为正常文字。只有标记内且字体不可读时才判定为受保护。
   */
  function analyzeTextStatus(root) {
    if (!root) {
      return "unreadable";
    }

    const textElements = collectDirectTextElements(root);
    if (textElements.length === 0) {
      return root.querySelector(
        "img, math, mjx-container, .MathJax, .katex"
      )
        ? "ok"
        : "unreadable";
    }

    // 字段内只要存在字体标记，就先用整段文字尝试还原；
    // 这样可以发现“第一个文本节点正常、后续节点仍被混淆”的情况。
    const rootHasMarker = Boolean(
      (typeof root.closest === "function" &&
        root.closest(".font-cxsecret")) ||
        (typeof root.querySelector === "function" &&
          root.querySelector(".font-cxsecret"))
    );
    const rootDecoded = decodeWithFont(
      rawReadText(root),
      root,
      rootHasMarker
    );
    if (rootDecoded && rootDecoded.complete && rootDecoded.encoded > 0) {
      return "ok";
    }
    if (rootDecoded && !rootDecoded.complete) {
      return "protected_text";
    }

    const marked = textElements.filter((element) =>
      element.closest(".font-cxsecret")
    );
    if (marked.length === 0) {
      return "ok";
    }

    const protectedCount = marked.filter((element) => {
      const decoded = decodeWithFont(rawReadText(element), element, true);
      if (decoded && decoded.complete) {
        return false;
      }
      if (decoded && !decoded.complete) {
        return true;
      }

      const font = getFontFamily(element);
      return !isReadableFontFamily(font);
    }).length;

    return protectedCount > 0 ? "protected_text" : "ok";
  }

  function isHomeworkContainer(container) {
    if (normalize(container.getAttribute("typename") || "")) {
      return true;
    }
    return Boolean(
      container.querySelector(
        ".stem_answer, .answerBg, .workTextWrap, .mark_answer"
      )
    );
  }

  function findOptionTextElement(item) {
    return item.querySelector(OPTION_TEXT_SELECTOR) || item;
  }

  function questionKey(question) {
    if (question.textStatus !== "ok") {
      return (
        "partial|" +
        question.type +
        "|" +
        question.number +
        "|" +
        question.options.map((option) => option.label).join(",")
      );
    }

    return (
      question.type +
      "\u0001" +
      normalize(question.stem) +
      "\u0002" +
      question.options
        .map(
          (option) =>
            normalize(option.label) + "=" + normalize(option.text)
        )
        .join("\u0003")
    );
  }

  const containers = collectContainers();
  stats.containers = containers.length;

  const seenQuestions = new Set();

  containers.forEach((container, index) => {
    if (questions.length >= maxQuestions) {
      return;
    }

    const stemElement = findStemElement(container);
    const stemRoot = stemElement || container;
    let stemTextStatus = analyzeTextStatus(stemRoot);
    const rawStem =
      stemTextStatus === "ok" ? readText(stemRoot).slice(0, 200) : "";
    const stem =
      stemTextStatus === "ok"
        ? extractStemText(container, stemElement)
        : null;

    if (stemTextStatus === "ok" && !stem) {
      stemTextStatus = "unreadable";
    }

    const type = detectType(container, rawStem);
    const profile = isHomeworkContainer(container) ? "homework" : "chapter";
    const questionType =
      type === "multiple"
        ? "multiple_choice"
        : type === "judgment"
        ? "judgment"
        : "single_choice";
    const skipPreview = stem || "文字受保护或不可读";

    // 作业页面只排除尚未适配的填空、简答；单选、多选、判断均处理。
    if (
      profile === "homework" &&
      (type === "fill" || type === "essay")
    ) {
      stats.skippedHomeworkUnsupported += 1;
      recordSkip("homework_unsupported", skipPreview);
      return;
    }

    // 非作业页面继续保持原有范围：判断题暂不处理。
    if (type === "judgment" && profile !== "homework") {
      stats.skippedOtherType += 1;
      recordSkip("other_type", skipPreview);
      return;
    }
    if (type === "fill" || type === "essay") {
      stats.skippedOtherType += 1;
      recordSkip("other_type", skipPreview);
      return;
    }
    if (type === "unknown") {
      stats.skippedUnknownType += 1;
      recordSkip("unknown_type", skipPreview);
      return;
    }
    if (type !== "single" && type !== "multiple" && type !== "judgment") {
      return;
    }

    const optionElements = collectOptionElements(container);
    if (optionElements.length < 2) {
      stats.skippedIncomplete += 1;
      recordSkip("incomplete", skipPreview);
      return;
    }

    const options = [];
    const seenOptionLabels = new Set();

    optionElements.forEach((item, optionIndex) => {
      const textElement = findOptionTextElement(item);
      const optionTextStatus = analyzeTextStatus(textElement);

      if (optionTextStatus !== "ok") {
        let label = detectProtectedOptionLabel(item);
        let inferred = false;
        if (!label) {
          label = String.fromCharCode(65 + optionIndex);
          inferred = true;
        }
        if (seenOptionLabels.has(label)) {
          return;
        }
        seenOptionLabels.add(label);
        if (inferred) {
          stats.inferredLabels += 1;
        }
        options.push({
          label,
          text: null,
          textStatus: optionTextStatus,
          inferred,
          item
        });
        return;
      }

      const option = extractOption(item, optionIndex);
      if (!option) {
        let label = detectProtectedOptionLabel(item);
        let inferred = false;
        if (!label) {
          label = String.fromCharCode(65 + optionIndex);
          inferred = true;
        }
        if (seenOptionLabels.has(label)) {
          return;
        }
        seenOptionLabels.add(label);
        if (inferred) {
          stats.inferredLabels += 1;
        }
        options.push({
          label,
          text: null,
          textStatus: "unreadable",
          inferred,
          item
        });
        return;
      }

      if (seenOptionLabels.has(option.label)) {
        return;
      }
      seenOptionLabels.add(option.label);
      if (option.inferred) {
        stats.inferredLabels += 1;
      }
      options.push({
        label: option.label,
        text: option.text,
        textStatus: "ok",
        inferred: option.inferred,
        item
      });
    });

    if (options.length < 2) {
      stats.skippedIncomplete += 1;
      recordSkip("incomplete", skipPreview);
      return;
    }

    const allStatuses = [
      stemTextStatus,
      ...options.map((option) => option.textStatus)
    ];
    const allOk = allStatuses.every((status) => status === "ok");
    const anyOk = allStatuses.some((status) => status === "ok");
    const anyProtected = allStatuses.some(
      (status) => status === "protected_text"
    );
    const textStatus = allOk
      ? "ok"
      : anyOk
      ? "mixed"
      : anyProtected
      ? "protected_text"
      : "unreadable";
    const textMessage =
      textStatus === "ok"
        ? ""
        : textStatus === "mixed"
        ? "部分题干或选项文字受保护/不可读，已保留可读部分。"
        : textStatus === "protected_text"
        ? "题干或选项文字受保护，未读取内容。"
        : "题干或选项文字为空或不可读。";

    // 章节答案区优先按 .newAnswerBx 识别，避免带 typename 的章节题
    // 被误走作业 .mark_answer 分支。
    const answer = container.querySelector(".newAnswerBx")
      ? extractChapterAnswerInfo(container, questionType)
      : profile === "homework"
      ? extractAnswerInfo(container)
      : null;
    if (answer) {
      answer.userText = mapAnswerToOptionText(answer.user, options);
      answer.correctText = mapAnswerToOptionText(answer.correct, options);
    }

    const question = {
      number: detectNumber(container, stemElement, index),
      type: questionType,
      stem: stemTextStatus === "ok" ? stem : null,
      stemTextStatus,
      options: options.map((option) => ({
        label: option.label,
        text: option.textStatus === "ok" ? option.text : null,
        textStatus: option.textStatus
      })),
      optionCount: options.length,
      textStatus,
      textMessage,
      answer,
      media: []
    };

    const media = [];
    const seenMedia = new Set();

    collectMedia(
      container,
      "stem",
      null,
      media,
      seenMedia,
      optionElements
    );

    options.forEach((entry) => {
      collectMedia(
        entry.item,
        "option",
        entry.label,
        media,
        seenMedia,
        null
      );
    });

    question.media = media;

    if (textStatus === "mixed") {
      stats.mixedText += 1;
    } else if (textStatus !== "ok") {
      stats.protectedText += 1;
    }

    const key = questionKey(question);
    if (seenQuestions.has(key)) {
      stats.duplicates += 1;
      return;
    }
    seenQuestions.add(key);
    questions.push(question);
  });

  stats.structures = questions.length;
  stats.extracted = questions.filter(
    (question) => question.textStatus === "ok"
  ).length;

  return {
    questions,
    stats,
    skipped
  };
};
