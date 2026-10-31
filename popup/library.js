"use strict";

(function () {
  const Bank = globalThis.QuestionBank;
  const Storage = globalThis.QuestionBankStorage;
  const Practice = globalThis.QuestionPractice;

  const state = {
    store: null,
    courses: [],
    chapters: [],
    questions: [],
    selectedCourseKey: "",
    selectedChapterKey: "",
    pending: [],
    pendingTargetCourse: "",
    pendingTargetChapters: [],
    backup: null,
    practice: {
      courses: [],
      chapters: [],
      session: null,
      index: 0,
      answers: [],
      selection: [],
      submitted: false,
      startedAt: 0
    }
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function text(value, fallback) {
    return value == null || value === "" ? fallback || "" : String(value);
  }

  function typeLabel(type) {
    return type === "multiple_choice"
      ? "多选题"
      : type === "judgment"
      ? "判断题"
      : "单选题";
  }

  function pathOf(raw) {
    try {
      return new URL(String(raw || "")).pathname || "";
    } catch (error) {
      return "";
    }
  }

  function toast(message, error) {
    const box = byId("toast");
    box.hidden = false;
    box.textContent = message;
    box.className = error ? "toast is-error" : "toast";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      box.hidden = true;
    }, 4200);
  }

  function setStatus(message) {
    byId("global-status").textContent = message;
  }

  function getStore() {
    if (state.store) return state.store;
    if (!Storage) {
      toast("题库模块未加载。", true);
      return null;
    }
    state.store = Storage.createStorage({
      storage: chrome.storage.local,
      now: Date.now,
      locks: navigator.locks || null
    });
    return state.store;
  }

  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }

  function switchView(view) {
    document.querySelectorAll(".nav-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === view);
    });
    document.querySelectorAll(".view").forEach((section) => {
      section.classList.toggle("is-active", section.id === `view-${view}`);
    });
    if (view === "pending") loadPending();
    if (view === "practice") loadPracticeCourses();
  }

  async function refreshLibrary() {
    const store = getStore();
    if (!store) return;
    setStatus("正在读取本地题库…");
    const result = await store.getCourses();
    if (!result.ok) {
      byId("library-meta").textContent = `${result.error.code}：${result.error.message}`;
      byId("library-stats").textContent = "";
      byId("full-question-list").textContent = "";
      byId("full-question-list").append(
        el("p", "empty", "题库读取失败。")
      );
      setStatus("题库读取失败");
      return;
    }
    state.courses = result.courses || [];
    if (result.indexRecovered) {
      toast("索引缺失或损坏，已从章节数据自动重建。", false);
    }
    let courseKey = state.selectedCourseKey;
    if (!state.courses.some((course) => course.courseKey === courseKey)) {
      courseKey = state.courses[0]?.courseKey || "";
    }
    state.selectedCourseKey = courseKey;
    renderCourseList();
    await loadChapters(courseKey);
    setStatus(
      `已连接本地题库 · ${state.courses.length} 门课程`
    );
  }

  function renderCourseList() {
    const list = byId("course-list");
    list.textContent = "";
    if (!state.courses.length) {
      list.append(el("p", "hint", "还没有本地课程。请先在弹窗中保存题目。"));
      return;
    }
    state.courses.forEach((course) => {
      const button = el("button", "list-button");
      button.type = "button";
      button.classList.toggle(
        "is-active",
        course.courseKey === state.selectedCourseKey
      );
      button.append(document.createTextNode(text(course.courseName, "未命名课程")));
      button.append(document.createElement("br"));
      button.append(
        el(
          "small",
          "",
          `${course.chapterCount || 0} 个章节${
            course.courseId ? ` · ${course.courseId}` : ""
          }`
        )
      );
      button.addEventListener("click", async () => {
        state.selectedCourseKey = course.courseKey;
        state.selectedChapterKey = "";
        renderCourseList();
        await loadChapters(course.courseKey);
      });
      list.append(button);
    });
  }

  async function loadChapters(courseKey) {
    const store = getStore();
    state.chapters = [];
    state.questions = [];
    const chapterList = byId("chapter-list");
    chapterList.textContent = "";
    if (!courseKey) {
      renderQuestions();
      return;
    }
    const result = await store.getChapters(courseKey);
    if (!result.ok) {
      chapterList.append(el("p", "hint", result.error.message));
      return;
    }
    state.chapters = result.chapters || [];
    if (!state.chapters.length) {
      chapterList.append(el("p", "hint", "该课程没有章节。"));
      renderQuestions();
      return;
    }
    if (
      !state.chapters.some(
        (chapter) => chapter.chapterKey === state.selectedChapterKey
      )
    ) {
      state.selectedChapterKey = state.chapters[0].chapterKey;
    }
    state.chapters.forEach((chapter) => {
      const button = el("button", "list-button");
      button.type = "button";
      button.classList.toggle(
        "is-active",
        chapter.chapterKey === state.selectedChapterKey
      );
      button.append(document.createTextNode(text(chapter.chapterName, "未命名章节")));
      button.append(document.createElement("br"));
      button.append(
        el(
          "small",
          "",
          `${chapter.questionCount || 0} 道题${
            chapter.parentChapterName
              ? ` · 上级：${chapter.parentChapterName}`
              : ""
          }`
        )
      );
      button.addEventListener("click", () => {
        state.selectedChapterKey = chapter.chapterKey;
        renderChapterList();
        loadQuestions(chapter.chapterKey);
      });
      chapterList.append(button);
    });
    await loadQuestions(state.selectedChapterKey);
  }

  function renderChapterList() {
    const buttons = byId("chapter-list").querySelectorAll(".list-button");
    state.chapters.forEach((chapter, index) => {
      if (buttons[index]) {
        buttons[index].classList.toggle(
          "is-active",
          chapter.chapterKey === state.selectedChapterKey
        );
      }
    });
  }

  async function loadQuestions(chapterKey) {
    const store = getStore();
    const result = await store.getQuestions(chapterKey);
    if (!result.ok) {
      state.questions = [];
      byId("library-title").textContent = "题目读取失败";
      byId("library-meta").textContent = `${result.error.code}：${result.error.message}`;
      renderQuestions();
      return;
    }
    state.questions = result.questions || [];
    const chapter = state.chapters.find(
      (item) => item.chapterKey === chapterKey
    );
    byId("library-title").textContent =
      chapter?.chapterName || "未命名章节";
    byId("library-meta").textContent = chapter
      ? `上级：${chapter.parentChapterName || "无"} · ${chapter.chapterId || "无章节 ID"}`
      : "";
    renderQuestions();
  }

  function renderQuestions() {
    const search = byId("question-search").value.trim().toLowerCase();
    const type = byId("type-filter").value || "all";
    const questions = state.questions.filter((question) => {
      if (type !== "all" && question.type !== type) return false;
      if (!search) return true;
      const haystack = [
        question.stem,
        ...(question.options || []).map((option) => option.text),
        question.chapterName,
        question.courseName
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });

    byId("library-stats").textContent = "";
    const stat = (value, label) =>
      byId("library-stats").append(
        (() => {
          const node = el("span", "stat-pill");
          const strong = document.createElement("strong");
          strong.textContent = String(value);
          node.append(strong, document.createTextNode(` ${label}`));
          return node;
        })()
      );
    stat(state.questions.length, "道题");
    stat(
      state.questions.filter((q) => q.correctAnswer?.value).length,
      "有正确答案"
    );
    stat(
      state.questions.filter((q) => q.verification === "frame_unverified").length,
      "未验证"
    );
    stat(
      state.questions.filter((q) => q.identityQuality === "partial").length,
      "部分可读"
    );

    const list = byId("full-question-list");
    list.textContent = "";
    if (!questions.length) {
      list.append(
        el(
          "p",
          "empty",
          state.questions.length ? "没有符合筛选条件的题目。" : "当前章节没有题目。"
        )
      );
      return;
    }
    questions.forEach((question) => list.append(renderQuestionCard(question)));
  }

  function renderQuestionCard(question, options) {
    const opts = options || {};
    const card = el("article", "question-card");
    const head = el("div", "question-card__head");
    const number = el(
      "span",
      "badge",
      `第 ${question.number == null ? "?" : question.number} 题`
    );
    const type = el("span", "badge badge--ok", typeLabel(question.type));
    const verification = el(
      "span",
      question.verification === "frame_unverified" ||
        question.verification === "identity_unverified"
        ? "badge badge--warn"
        : "badge",
      question.verification === "frame_unverified"
        ? "未验证章节"
        : question.verification === "identity_unverified"
        ? "未验证身份"
        : "已验证"
    );
    head.append(number, type, verification);
    if (opts.actions) head.append(opts.actions);

    const stem = el(
      "h3",
      "",
      question.stem || "（题干文字受保护或不可读）"
    );
    card.append(head, stem);

    const optionList = el("ul", "question-options");
    (question.options || []).forEach((option) => {
      const item = el("li", "question-option");
      item.append(
        el("span", "option-label", option.label || ""),
        el(
          "span",
          "",
          option.text ||
            (option.textStatus === "ok" ? "" : "（文字不可读）")
        )
      );
      optionList.append(item);
    });
    card.append(optionList);

    const correct =
      question.correctAnswer?.status === "visible" &&
      question.correctAnswer?.value
        ? `${question.correctAnswer.value}${
            question.correctAnswer.text
              ? `（${question.correctAnswer.text}）`
              : ""
          }`
        : "未公布/未知";
    const answer = el("div", "answer-box");
    const answerLabel = document.createElement("strong");
    answerLabel.textContent = "正确答案：";
    answer.append(answerLabel, document.createTextNode(correct));
    if (question.teacherAnalysis?.text) {
      const analysis = el(
        "div",
        "analysis",
        `教师解析：${question.teacherAnalysis.text}`
      );
      answer.append(analysis);
    }
    card.append(answer);

    const meta = el(
      "p",
      "question-meta",
      `${text(question.courseName, "未知课程")} · ${
        question.chapterName || "未知章节"
      } · 来源：${question.source?.title || question.source?.path || "未知"}`
    );
    card.append(meta);
    return card;
  }

  async function rebuildIndex() {
    const store = getStore();
    const result = await store.rebuildIndexes();
    if (!result.ok) {
      toast(`${result.error.code}：${result.error.message}`, true);
      return;
    }
    toast("索引已重建。", false);
    await refreshLibrary();
  }

  /* ---------- 练习 ---------- */

  async function loadPracticeCourses() {
    const store = getStore();
    const result = await store.getCourses();
    if (!result.ok) {
      byId("practice-status").textContent = result.error.message;
      return;
    }
    state.practice.courses = result.courses || [];
    fillSelect(
      byId("practice-course"),
      state.practice.courses,
      "courseKey",
      "courseName",
      "选择课程"
    );
    if (state.practice.courses[0]) {
      setSelectValue(
        byId("practice-course"),
        state.practice.courses[0].courseKey
      );

      await loadPracticeChapters(state.practice.courses[0].courseKey);
    }
  }

  async function loadPracticeChapters(courseKey) {
    const store = getStore();
    state.practice.chapters = [];
    byId("practice-start").disabled = true;
    if (!courseKey) return;
    const result = await store.getChapters(courseKey);
    if (!result.ok) {
      byId("practice-status").textContent = result.error.message;
      return;
    }
    state.practice.chapters = result.chapters || [];
    fillSelect(
      byId("practice-chapter"),
      state.practice.chapters,
      "chapterKey",
      "chapterName",
      "选择章节"
    );
    if (state.practice.chapters[0]) {
      setSelectValue(
        byId("practice-chapter"),
        state.practice.chapters[0].chapterKey
      );

      byId("practice-start").disabled = false;
    }
    byId("practice-status").textContent = state.practice.chapters.length
      ? `${state.practice.chapters.length} 个章节可练习。`
      : "当前课程没有可练习章节。";
  }

  function setSelectValue(select, value) {
    const options = Array.from(select.options || []);
    const selected = options.find((option) => option.value === value);
    options.forEach((option) => {
      option.selected = Boolean(selected && option === selected);
    });
    if (!selected && options[0]) options[0].selected = true;
  }

  function fillSelect(select, items, valueKey, labelKey, placeholder) {
    select.textContent = "";
    const empty = el("option", "", placeholder);
    empty.value = "";
    select.append(empty);
    items.forEach((item) => {
      const option = el(
        "option",
        "",
        `${item[labelKey] || item[valueKey] || "未命名"}${
          item.courseId ? ` · ${item.courseId}` : ""
        }`
      );
      option.value = item[valueKey] || "";
      select.append(option);
    });
  }

  async function startPractice() {
    const store = getStore();
    const chapterKey = byId("practice-chapter").value;
    if (!store || !chapterKey || !Practice) return;
    const result = await store.getQuestions(chapterKey);
    if (!result.ok || !result.questions.length) {
      byId("practice-status").textContent =
        result.ok ? "当前章节没有题目。" : result.error.message;
      return;
    }
    const session = Practice.createSession(result.questions, {
      mode: byId("practice-mode").value
    });
    state.practice.session = session;
    state.practice.index = 0;
    state.practice.answers = [];
    state.practice.selection = [];
    state.practice.submitted = false;
    state.practice.startedAt = Date.now();
    byId("practice-setup").hidden = true;
    byId("practice-summary").hidden = true;
    byId("practice-session").hidden = false;
    renderPractice();
  }

  function currentPracticeQuestion() {
    return state.practice.session
      ? state.practice.session.questions[state.practice.index]
      : null;
  }

  function selectedPracticeValues() {
    return Array.from(
      byId("practice-question").querySelectorAll("input:checked")
    )
      .map((input) => input.value)
      .sort();
  }

  function renderPractice() {
    const question = currentPracticeQuestion();
    const session = state.practice.session;
    if (!question || !session) return;
    const index = state.practice.index;
    const answer = state.practice.answers[index];
    byId("practice-progress").textContent = `第 ${index + 1} / ${session.total} 题`;
    byId("practice-remaining").textContent = `剩余 ${session.total - index - 1} 题`;
    const container = byId("practice-question");
    container.textContent = "";
    const title = el(
      "h3",
      "",
      question.stem || "（题干文字受保护或不可读）"
    );
    const options = el("div", "practice-options");
    const type =
      question.type === "multiple_choice" ? "checkbox" : "radio";
    const correctSet = answer?.correctAnswer
      ? answer.correctAnswer.split("")
      : [];
    (question.options || []).forEach((option) => {
      const label = el("label", "practice-option");
      const input = document.createElement("input");
      input.type = type;
      input.name = "library-practice";
      input.value = option.label || "";
      input.checked = state.practice.selection.includes(input.value);
      input.disabled = state.practice.submitted;
      label.classList.toggle(
        "is-selected",
        state.practice.selection.includes(input.value)
      );
      if (answer) {
        if (correctSet.includes(input.value)) {
          label.classList.add("is-correct");
        } else if (
          state.practice.selection.includes(input.value) &&
          answer.result !== "correct"
        ) {
          label.classList.add("is-wrong");
        }
      }
      input.addEventListener("change", () => {
        state.practice.selection = selectedPracticeValues();
        Array.from(options.children).forEach((item) => {
          item.classList.toggle(
            "is-selected",
            item.querySelector("input")?.checked
          );
        });
      });
      label.append(
        input,
        el(
          "span",
          "",
          `${option.label || ""}. ${
            option.text || (option.textStatus === "ok" ? "" : "（文字不可读）")
          }`
        )
      );
      options.append(label);
    });
    container.append(title, options);
    byId("practice-submit").hidden = state.practice.submitted;
    byId("practice-next").hidden = !state.practice.submitted;
    byId("practice-next").textContent =
      index + 1 >= session.total ? "查看总结" : "下一题";
    if (answer) renderPracticeFeedback(question, answer);
    else {
      byId("practice-feedback").hidden = true;
      byId("practice-feedback").textContent = "";
    }
  }

  function renderPracticeFeedback(question, answer) {
    const box = byId("practice-feedback");
    const correct = answer.correctAnswer
      ? Practice.answerText(question, answer.correctAnswer)
      : "";
    const user = Practice.answerText(question, answer.userAnswer);
    const title =
      answer.result === "correct"
        ? "回答正确。"
        : answer.result === "incorrect"
        ? "回答错误。"
        : "正确答案未公布，无法判定。";
    box.hidden = false;
    box.className =
      "feedback " +
      (answer.result === "correct"
        ? "is-correct"
        : answer.result === "incorrect"
        ? "is-wrong"
        : "");
    box.textContent =
      `${title} 你的答案：${user || "未作答"}` +
      (correct ? `；正确答案：${correct}` : "") +
      `\n${
        question.teacherAnalysis?.text || "暂无教师解析。"
      }`;
  }

  function submitPractice() {
    const question = currentPracticeQuestion();
    if (!question || state.practice.submitted) return;
    const selection = selectedPracticeValues();
    if (!selection.length) {
      const box = byId("practice-feedback");
      box.hidden = false;
      box.className = "feedback is-wrong";
      box.textContent = "请先选择答案。";
      return;
    }
    const graded = Practice.gradeAnswer(question, selection.join(""));
    state.practice.selection = selection;
    state.practice.answers[state.practice.index] = {
      ...graded,
      questionKey: question.questionKey,
      type: question.type,
      number: question.number
    };
    state.practice.submitted = true;
    renderPractice();
  }

  function nextPractice() {
    const session = state.practice.session;
    if (!session || !state.practice.submitted) return;
    if (state.practice.index + 1 >= session.total) {
      finishPractice();
      return;
    }
    state.practice.index += 1;
    state.practice.selection = [];
    state.practice.submitted = false;
    renderPractice();
  }

  function finishPractice() {
    const session = state.practice.session;
    if (!session) return;
    const summary = Practice.buildSummary(
      state.practice.answers,
      state.practice.startedAt,
      Date.now(),
      session.total
    );
    byId("practice-session").hidden = true;
    byId("practice-summary").hidden = false;
    const grid = byId("practice-summary-text");
    grid.textContent = "";
    const items = [
      [summary.total, "总题数"],
      [summary.answered, "已答题"],
      [summary.correct, "正确"],
      [summary.incorrect, "错误"],
      [summary.unknown, "答案未知"],
      [`${summary.accuracy}%`, "正确率"],
      [`${Math.max(1, Math.round(summary.elapsedMs / 1000))} 秒`, "用时"]
    ];
    items.forEach(([value, label]) => {
      const item = el("div", "summary-item");
      const strong = document.createElement("strong");
      strong.textContent = String(value);
      item.append(strong, el("span", "", label));
      grid.append(item);
    });
    state.practice.session = null;
  }

  function exitPractice() {
    state.practice.session = null;
    byId("practice-session").hidden = true;
    byId("practice-summary").hidden = true;
    byId("practice-setup").hidden = false;
  }

  /* ---------- pending ---------- */

  async function loadPending() {
    const store = getStore();
    if (!store) return;
    const result = await store.getPendingQuestions();
    if (!result.ok) {
      byId("pending-list").textContent = result.error.message;
      return;
    }
    state.pending = result.questions || [];
    byId("pending-badge").hidden = state.pending.length === 0;
    byId("pending-badge").textContent = String(state.pending.length);
    const courses = state.courses.length
      ? state.courses
      : (await store.getCourses()).courses || [];
    state.courses = courses;
    fillSelect(
      byId("pending-course"),
      courses,
      "courseKey",
      "courseName",
      "选择课程"
    );
    if (courses[0]) {
      setSelectValue(byId("pending-course"), courses[0].courseKey);
      await loadPendingTargetChapters(courses[0].courseKey);
    }
    renderPending();
  }

  async function loadPendingTargetChapters(courseKey) {
    const store = getStore();
    const result = await store.getChapters(courseKey);
    state.pendingTargetChapters = result.ok ? result.chapters || [] : [];
    fillSelect(
      byId("pending-chapter"),
      state.pendingTargetChapters,
      "chapterKey",
      "chapterName",
      "选择章节"
    );
  }

  function renderPending() {
    const list = byId("pending-list");
    list.textContent = "";
    if (!state.pending.length) {
      list.append(el("p", "empty", "没有待确认题目。"));
      return;
    }
    state.pending.forEach((question) => {
      const card = el("article", "pending-card");
      const head = el("div", "pending-card__head");
      head.append(
        el("span", "badge", typeLabel(question.type)),
        el("span", "badge badge--warn", "待确认")
      );
      const title = el("h3", "", question.stem || "（题干不可读）");
      const meta = el(
        "p",
        "",
        `课程：${question.courseName || "未知"} · 原章节：${
          question.chapterName || "未知"
        } · ${question.chapterId || "无章节 ID"}`
      );
      const reason = el("p", "", pendingReason(question));
      const button = el("button", "secondary-button", "确认到所选章节");
      button.type = "button";
      button.addEventListener("click", () => confirmPending(question));
      card.append(head, title, meta, reason, button);
      list.append(card);
    });
  }

  function pendingReason(question) {
    return question.chapterLinkStatus === "cross_frame"
      ? "跨 frame，目录与题目 frame 未证明一致。"
      : `关联状态：${question.chapterLinkStatus || "未知"}`;
  }

  async function confirmPending(question) {
    const store = getStore();
    const courseKey = byId("pending-course").value;
    const chapterKey = byId("pending-chapter").value;
    const course = state.courses.find((item) => item.courseKey === courseKey);
    const chapter = state.pendingTargetChapters.find(
      (item) => item.chapterKey === chapterKey
    );
    if (!course || !chapter || !chapter.chapterId || chapter.chapterIdStatus !== "stable") {
      toast("目标章节没有稳定 chapterId，不能确认。", true);
      return;
    }
    if (!window.confirm("确认把该题归入所选正式章节？")) return;
    const observation = question.importObservation || {};
    const correct = question.correctAnswer || {};
    const raw = {
      type: question.type,
      number: question.number,
      course: course.courseName,
      chapter: chapter.chapterName,
      parentChapterName: chapter.parentChapterName || null,
      stem: question.stem,
      stemTextStatus: question.stemTextStatus,
      options: question.options,
      optionCount: question.options?.length || 0,
      textStatus: question.textStatus,
      textMessage: question.textMessage,
      chapterId: chapter.chapterId,
      chapterIdSource: "manual",
      chapterIdStatus: "stable",
      chapterFrameId: question.chapterFrameId,
      chapterFrameStatus: question.chapterFrameStatus || "missing",
      frameId: question.frameId,
      chapterLinkStatus: "direct",
      sourceUrl: question.source?.path
        ? `https://manual.invalid${question.source.path}`
        : null,
      sourceTitle: question.source?.title || null,
      media: question.media || [],
      answer: {
        user: observation.userAnswer,
        userText: observation.userText,
        correct: correct.value,
        correctText: correct.text,
        result: observation.result,
        score: observation.score,
        correctStatus: correct.status || observation.correctStatus
      }
    };
    const saved = await store.saveOfficialQuestion(raw, {
      courseId: course.courseId,
      classId: course.classId,
      cpi: course.cpi,
      pageType: "manual_confirmation",
      now: Date.now()
    });
    if (!saved.ok) {
      toast(`${saved.error.code}：${saved.error.message}；原记录保留。`, true);
      return;
    }
    const removed = await store.deletePendingQuestion(
      question.questionKey,
      question.chapterKey
    );
    toast(
      removed.ok ? "已正式入库。" : "已入库，但 pending 未删除。",
      !removed.ok
    );
    await loadPending();
    await refreshLibrary();
  }

  /* ---------- backup ---------- */

  async function exportJson() {
    const store = getStore();
    const result = await store.exportData();
    if (!result.ok) {
      byId("backup-status").textContent = `${result.error.code}：${result.error.message}`;
      return;
    }
    const blob = new Blob([JSON.stringify(result.backup, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `chaoxing-question-bank-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    byId("backup-status").textContent = "已导出题库 JSON。";
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("读取失败"));
      reader.readAsText(file);
    });
  }

  async function previewImport(file) {
    if (!file) return;
    try {
      const backup = JSON.parse(await readFile(file));
      if (
        !backup ||
        backup.schemaVersion !== 1 ||
        !Array.isArray(backup.official) ||
        !Array.isArray(backup.pending)
      ) {
        throw new Error("备份格式无效。");
      }
      state.backup = backup;
      byId("backup-preview").hidden = false;
      byId("backup-preview").textContent =
        `正式章节：${backup.official.length}\n` +
        `待确认章节：${backup.pending.length}\n` +
        "导入会再次校验身份；浏览器存储无事务保证。";
      byId("import-confirm").hidden = false;
      byId("backup-status").textContent = "";
    } catch (error) {
      state.backup = null;
      byId("backup-preview").hidden = true;
      byId("import-confirm").hidden = true;
      byId("backup-status").textContent = `文件无效：${error.message}`;
    }
  }

  async function importJson() {
    const store = getStore();
    if (!store || !state.backup) return;
    if (
      !window.confirm(
        "导入前建议先导出当前题库。存储无事务保证，失败可能留下部分数据。继续？"
      )
    ) {
      return;
    }
    const result = await store.importData(state.backup);
    if (!result.ok) {
      const error = result.error || {};
      byId("backup-status").textContent =
        `${error.code || "IMPORT_FAILED"}：${error.message || "导入失败"}` +
        (error.partial
          ? `；partial=${error.partial}，rollbackAttempted=${error.rollbackAttempted}，rollbackSucceeded=${error.rollbackSucceeded}`
          : "");
      return;
    }
    byId("backup-status").textContent = "备份导入成功。";
    state.backup = null;
    byId("backup-preview").hidden = true;
    byId("import-confirm").hidden = true;
    await refreshLibrary();
    await loadPending();
  }

  function bind() {
    document.querySelectorAll(".nav-button").forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.view));
    });
    byId("refresh-library").addEventListener("click", refreshLibrary);
    byId("rebuild-index").addEventListener("click", rebuildIndex);
    byId("question-search").addEventListener("input", renderQuestions);
    byId("type-filter").addEventListener("change", renderQuestions);
    byId("practice-course").addEventListener("change", () =>
      loadPracticeChapters(byId("practice-course").value)
    );
    byId("practice-chapter").addEventListener("change", () => {
      byId("practice-start").disabled = !byId("practice-chapter").value;
    });
    byId("practice-start").addEventListener("click", startPractice);
    byId("practice-submit").addEventListener("click", submitPractice);
    byId("practice-next").addEventListener("click", nextPractice);
    byId("practice-quit").addEventListener("click", exitPractice);
    byId("practice-restart").addEventListener("click", () => {
      byId("practice-summary").hidden = true;
      byId("practice-setup").hidden = false;
      startPractice();
    });
    byId("practice-back").addEventListener("click", () => {
      exitPractice();
      switchView("questions");
    });
    byId("pending-refresh").addEventListener("click", loadPending);
    byId("pending-course").addEventListener("change", () =>
      loadPendingTargetChapters(byId("pending-course").value)
    );
    byId("export-json").addEventListener("click", exportJson);
    byId("import-file").addEventListener("change", (event) =>
      previewImport(event.target.files?.[0])
    );
    byId("import-confirm").addEventListener("click", importJson);
  }

  async function init() {
    bind();
    await refreshLibrary();
    await loadPending();
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
      setStatus(`初始化失败：${error.message}`);
      toast(error.message, true);
    });
  });
})();
