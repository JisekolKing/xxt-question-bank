"use strict";

/**
 * 学习通课程题库助手 · 弹窗脚本
 *
 * 当前功能：
 *   1. 「题目预览」标签页与「读取当前页面题目」按钮；
 *   2. 复用页面识别：只有确认是学习通、且不是考试页面，才注入题目解析器；
 *   3. 注入 content/question-parser.js，合并主页面与同源子框架的题目；
 *   4. 去重、补全课程/章节/来源，生成统一数据结构并在弹窗内预览；
 *   5. 只读取页面已展示的作业/章节答案；不读取隐藏答案、不自动保存、不自动提交。
 */

const ui = {};
const state = {
  busy: false,
  saving: false,
  extraction: null,
  store: null,
  library: {
    courses: [],
    chapters: [],
    selectedCourseKey: "",
    selectedChapterKey: ""
  },
  pending: {
    items: [],
    selected: null,
    confirmCourses: [],
    confirmChapters: []
  },
  practice: {
    courses: [],
    chapters: [],
    selectedCourseKey: "",
    selectedChapterKey: "",
    session: null,
    index: 0,
    answers: [],
    selection: [],
    submitted: false,
    startedAt: 0
  },
  backup: null
};
const SNAPSHOT_ALL_FRAMES_TIMEOUT_MS = 5000;
const SNAPSHOT_TOP_TIMEOUT_MS = 3000;

/**
 * 给 Promise 增加超时；超时后拒绝，避免调用方永久等待。
 * 注意：这不会取消底层 Chrome API，只保证页面识别流程能结束。
 */
function withTimeout(promise, timeoutMs, label) {
  const ms =
    Number.isFinite(timeoutMs) && timeoutMs >= 0
      ? timeoutMs
      : SNAPSHOT_ALL_FRAMES_TIMEOUT_MS;
  const name = label || "操作";

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`${name}超时（${ms}ms）`));
    }, ms);

    Promise.resolve(promise).then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** 判断是否运行在扩展环境中。 */
function hasExtensionApi() {
  return (
    typeof chrome !== "undefined" &&
    Boolean(chrome.runtime && chrome.runtime.id)
  );
}

/** 识别浏览器名称与主版本号。 */
function detectBrowser() {
  const userAgent = navigator.userAgent;

  const edge = /Edg\/(\d+)/.exec(userAgent);
  if (edge) {
    return `Microsoft Edge ${edge[1]}`;
  }

  const chromium = /(?:Chrome|Chromium)\/(\d+)/.exec(userAgent);
  if (chromium) {
    return `Chromium 内核 ${chromium[1]}`;
  }

  return "未知浏览器";
}

/** 读取扩展版本号。 */
function readVersion() {
  if (!hasExtensionApi()) {
    return "预览模式";
  }

  try {
    return chrome.runtime.getManifest().version;
  } catch (error) {
    console.warn("读取版本号失败：", error);
    return "未知";
  }
}

/** 检查 storage 权限是否可用。 */
async function checkStorage() {
  if (!hasExtensionApi() || !chrome.storage || !chrome.storage.local) {
    return "不可用";
  }

  try {
    await chrome.storage.local.get(null);
    return "可用";
  } catch (error) {
    console.warn("本地存储不可用：", error);
    return "不可用";
  }
}

/** 安全写入文本（不使用 innerHTML）。 */
function setText(elementId, text) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = text;
  }
}

function cacheElements() {
  ui.tabRecognize = document.getElementById("tab-recognize");
  ui.tabQuestions = document.getElementById("tab-questions");
  ui.tabLibrary = document.getElementById("tab-library");
  ui.tabPractice = document.getElementById("tab-practice");
  ui.panelRecognize = document.getElementById("panel-recognize");
  ui.panelQuestions = document.getElementById("panel-questions");
  ui.panelLibrary = document.getElementById("panel-library");
  ui.panelPractice = document.getElementById("panel-practice");
  ui.questionBadge = document.getElementById("question-count-badge");
  ui.pendingBadge = document.getElementById("pending-count-badge");
  ui.openLibrary = document.getElementById("open-library");

  ui.button = document.getElementById("detect-button");
  ui.buttonLabel = document.getElementById("detect-button-label");
  ui.empty = document.getElementById("recognizer-empty");
  ui.result = document.getElementById("result");
  ui.site = document.getElementById("result-site");
  ui.type = document.getElementById("result-type");
  ui.confidence = document.getElementById("result-confidence");
  ui.course = document.getElementById("result-course");
  ui.chapter = document.getElementById("result-chapter");
  ui.pageTitle = document.getElementById("result-title");
  ui.url = document.getElementById("result-url");
  ui.note = document.getElementById("result-note");
  ui.evidence = document.getElementById("result-evidence");
  ui.error = document.getElementById("recognizer-error");

  ui.extractButton = document.getElementById("extract-button");
  ui.extractButtonLabel = document.getElementById("extract-button-label");
  ui.extractEmpty = document.getElementById("extract-empty");
  ui.extractError = document.getElementById("extract-error");
  ui.extractResult = document.getElementById("extract-result");
  ui.extractCount = document.getElementById("extract-count");
  ui.extractPageType = document.getElementById("extract-page-type");
  ui.extractMeta = document.getElementById("extract-meta");
  ui.extractNote = document.getElementById("extract-note");
  ui.questionList = document.getElementById("question-list");

  ui.savePanel = document.getElementById("save-panel");
  ui.saveSummary = document.getElementById("save-summary");
  ui.saveStatus = document.getElementById("save-status");
  ui.saveButton = document.getElementById("save-extract-button");
  ui.saveButtonLabel = document.getElementById("save-extract-label");
  ui.saveExtractFileButton = document.getElementById("save-extract-file-button");
  ui.saveUnverifiedButton = document.getElementById("save-unverified-button");

  ui.libraryStatus = document.getElementById("library-status");
  ui.libraryWarning = document.getElementById("library-warning");
  ui.libraryRebuild = document.getElementById("library-rebuild");
  ui.libraryRefresh = document.getElementById("library-refresh");
  ui.libraryCourse = document.getElementById("library-course");
  ui.libraryChapter = document.getElementById("library-chapter");
  ui.libraryQuestions = document.getElementById("library-questions");
  ui.deleteChapterButton = document.getElementById("delete-chapter-button");

  ui.pendingStatus = document.getElementById("pending-status");
  ui.pendingList = document.getElementById("pending-list");
  ui.pendingRefresh = document.getElementById("pending-refresh");
  ui.pendingConfirm = document.getElementById("pending-confirm");
  ui.pendingConfirmTitle = document.getElementById("pending-confirm-title");
  ui.pendingCourse = document.getElementById("pending-course");
  ui.pendingChapter = document.getElementById("pending-chapter");
  ui.pendingConfirmWarning = document.getElementById("pending-confirm-warning");
  ui.pendingConfirmButton = document.getElementById("pending-confirm-button");
  ui.pendingCancel = document.getElementById("pending-cancel");

  ui.exportButton = document.getElementById("export-button");
  ui.importFile = document.getElementById("import-file");
  ui.backupPreview = document.getElementById("backup-preview");
  ui.importConfirmButton = document.getElementById("import-confirm-button");
  ui.backupStatus = document.getElementById("backup-status");

  ui.practiceSetup = document.getElementById("practice-setup");
  ui.practiceStatus = document.getElementById("practice-status");
  ui.practiceRefresh = document.getElementById("practice-refresh");
  ui.practiceCourse = document.getElementById("practice-course");
  ui.practiceChapter = document.getElementById("practice-chapter");
  ui.practiceMode = document.getElementById("practice-mode");
  ui.practiceStart = document.getElementById("practice-start");
  ui.practiceSession = document.getElementById("practice-session");
  ui.practiceProgressText = document.getElementById("practice-progress-text");
  ui.practiceProgressRemaining = document.getElementById("practice-progress-remaining");
  ui.practiceQuestion = document.getElementById("practice-question");
  ui.practiceFeedback = document.getElementById("practice-feedback");
  ui.practiceSubmit = document.getElementById("practice-submit");
  ui.practiceNext = document.getElementById("practice-next");
  ui.practiceQuit = document.getElementById("practice-quit");
  ui.practiceSummary = document.getElementById("practice-summary");
  ui.practiceSummaryText = document.getElementById("practice-summary-text");
  ui.practiceRestart = document.getElementById("practice-restart");
  ui.practiceBack = document.getElementById("practice-back");
}

// ---------- 标签页 ----------

function activateTab(name, focus) {
  const tabs = [
    { name: "recognize", tab: ui.tabRecognize, panel: ui.panelRecognize },
    { name: "questions", tab: ui.tabQuestions, panel: ui.panelQuestions },
    { name: "library", tab: ui.tabLibrary, panel: ui.panelLibrary },
    { name: "practice", tab: ui.tabPractice, panel: ui.panelPractice }
  ].filter((item) => item.tab && item.panel);
  const active = tabs.some((item) => item.name === name)
    ? name
    : "recognize";

  tabs.forEach((item) => {
    const selected = item.name === active;
    item.tab.setAttribute("aria-selected", String(selected));
    item.tab.tabIndex = selected ? 0 : -1;
    item.panel.hidden = !selected;
  });

  if (focus) {
    const current = tabs.find((item) => item.name === active);
    if (current) current.tab.focus();
  }

  if (active === "library") {
    refreshLibrary().catch((error) => {
      console.error("读取本地题库失败：", error);
      showLibraryStatus(error.message || "读取本地题库失败", true);
    });
  }
  if (active === "practice") {
    refreshPracticeSetup().catch((error) => {
      console.error("读取练习题库失败：", error);
      if (ui.practiceStatus) ui.practiceStatus.textContent = error.message;
    });
  }
}

function bindTabs() {
  const tabs = [
    ui.tabRecognize,
    ui.tabQuestions,
    ui.tabLibrary,
    ui.tabPractice
  ].filter(Boolean);
  if (tabs.length === 0) {
    return;
  }

  ui.tabRecognize?.addEventListener("click", () => activateTab("recognize"));
  ui.tabQuestions?.addEventListener("click", () => activateTab("questions"));
  ui.tabLibrary?.addEventListener("click", () => activateTab("library"));
  ui.tabPractice?.addEventListener("click", () => activateTab("practice"));

  tabs.forEach((tab, index) => {
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      activateTab(
        next === ui.tabRecognize
          ? "recognize"
          : next === ui.tabQuestions
          ? "questions"
          : next === ui.tabLibrary
          ? "library"
          : "practice",
        true
      );
    });
  });
}

// ---------- 忙状态 ----------

function setBusy(busy, mode) {
  state.busy = busy;
  ui.button.disabled = busy;
  ui.extractButton.disabled = busy;

  if (busy) {
    if (mode === "extract") {
      ui.extractButtonLabel.textContent = "正在读取…";
    } else {
      ui.buttonLabel.textContent = "正在识别…";
    }
    return;
  }

  ui.buttonLabel.textContent = "识别当前页面";
  ui.extractButtonLabel.textContent = "读取当前页面题目";
}

function startRecognitionLoading() {
  setBusy(true, "recognize");
  ui.empty.hidden = false;
  ui.empty.textContent = "正在读取当前标签页，请稍候…";
  ui.result.hidden = true;
  ui.error.hidden = true;
  ui.error.textContent = "";
}

function startExtractionLoading() {
  setBusy(true, "extract");
  ui.extractEmpty.hidden = false;
  ui.extractEmpty.textContent = "正在读取当前页面的题目，请稍候…";
  ui.extractResult.hidden = true;
  ui.extractError.hidden = true;
  ui.extractError.textContent = "";
}

// ---------- 展示工具 ----------

function formatUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    let text = parsed.host + path;
    if (parsed.search) {
      text += "?…";
    }
    if (text.length > 62) {
      text = text.slice(0, 61) + "…";
    }
    return text;
  } catch (error) {
    return String(rawUrl || "");
  }
}

function renderResult(result, page) {
  ui.empty.hidden = true;
  ui.error.hidden = true;
  ui.result.hidden = false;

  const isChaoxing = Boolean(result.isChaoxing);
  ui.site.textContent = isChaoxing ? "学习通" : "非学习通";
  ui.site.className = "chip " + (isChaoxing ? "chip--ok" : "chip--muted");

  ui.type.textContent = result.label || "无法识别";

  const confidenceLabels = {
    high: "置信度：高",
    medium: "置信度：中",
    low: "置信度：低",
    none: ""
  };
  const confidenceText = confidenceLabels[result.confidence] || "";
  ui.confidence.textContent = confidenceText;
  ui.confidence.hidden = confidenceText === "";

  const hasCourse =
    typeof result.courseName === "string" && result.courseName.length > 0;
  ui.course.textContent = hasCourse ? result.courseName : "未识别到课程名称";
  ui.course.classList.toggle("is-muted", !hasCourse);
  ui.course.title = hasCourse
    ? `${result.courseName}${
        result.courseNameSource ? `（来源：${result.courseNameSource}）` : ""
      }`
    : "";

  const hasChapter =
    typeof result.chapterName === "string" && result.chapterName.length > 0;
  const hasParentChapter =
    typeof result.parentChapterName === "string" &&
    result.parentChapterName.length > 0;
  ui.chapter.textContent = hasChapter ? result.chapterName : "未识别到章节";
  ui.chapter.classList.toggle("is-muted", !hasChapter);
  ui.chapter.title = hasChapter
    ? `${
        hasParentChapter ? `${result.parentChapterName} / ` : ""
      }${result.chapterName}${
        result.chapterNameSource
          ? `（来源：${result.chapterNameSource}）`
          : ""
      }`
    : "";

  const pageTitle = page.title || "（无标题）";
  ui.pageTitle.textContent = pageTitle;
  ui.pageTitle.title = pageTitle;

  ui.url.textContent = formatUrl(page.url);
  ui.url.title = page.url;

  const notes = [];
  if (result.note) {
    notes.push(result.note);
  }
  if (hasCourse && result.courseNameSource) {
    notes.push(`课程名称来源：${result.courseNameSource}。`);
  }
  if (hasChapter && result.chapterNameSource) {
    notes.push(`章节名称来源：${result.chapterNameSource}。`);
  }
  if (hasParentChapter) {
    notes.push(`上级章节：${result.parentChapterName}。`);
  }
  if (!hasCourse) {
    notes.push("未从页面可见内容中找到可靠的课程名称，因此不显示推测结果。");
  }
  ui.note.textContent = notes.join(" ");

  const evidence = Array.isArray(result.evidence)
    ? result.evidence.filter(Boolean).slice(0, 3)
    : [];
  if (evidence.length > 0) {
    ui.evidence.textContent = "识别依据：" + evidence.join("；");
    ui.evidence.hidden = false;
  } else {
    ui.evidence.textContent = "";
    ui.evidence.hidden = true;
  }
}

function showError(message) {
  ui.empty.hidden = true;
  ui.result.hidden = true;
  ui.error.hidden = false;
  ui.error.textContent = message;
}

function showExtractError(message) {
  ui.extractEmpty.hidden = true;
  ui.extractResult.hidden = true;
  ui.extractError.hidden = false;
  ui.extractError.textContent = message;

  ui.questionBadge.hidden = true;
  ui.questionBadge.textContent = "0";
}

function toFriendlyError(error) {
  const message =
    error && error.message ? String(error.message) : String(error || "");

  if (
    /Cannot access|Cannot access contents|gallery cannot be scripted|Missing host permission|extensions gallery/i.test(
      message
    )
  ) {
    return "当前页面不允许扩展读取。请先打开学习通课程网页；edge://、扩展商店等浏览器内部页面无法读取。";
  }
  if (/No tab with id|tab was closed|Invalid tab ID/i.test(message)) {
    return "当前标签页已关闭或切换，请重新打开学习通页面后再试。";
  }

  return `识别失败：${message || "未知错误"}`;
}

// ---------- 页面分析（复用第二阶段） ----------

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  return Array.isArray(tabs) && tabs.length > 0 ? tabs[0] : null;
}

async function collectSnapshots(tabId, timeoutOptions) {
  const snapshotFunction = globalThis.collectPageSnapshot;

  if (typeof snapshotFunction !== "function") {
    throw new Error("页面快照脚本未加载，请重新加载扩展。");
  }

  const limits = {
    allFrames:
      timeoutOptions && Number.isFinite(timeoutOptions.allFrames)
        ? timeoutOptions.allFrames
        : SNAPSHOT_ALL_FRAMES_TIMEOUT_MS,
    top:
      timeoutOptions && Number.isFinite(timeoutOptions.top)
        ? timeoutOptions.top
        : SNAPSHOT_TOP_TIMEOUT_MS
  };

  let injections;
  try {
    injections = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: snapshotFunction
      }),
      limits.allFrames,
      "读取全部框架"
    );
  } catch (error) {
    console.warn("读取全部框架失败或超时，改为只读取顶层页面：", error);
    injections = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId },
        func: snapshotFunction
      }),
      limits.top,
      "读取顶层页面"
    );
  }

  return (injections || [])
    .map((item) => {
      if (!item || !item.result || typeof item.result.url !== "string") {
        return null;
      }
      return {
        ...item.result,
        frameId:
          typeof item.frameId === "number" && Number.isFinite(item.frameId)
            ? item.frameId
            : null
      };
    })
    .filter(Boolean);
}

async function analyzeCurrentTab() {
  if (!hasExtensionApi()) {
    throw new Error(
      "当前不在扩展环境中，无法读取标签页。请从 Edge 工具栏打开插件后重试。"
    );
  }

  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number") {
    throw new Error("没有找到当前标签页，请打开一个学习通网页后重试。");
  }

  const rawUrl = typeof tab.url === "string" ? tab.url : "";
  if (!rawUrl) {
    throw new Error(
      "无法获取当前标签页地址。请刷新页面，或在 edge://extensions/ 重新加载插件后重试。"
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (error) {
    throw new Error("当前页面地址无效，无法识别。");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      `浏览器内部页面（${parsedUrl.protocol}）不允许扩展读取。请打开学习通网页后再试。`
    );
  }

  const classifier = globalThis.ChaoxingClassifier;
  if (!classifier) {
    throw new Error("识别模块未加载，请在 edge://extensions/ 重新加载本插件。");
  }

  const pageTitle = typeof tab.title === "string" ? tab.title : "";

  const urlOnly = classifier.classify({
    url: rawUrl,
    title: pageTitle,
    frames: []
  });

  if (!urlOnly.isChaoxing) {
    return {
      tab,
      rawUrl,
      pageTitle,
      result: urlOnly,
      frames: []
    };
  }

  let frames = [];
  let snapshotError = null;

  try {
    frames = await collectSnapshots(tab.id);
  } catch (error) {
    snapshotError = error;
    console.warn("读取页面可见内容失败，将只根据网址判断：", error);
  }

  const result = classifier.classify({
    url: rawUrl,
    title: pageTitle,
    frames
  });

  if (snapshotError) {
    result.note = `${result.note} 未能读取页面可见文字，本次仅根据网址判断。`;
  }

  const analysis = {
    tab,
    rawUrl,
    pageTitle,
    result,
    frames
  };

  await applyCourseContext(analysis);
  return analysis;
}

/**
 * 课程上下文动作：
 *   save   - 真正课程主页，保存索引/兼容上下文
 *   lookup - 作业、章节测验、练习、章节内容页，查询已有索引
 *   skip   - 其他页面，不做课程关联
 */
function isChapterContentUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch (error) {
    return false;
  }

  if (/\/(?:knowledge|chapter)\//i.test(url.pathname)) {
    return true;
  }
  if (/\/mycourse\/studentstudy/i.test(url.pathname)) {
    return true;
  }

  const chapterKeys = new Set([
    "chapterid",
    "knowledgeid",
    "chapter_id",
    "knowledge_id",
    "chapter",
    "knowledge"
  ]);

  for (const key of url.searchParams.keys()) {
    if (chapterKeys.has(key.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function getCourseContextAction(result, rawUrl) {
  const pageType = result && result.pageType;
  const isChapter = isChapterContentUrl(rawUrl);

  if (pageType === "courseHome") {
    // 课程主页被章节页误判时，不能覆盖课程索引。
    return isChapter ? "lookup" : "save";
  }

  if (
    pageType === "chapterQuiz" ||
    pageType === "chapterStudy" ||
    pageType === "practice" ||
    pageType === "homework"
  ) {
    return "lookup";
  }

  if (pageType === "other" && isChapter) {
    return "lookup";
  }

  return "skip";
}

/**
 * 课程主页保存课程索引和 tab 上下文；作业/章节页面优先用 URL 课程索引，
 * URL 标识不完整时才在兼容范围内退回原有 tab 上下文。
 */
async function applyCourseContext(analysis) {
  const context = globalThis.CourseContext;
  const index = globalThis.CourseIndex;
  const sessionStore =
    hasExtensionApi() && chrome.storage && chrome.storage.session
      ? chrome.storage.session
      : null;
  const localStore =
    hasExtensionApi() && chrome.storage && chrome.storage.local
      ? chrome.storage.local
      : null;

  if (!analysis || !analysis.result) {
    return;
  }

  const action = getCourseContextAction(
    analysis.result,
    analysis.rawUrl
  );

  if (action === "skip") {
    return;
  }

  if (action === "save") {
    if (!analysis.result.courseName) {
      return;
    }
    if (index && localStore) {
      await index.saveIndex(
        localStore,
        analysis.result,
        analysis.rawUrl
      );
    }
    if (context && sessionStore) {
      await context.saveContext(
        sessionStore,
        analysis.tab,
        analysis.result,
        analysis.rawUrl,
        analysis.frames
      );
    }
    return;
  }

  // lookup 页面：已有课程名时不覆盖。
  // chapterStudy 的标题推断值“学生学习页面”不是可靠课程名，
  // 必须清除后继续查询课程索引。
  const pageType = analysis.result.pageType;
  const inferredTitle =
    analysis.result.courseNameSource === "页面标题（推断）";
  if (analysis.result.courseName) {
    if (pageType === "chapterStudy" && inferredTitle) {
      analysis.result.courseName = null;
      analysis.result.courseNameSource = null;
    } else {
      return;
    }
  }

  const identifiers = index
    ? index.readUrlIdentifiers(analysis.rawUrl)
    : { courseId: null, classId: null, cpi: null };
  const hasCourseId = Boolean(identifiers.courseId);
  const hasClassId = Boolean(identifiers.classId);

  // URL 里有任一课程标识时，以 URL 索引为准；不完整或找不到都不退回
  // tab 上下文，避免用较弱的兼容数据覆盖 URL 语义。
  if (hasCourseId || hasClassId) {
    if (hasCourseId && hasClassId && index && localStore) {
      const matched = await index.findIndex(
        localStore,
        analysis.rawUrl
      );
      if (matched.status === "ok" && matched.record) {
        analysis.result.courseName = matched.record.courseName;
        analysis.result.courseNameSource = "URL课程索引关联";
        analysis.result.courseContext = {
          source: matched.record.source,
          updatedAt: matched.record.updatedAt
        };
      }
    }
    return;
  }

  // 只有 homework 保留原有 tab 上下文兼容分支；章节页面不能用
  // 其他 tab 的弱上下文猜测课程，避免错误关联。
  if (analysis.result.pageType === "homework" && context && sessionStore) {
    const loaded = await context.loadContext(
      sessionStore,
      analysis.tab,
      analysis.result,
      analysis.rawUrl
    );
    if (loaded.status === "ok" && loaded.courseName) {
      analysis.result.courseName = loaded.courseName;
      analysis.result.courseNameSource = "课程页上下文";
      analysis.result.courseContext = {
        source: loaded.record && loaded.record.source,
        savedAt: loaded.record && loaded.record.savedAt
      };
    }
  }
}

// ---------- 题目提取 ----------

const CXSECRET_FILES = [
  "content/vendor/typr.js",
  "content/vendor/cxsecret-table.js",
  "content/cxsecret.js"
];

async function injectCxSecretDecoder(tabId, allFrames) {
  try {
    await chrome.scripting.executeScript({
      target: allFrames ? { tabId, allFrames: true } : { tabId },
      files: CXSECRET_FILES
    });
    return true;
  } catch (error) {
    console.warn("字体还原模块注入失败，将保留 protected 标记：", error);
    return false;
  }
}

function isDescendantFrame(frameTree, frameId, ancestorFrameId) {
  if (!Array.isArray(frameTree)) return false;
  const byId = new Map(
    frameTree.map((frame) => [frame.frameId, frame])
  );
  let current = byId.get(frameId);
  const visited = new Set();
  while (current && !visited.has(current.frameId)) {
    visited.add(current.frameId);
    if (current.parentFrameId === ancestorFrameId) {
      return true;
    }
    if (
      typeof current.parentFrameId !== "number" ||
      current.parentFrameId < 0
    ) {
      return false;
    }
    current = byId.get(current.parentFrameId);
  }
  return false;
}

async function collectFrameTree(tabId) {
  if (
    !hasExtensionApi() ||
    !chrome.webNavigation ||
    typeof chrome.webNavigation.getAllFrames !== "function"
  ) {
    return null;
  }
  try {
    return await chrome.webNavigation.getAllFrames({ tabId });
  } catch (error) {
    console.warn("读取 frame 树失败，将保留 cross_frame 标记：", error);
    return null;
  }
}

async function collectQuestionFrames(tabId) {
  const parser = globalThis.extractSingleChoiceQuestions;

  if (typeof parser !== "function") {
    throw new Error("题目解析脚本未加载，请重新加载扩展。");
  }

  await injectCxSecretDecoder(tabId, true);

  let injections;
  try {
    injections = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: parser,
      args: [{ requireVisible: true }]
    });
  } catch (error) {
    console.warn("读取全部框架失败，改为只读取顶层页面：", error);
    await injectCxSecretDecoder(tabId, false);
    injections = await chrome.scripting.executeScript({
      target: { tabId },
      func: parser,
      args: [{ requireVisible: true }]
    });
  }

  return (injections || [])
    .map((item) => ({
      frameId: item && typeof item.frameId === "number" ? item.frameId : 0,
      result: item && item.result
    }))
    .filter(
      (item) =>
        item.result &&
        Array.isArray(item.result.questions) &&
        item.result.stats
    )
    .sort((a, b) => a.frameId - b.frameId);
}

function normalizeKey(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
}

function makeQuestionKey(raw, options, frameId) {
  const frameScope =
    typeof frameId === "number" && Number.isFinite(frameId)
      ? `frame:${frameId}`
      : "frame:unknown";
  const type =
    raw && raw.type === "multiple_choice"
      ? "multiple_choice"
      : raw && raw.type === "judgment"
      ? "judgment"
      : "single_choice";

  if (raw && raw.textStatus && raw.textStatus !== "ok") {
    return [
      "partial",
      frameScope,
      type,
      raw.textStatus,
      raw.number,
      options.map((option) => normalizeKey(option.label)).join(",")
    ].join("|");
  }

  return (
    type +
    "\u0001" +
    frameScope +
    "\u0001" +
    normalizeKey(raw && raw.stem) +
    "\u0002" +
    options
      .map(
        (option) =>
          normalizeKey(option.label) + "=" + normalizeKey(option.text)
      )
      .join("\u0003")
  );
}

function hashText(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function buildQuestionId(question) {
  if (question.textStatus !== "ok") {
    return `sc_${hashText(
      [
        "partial",
        question.type,
        question.textStatus,
        question.number,
        question.options.map((option) => normalizeKey(option.label)).join(""),
        question.sourceUrl
      ].join("|")
    )}`;
  }

  const payload = [
    question.type,
    normalizeKey(question.stem),
    question.options
      .map(
        (option) =>
          normalizeKey(option.label) + ":" + normalizeKey(option.text)
      )
      .join("|")
  ].join("\u0001");

  return `sc_${hashText(payload)}`;
}

function mapAnswerToOptions(value, options) {
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

function buildAnswer(rawAnswer, options) {
  if (!rawAnswer || typeof rawAnswer !== "object") {
    return null;
  }

  const user =
    typeof rawAnswer.user === "string" && rawAnswer.user.length > 0
      ? rawAnswer.user
      : null;
  const correct =
    typeof rawAnswer.correct === "string" && rawAnswer.correct.length > 0
      ? rawAnswer.correct
      : null;
  const result =
    rawAnswer.result === "correct" || rawAnswer.result === "incorrect"
      ? rawAnswer.result
      : "unknown";
  const score =
    typeof rawAnswer.score === "number" &&
    Number.isFinite(rawAnswer.score)
      ? rawAnswer.score
      : null;
  const correctStatus =
    rawAnswer.correctStatus === "visible" ||
    rawAnswer.correctStatus === "not_visible" ||
    rawAnswer.correctStatus === "unknown"
      ? rawAnswer.correctStatus
      : "unknown";

  return {
    user,
    correct,
    result,
    score,
    correctStatus,
    userText:
      typeof rawAnswer.userText === "string" && rawAnswer.userText
        ? rawAnswer.userText
        : mapAnswerToOptions(user, options),
    correctText:
      typeof rawAnswer.correctText === "string" && rawAnswer.correctText
        ? rawAnswer.correctText
        : mapAnswerToOptions(correct, options)
  };
}

function getChapterLinkStatus(analysis, frameId, questionFrameCount) {
  const result = (analysis && analysis.result) || {};
  if (result.chapterIdStatus !== "stable") {
    return result.chapterIdStatus === "ambiguous" ? "ambiguous" : "missing";
  }
  if (
    result.chapterFrameStatus === "ambiguous" ||
    result.chapterFrameStatus === "missing" ||
    result.chapterFrameId == null
  ) {
    return "ambiguous";
  }
  if (questionFrameCount !== 1) {
    return "ambiguous";
  }
  if (result.chapterFrameId === frameId) {
    return "direct";
  }
  if (
    isDescendantFrame(
      analysis.frameTree,
      frameId,
      result.chapterFrameId
    )
  ) {
    return "descendant";
  }
  return "cross_frame";
}

function buildQuestion(raw, options, analysis, frameContext) {
  const type =
    raw.type === "multiple_choice"
      ? "multiple_choice"
      : raw.type === "judgment"
      ? "judgment"
      : "single_choice";
  const context = frameContext || {};
  const frameId =
    typeof context.frameId === "number" && Number.isFinite(context.frameId)
      ? context.frameId
      : null;
  const questionFrameCount =
    typeof context.questionFrameCount === "number"
      ? context.questionFrameCount
      : 1;
  const chapterIdStatus =
    analysis.result.chapterIdStatus || "missing";
  const chapterId =
    chapterIdStatus === "stable"
      ? analysis.result.chapterId || null
      : null;
  const chapterIdSource =
    chapterIdStatus === "stable"
      ? analysis.result.chapterIdSource || null
      : null;
  const chapterLinkStatus = getChapterLinkStatus(
    analysis,
    frameId,
    questionFrameCount
  );
  const allowedStatuses = new Set([
    "ok",
    "protected_text",
    "mixed",
    "unreadable"
  ]);
  const textStatus = allowedStatuses.has(raw.textStatus)
    ? raw.textStatus
    : "ok";
  const stemTextStatus =
    raw.stemTextStatus === "ok" || raw.stemTextStatus === "protected_text" ||
    raw.stemTextStatus === "unreadable"
      ? raw.stemTextStatus
      : textStatus === "ok"
      ? "ok"
      : "protected_text";

  const question = {
    id: "",
    number:
      typeof raw.number === "number" && Number.isFinite(raw.number)
        ? raw.number
        : null,
    type,
    stem: stemTextStatus === "ok" ? raw.stem : null,
    stemTextStatus,
    options: options.map((option) => {
      const optionStatus =
        option.textStatus === "ok" ||
        option.textStatus === "protected_text" ||
        option.textStatus === "unreadable"
          ? option.textStatus
          : "ok";
      return {
        label: String(option.label || ""),
        text: optionStatus === "ok" ? String(option.text || "") : null,
        textStatus: optionStatus
      };
    }),
    optionCount: options.length,
    textStatus,
    textMessage:
      raw.textMessage ||
      (textStatus === "ok"
        ? ""
        : textStatus === "mixed"
        ? "部分题干或选项文字受保护/不可读，已保留可读部分。"
        : "文字受保护，未读取内容。"),
    course: analysis.result.courseName || null,
    chapter: analysis.result.chapterName || null,
    parentChapterName: analysis.result.parentChapterName || null,
    chapterId,
    chapterIdSource,
    chapterIdStatus,
    chapterFrameId:
      typeof analysis.result.chapterFrameId === "number"
        ? analysis.result.chapterFrameId
        : null,
    chapterFrameStatus: analysis.result.chapterFrameStatus || "missing",
    frameId,
    chapterLinkStatus,
    sourceUrl: analysis.rawUrl,
    sourceTitle:
      analysis.pageTitle ||
      (analysis.frames[0] && analysis.frames[0].title) ||
      null,
    media: Array.isArray(raw.media) ? raw.media : [],
    answer: null
  };

  question.answer = buildAnswer(raw.answer, question.options);
  question.id = buildQuestionId(question);
  return question;
}

function mergeQuestionFrames(frames, analysis) {
  const totals = {
    containers: 0,
    extracted: 0,
    structures: 0,
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
  const skipped = [];
  const questions = [];
  const seen = new Set();
  const usedIds = new Set();
  const questionFrameCount = frames.filter(
    (frame) =>
      frame &&
      frame.result &&
      Array.isArray(frame.result.questions) &&
      frame.result.questions.length > 0
  ).length;

  frames.forEach((frame) => {
    const stats = frame.result.stats || {};
    Object.keys(totals).forEach((key) => {
      totals[key] += Number(stats[key]) || 0;
    });

    if (Array.isArray(frame.result.skipped)) {
      frame.result.skipped.forEach((item) => {
        if (skipped.length < 8) {
          skipped.push(item);
        }
      });
    }

    (frame.result.questions || []).forEach((raw) => {
      if (
        !raw ||
        (raw.type !== "single_choice" &&
          raw.type !== "multiple_choice" &&
          raw.type !== "judgment")
      ) {
        return;
      }

      const textStatus = [
        "ok",
        "protected_text",
        "mixed",
        "unreadable"
      ].includes(raw.textStatus)
        ? raw.textStatus
        : "ok";
      const isPartial = textStatus !== "ok";

      if (!isPartial && !raw.stem) {
        return;
      }

      const options = Array.isArray(raw.options)
        ? raw.options.filter((option) => {
            if (
              !option ||
              typeof option.label !== "string" ||
              option.label.trim() === ""
            ) {
              return false;
            }
            const optionStatus = [
              "ok",
              "protected_text",
              "unreadable"
            ].includes(option.textStatus)
              ? option.textStatus
              : "ok";
            if (optionStatus === "ok") {
              return (
                typeof option.text === "string" &&
                option.text.trim() !== ""
              );
            }
            return true;
          })
        : [];

      if (options.length < 2) {
        return;
      }

      const key = makeQuestionKey(raw, options, frame.frameId);
      if (seen.has(key)) {
        totals.duplicates += 1;
        return;
      }
      seen.add(key);

      const question = buildQuestion(raw, options, analysis, {
        frameId: frame.frameId,
        questionFrameCount
      });
      let id = question.id;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${question.id}_${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);
      question.id = id;
      questions.push(question);
    });
  });

  totals.structures = questions.length;
  totals.extracted = questions.filter(
    (question) => question.textStatus === "ok"
  ).length;
  totals.protectedText = questions.filter(
    (question) =>
      question.textStatus === "protected_text" ||
      question.textStatus === "unreadable"
  ).length;
  totals.mixedText = questions.filter(
    (question) => question.textStatus === "mixed"
  ).length;

  return {
    questions,
    stats: totals,
    skipped
  };
}

// ---------- 题目预览 ----------

function describeMedia(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  if (item.kind === "formula") {
    const value = item.alt || item.text || "已保留公式引用";
    return `公式：${value}`;
  }

  const label = item.alt ? `图片：${item.alt}` : "图片：已保留引用";
  return item.option ? `${label}（选项 ${item.option}）` : label;
}

function formatAnswerValue(answer, field) {
  const value = answer[field];
  if (!value) {
    return null;
  }
  const detail = answer[`${field}Text`];
  return detail ? `${value}（${detail}）` : value;
}

function createAnswerBlock(answer) {
  const box = document.createElement("div");
  box.className = "question-card__answer";
  box.dataset.correctStatus = answer.correctStatus || "unknown";

  const rows = [
    ["我的答案", formatAnswerValue(answer, "user") || "未显示"],
    ["正确答案", formatAnswerValue(answer, "correct") || "未展示"],
    [
      "答题结果",
      answer.result === "correct"
        ? "正确"
        : answer.result === "incorrect"
        ? "错误"
        : "未知"
    ],
    ["分数", answer.score == null ? "未显示" : `${answer.score} 分`]
  ];

  rows.forEach(([label, value]) => {
    const line = document.createElement("div");
    line.className = "question-card__answer-row";

    const name = document.createElement("span");
    name.className = "question-card__answer-label";
    name.textContent = label;

    const content = document.createElement("span");
    content.className = "question-card__answer-value";
    content.textContent = value;

    line.append(name, content);
    box.append(line);
  });

  return box;
}

function createQuestionCard(question) {
  const article = document.createElement("article");
  article.className = "question-card";

  const head = document.createElement("div");
  head.className = "question-card__head";

  const number = document.createElement("span");
  number.className = "question-card__number";
  number.textContent = `第 ${question.number == null ? "?" : question.number} 题`;

  const type = document.createElement("span");
  type.className = "question-card__type";
  type.textContent =
    question.type === "multiple_choice"
      ? "多选题"
      : question.type === "judgment"
      ? "判断题"
      : "单选题";

  head.append(number, type);

  const statusLabels = {
    protected_text: "文字受保护",
    mixed: "部分文字受保护",
    unreadable: "文字不可读"
  };
  const statusLabel = statusLabels[question.textStatus];

  if (statusLabel) {
    const status = document.createElement("span");
    status.className = "question-card__status";
    status.textContent = statusLabel;
    head.append(status);
  }

  const media = Array.isArray(question.media) ? question.media : [];
  if (media.length > 0) {
    const mediaCount = document.createElement("span");
    mediaCount.className = "question-card__media-count";
    mediaCount.textContent = `引用 ${media.length}`;
    head.append(mediaCount);
  }

  const stemTextStatus =
    question.stemTextStatus || (question.stem ? "ok" : "protected_text");
  const stemProtected = stemTextStatus !== "ok";

  const stem = document.createElement("p");
  stem.className = "question-card__stem";
  stem.textContent = stemProtected
    ? stemTextStatus === "unreadable"
      ? "题干文字不可读。"
      : "题干文字受保护，未读取内容。"
    : question.stem;
  if (stemProtected) {
    stem.classList.add("question-card__stem--protected");
  }

  const optionList = document.createElement("ul");
  optionList.className = "question-card__options";

  question.options.forEach((option) => {
    const item = document.createElement("li");
    item.className = "question-option";

    const label = document.createElement("span");
    label.className = "question-option__label";
    label.textContent = option.label || "•";

    const optionTextStatus =
      option.textStatus || (option.text == null ? "protected_text" : "ok");
    const optionProtected = optionTextStatus !== "ok";

    const text = document.createElement("span");
    text.className = "question-option__text";
    text.textContent = optionProtected
      ? optionTextStatus === "unreadable"
        ? "选项文字不可读"
        : "选项文字受保护，未读取"
      : option.text;
    if (optionProtected) {
      text.classList.add("question-option__text--protected");
    }

    item.append(label, text);
    optionList.append(item);
  });

  const partList = [question.parentChapterName, question.chapter].filter(
    (value) => typeof value === "string" && value.length > 0
  );
  const chapterLine =
    partList.length > 0
      ? (() => {
          const line = document.createElement("p");
          line.className = "question-card__chapter";
          line.textContent = partList.join(" / ");
          return line;
        })()
      : null;

  article.append(head);
  if (chapterLine) {
    article.append(chapterLine);
  }
  article.append(stem, optionList);

  if (question.answer) {
    article.append(createAnswerBlock(question.answer));
  }

  if (media.length > 0) {
    const mediaBox = document.createElement("div");
    mediaBox.className = "question-card__media";

    media.slice(0, 3).forEach((item) => {
      const line = document.createElement("div");
      line.className = "question-card__media-item";
      line.textContent = describeMedia(item);
      mediaBox.append(line);
    });

    article.append(mediaBox);
  }

  return article;
}

function buildExtractNote(data, analysis) {
  const { questions, stats, skipped } = data;
  const count = questions.length;
  const readable = questions.filter(
    (question) => question.textStatus === "ok"
  ).length;
  const mixed = questions.filter(
    (question) => question.textStatus === "mixed"
  ).length;
  const protectedOnly = questions.filter(
    (question) =>
      question.textStatus === "protected_text" ||
      question.textStatus === "unreadable"
  ).length;
  const singleCount = questions.filter(
    (question) => question.type === "single_choice"
  ).length;
  const multipleCount = questions.filter(
    (question) => question.type === "multiple_choice"
  ).length;
  const judgmentCount = questions.filter(
    (question) => question.type === "judgment"
  ).length;
  const typeParts = [];
  if (singleCount > 0) {
    typeParts.push(`单选 ${singleCount}`);
  }
  if (multipleCount > 0) {
    typeParts.push(`多选 ${multipleCount}`);
  }
  if (judgmentCount > 0) {
    typeParts.push(`判断 ${judgmentCount}`);
  }
  const typeSummary =
    typeParts.length > 1 ? `（${typeParts.join(" / ")}）` : "";
  const questionNoun =
    typeParts.length > 1
      ? "题目"
      : judgmentCount > 0
      ? "判断题"
      : multipleCount > 0
      ? "多选题"
      : "单选题";
  const parts = [];

  if (stats.skippedHomeworkUnsupported > 0) {
    parts.push(`作业填空/简答题 ${stats.skippedHomeworkUnsupported} 道`);
  }
  if (stats.skippedMultiple > 0) {
    parts.push(`未处理多选题 ${stats.skippedMultiple} 道`);
  }
  if (stats.skippedOtherType > 0) {
    parts.push(`其他题型 ${stats.skippedOtherType} 道`);
  }
  if (stats.skippedUnknownType > 0) {
    parts.push(`无法确定题型 ${stats.skippedUnknownType} 道`);
  }
  if (stats.skippedIncomplete > 0) {
    parts.push(`结构不完整 ${stats.skippedIncomplete} 道`);
  }
  if (stats.duplicates > 0) {
    parts.push(`重复 ${stats.duplicates} 道已跳过`);
  }
  if (stats.inferredLabels > 0) {
    parts.push(`${stats.inferredLabels} 个选项序号按顺序推断`);
  }

  const missing = [];
  if (!analysis.result.courseName) {
    missing.push("课程");
  }
  if (!analysis.result.chapterName) {
    missing.push("章节");
  }
  const diagnostic =
    missing.length > 0
      ? ` ${missing.join("/")}未识别：现有选择器未匹配，待真实课程头部 HTML 样本后再补。`
      : "";
  const finish = (note) => note + diagnostic;

  if (count > 0) {
    let note = "";

    if (readable === count) {
      note = `已读取 ${count} 道${questionNoun}${typeSummary}，尚未保存。`;
    } else {
      note = `识别到 ${count} 道结构${typeSummary}；${readable} 道完全可读`;
      if (mixed > 0) {
        note += `、${mixed} 道部分可读`;
      }
      if (protectedOnly > 0) {
        note += `、${protectedOnly} 道文字受保护/不可读`;
      }
      note += "；受保护文字未保存。";
    }

    if (parts.length > 0) {
      note += ` 跳过：${parts.join("、")}。`;
    }
    return finish(note);
  }

  if (stats.containers === 0) {
    return finish(
      "当前页面没有找到可识别的题目容器。可能是页面结构不同，或题目还没有展开显示。"
    );
  }

  if (stats.skippedHomeworkUnsupported > 0) {
    return finish(
      `作业页面中的填空/简答题暂不支持，已跳过 ${stats.skippedHomeworkUnsupported} 道。`
    );
  }

  if (
    stats.skippedMultiple > 0 &&
    stats.skippedOtherType === 0 &&
    stats.skippedUnknownType === 0 &&
    stats.skippedIncomplete === 0
  ) {
    return finish("当前页面找到的题目是多选题，但未被识别为可解析结构。");
  }

  let note = "未提取到题目。";
  if (parts.length > 0) {
    note += ` 检测到：${parts.join("、")}。`;
  }
  if (skipped.length > 0 && skipped[0].preview) {
    note += ` 首个未识别内容：「${skipped[0].preview}」`;
  }
  if (analysis.result.pageType === "other") {
    note += " 当前页面类型也未能细分，建议打开具体测验或作业页面后再试。";
  }
  return finish(note);
}

function renderQuestions(data, analysis, savePlan, saveContext) {
  const count = data.questions.length;
  const readable = data.questions.filter(
    (question) => question.textStatus === "ok"
  ).length;
  const singleCount = data.questions.filter(
    (question) => question.type === "single_choice"
  ).length;
  const multipleCount = data.questions.filter(
    (question) => question.type === "multiple_choice"
  ).length;
  const judgmentCount = data.questions.filter(
    (question) => question.type === "judgment"
  ).length;

  ui.extractEmpty.hidden = true;
  ui.extractError.hidden = true;
  ui.extractResult.hidden = false;

  const typeParts = [];
  if (singleCount > 0) {
    typeParts.push(`单选 ${singleCount}`);
  }
  if (multipleCount > 0) {
    typeParts.push(`多选 ${multipleCount}`);
  }
  if (judgmentCount > 0) {
    typeParts.push(`判断 ${judgmentCount}`);
  }
  const typeSummary =
    typeParts.length > 1 ? `（${typeParts.join(" / ")}）` : "";

  if (count === 0) {
    ui.extractCount.textContent = "0 道结构";
  } else if (readable === count && typeParts.length === 1) {
    const onlyType =
      singleCount > 0
        ? "单选题"
        : multipleCount > 0
        ? "多选题"
        : "判断题";
    ui.extractCount.textContent = `${count} 道${onlyType}`;
  } else {
    const textParts = [`${count} 道结构${typeSummary}`];
    if (readable > 0) {
      textParts.push(`${readable} 道完全可读`);
    }
    if (readable < count) {
      textParts.push(`${count - readable} 道含受保护/不可读文字`);
    }
    ui.extractCount.textContent = textParts.join(" · ");
  }

  ui.extractPageType.textContent = analysis.result.label || "学习通";
  ui.extractPageType.className =
    "chip " +
    (analysis.result.pageType === "other" ? "chip--muted" : "chip--ok");

  ui.extractMeta.textContent = `课程：${
    analysis.result.courseName || "未识别（待样本）"
  } · 章节：${analysis.result.chapterName || "未识别（待样本）"}`;

  ui.extractNote.textContent = buildExtractNote(data, analysis);

  ui.questionList.textContent = "";

  if (count === 0) {
    const empty = document.createElement("p");
    empty.className = "question-empty";
    empty.textContent = "没有可预览的题目。";
    ui.questionList.append(empty);
  } else {
    data.questions.forEach((question) => {
      ui.questionList.append(createQuestionCard(question));
    });
  }

  ui.questionBadge.textContent = String(count);
  ui.questionBadge.hidden = count === 0;

  state.extraction = {
    data,
    analysis,
    savePlan: savePlan || null,
    saveContext: saveContext || null
  };
  renderSavePanel();
}

// ---------- 题库保存与浏览 ----------

function getQuestionStore() {
  if (state.store) {
    return state.store;
  }
  const storageApi = globalThis.QuestionBankStorage;
  if (
    !storageApi ||
    !hasExtensionApi() ||
    !chrome.storage ||
    !chrome.storage.local
  ) {
    return null;
  }
  state.store = storageApi.createStorage({
    storage: chrome.storage.local,
    now: Date.now,
    locks:
      globalThis.navigator && globalThis.navigator.locks
        ? globalThis.navigator.locks
        : null
  });
  return state.store;
}

async function buildSaveContext(analysis) {
  const identifiers =
    (globalThis.CourseIndex &&
      globalThis.CourseIndex.readUrlIdentifiers(analysis.rawUrl)) ||
    {};
  let record = null;

  if (
    hasExtensionApi() &&
    chrome.storage &&
    chrome.storage.local &&
    globalThis.CourseIndex &&
    identifiers.courseId &&
    identifiers.classId
  ) {
    const matched = await globalThis.CourseIndex.findIndex(
      chrome.storage.local,
      analysis.rawUrl
    );
    if (matched.status === "ok") {
      record = matched.record;
    }
  }

  return {
    courseId: identifiers.courseId || record?.courseId || null,
    classId: identifiers.classId || record?.classId || null,
    cpi: identifiers.cpi || record?.cpi || null,
    pageType: analysis.result.pageType || null,
    now: Date.now()
  };
}

function buildSaveExtractionPlan(data, context) {
  const Bank = globalThis.QuestionBank;
  const plan = {
    context,
    official: [],
    pending: [],
    rejected: []
  };
  if (!Bank) {
    return plan;
  }

  (data.questions || []).forEach((question) => {
    const converted = Bank.toBankQuestion(question, context);
    if (converted.plan.target === "official") {
      plan.official.push(question);
    } else if (converted.plan.target === "pending") {
      plan.pending.push(question);
    } else {
      plan.rejected.push({
        question,
        reason: converted.plan.reason
      });
    }
  });
  return plan;
}

function showSaveStatus(text, kind) {
  if (!ui.saveStatus) return;
  ui.saveStatus.hidden = !text;
  ui.saveStatus.textContent = text || "";
  ui.saveStatus.className = "save-status";
  if (kind === "ok") {
    ui.saveStatus.classList.add("is-ok");
  } else if (kind === "warn") {
    ui.saveStatus.classList.add("is-warn");
  }
}

function renderSavePanel() {
  if (!ui.savePanel) return;
  const extraction = state.extraction;
  if (!extraction || !extraction.savePlan) {
    ui.savePanel.hidden = true;
    return;
  }

  const plan = extraction.savePlan;
  const total =
    plan.official.length + plan.pending.length + plan.rejected.length;
  const courseName =
    extraction.analysis.result.courseName || "课程未识别";
  const chapterName =
    extraction.analysis.result.chapterName || "章节未识别";
  const context = plan.context || {};
  const hasCourseIdentity = Boolean(context.courseId && context.classId);
  const store = getQuestionStore();

  ui.savePanel.hidden = false;
  ui.saveSummary.textContent =
    `${courseName} · ${chapterName} · 共 ${total} 题` +
    `；正式 ${plan.official.length}，待确认 ${plan.pending.length}` +
    `，拒绝/跳过 ${plan.rejected.length}` +
    (hasCourseIdentity ? "" : "（缺少 courseId/classId，无法入库）");
  ui.saveButton.disabled =
    state.saving ||
    !store ||
    plan.official.length + plan.pending.length === 0;
  ui.saveButtonLabel.textContent = state.saving
    ? "正在保存…"
    : "保存本次解析结果";
  if (ui.saveExtractFileButton) {
    ui.saveExtractFileButton.disabled = state.saving || total === 0;
  }
  if (ui.saveUnverifiedButton) {
    ui.saveUnverifiedButton.disabled =
      state.saving || !store || total === 0;
  }
}

function buildLenientContext(analysis, context) {
  const base = context || {};
  const courseName =
    analysis.result.courseName || "未识别课程";
  const courseId =
    base.courseId ||
    `local_${hashText(`course|${courseName}`)}`;
  const classId = base.classId || "local";
  return {
    ...base,
    courseId,
    classId,
    cpi: base.cpi || null,
    allowUnverified: true,
    identityFallback:
      !base.courseId || !base.classId ? "name" : null
  };
}

function safePath(rawUrl) {
  try {
    return new URL(String(rawUrl || "")).pathname || null;
  } catch (error) {
    return null;
  }
}

function exportExtractionJson() {
  const extraction = state.extraction;
  if (!extraction) {
    showSaveStatus("没有可导出的解析结果。", "warn");
    return;
  }
  const questions = (extraction.data.questions || []).map((question) => {
    const copy = { ...question };
    copy.sourcePath = safePath(question.sourceUrl);
    delete copy.sourceUrl;
    return copy;
  });
  const payload = {
    schemaVersion: 1,
    exportedAt: Date.now(),
    courseName: extraction.analysis.result.courseName || null,
    chapterName: extraction.analysis.result.chapterName || null,
    sourcePath: safePath(extraction.analysis.rawUrl),
    questions
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `chaoxing-extraction-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showSaveStatus(
    `已导出 ${questions.length} 道题的 JSON 文件（未入库）。`,
    "ok"
  );
}

async function handleLenientSave() {
  if (state.saving) return;
  const extraction = state.extraction;
  const store = getQuestionStore();
  if (!extraction || !store) {
    showSaveStatus("本地题库存储不可用，未保存。", "warn");
    return;
  }
  const context = buildLenientContext(
    extraction.analysis,
    extraction.saveContext
  );
  state.saving = true;
  renderSavePanel();
  showSaveStatus(
    "正在宽松保存：跨 frame 题目会标记为未验证，不会伪装成已验证。",
    ""
  );
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let skipped = 0;
  const errors = [];
  try {
    for (const question of extraction.data.questions || []) {
      if (
        !question.chapterId ||
        question.chapterIdStatus !== "stable"
      ) {
        skipped += 1;
        continue;
      }
      const result = await store.saveUnverifiedQuestion(question, context);
      if (result.ok) {
        if (result.action === "insert") inserted += 1;
        else updated += 1;
      } else {
        failed += 1;
        errors.push(result.error);
      }
    }
    let text =
      `宽松保存完成：新增 ${inserted}，更新 ${updated}，` +
      `跳过（缺少稳定章节 ID）${skipped}，失败 ${failed}。` +
      "这些题目会标记为未验证，不能视为已证明章节归属。";
    if (errors[0]) {
      text += ` 首个错误：${errors[0].code} - ${errors[0].message}`;
    }
    showSaveStatus(text, failed > 0 ? "warn" : "ok");
    await refreshLibrary({ silent: true });
    await refreshPending();
  } catch (error) {
    showSaveStatus(`宽松保存失败：${error.message}`, "warn");
  } finally {
    state.saving = false;
    renderSavePanel();
  }
}

async function handleSaveExtraction() {
  if (state.saving) return;
  const extraction = state.extraction;
  const store = getQuestionStore();
  if (!extraction || !store) {
    showSaveStatus("本地题库存储不可用，未保存。", "warn");
    return;
  }

  const plan = extraction.savePlan;
  if (!plan) {
    showSaveStatus("当前解析结果没有保存计划。", "warn");
    return;
  }

  state.saving = true;
  renderSavePanel();
  showSaveStatus("正在保存，请勿关闭弹窗…", "");
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let pendingSaved = 0;
  let indexWarning = false;
  const errors = [];

  try {
    for (const question of plan.official) {
      const result = await store.saveOfficialQuestion(
        question,
        extraction.saveContext
      );
      if (result.ok) {
        if (result.action === "insert") inserted += 1;
        else updated += 1;
      } else {
        failed += 1;
        errors.push(result.error);
        if (
          result.error &&
          result.error.code === "INDEX_WRITE_FAILED"
        ) {
          indexWarning = true;
        }
      }
    }

    for (const question of plan.pending) {
      const result = await store.savePendingQuestion(
        question,
        extraction.saveContext
      );
      if (result.ok) {
        pendingSaved += 1;
      } else {
        failed += 1;
        errors.push(result.error);
        if (
          result.error &&
          result.error.code === "INDEX_WRITE_FAILED"
        ) {
          indexWarning = true;
        }
      }
    }

    const firstError = errors[0];
    const parts = [
      `新增 ${inserted}`,
      `更新 ${updated}`,
      `待确认 ${pendingSaved}`,
      `失败 ${failed}`,
      `拒绝/跳过 ${plan.rejected.length}`
    ];
    let text = `保存完成：${parts.join("，")}。`;
    if (firstError) {
      text += ` 首个错误：${firstError.code} - ${firstError.message}`;
    }
    if (indexWarning) {
      text += " 索引可能过期，请到题库管理执行“重建索引”。";
    }
    if (failed > 0) {
      text += " 可使用“导出本次解析 JSON”直接保存文件。";
    }
    showSaveStatus(
      text,
      failed > 0 || indexWarning ? "warn" : "ok"
    );
    await refreshLibrary({ silent: true });
    await refreshPending();
  } catch (error) {
    console.error("保存题库失败：", error);
    showSaveStatus(`保存失败：${toFriendlyError(error)}`, "warn");
  } finally {
    state.saving = false;
    renderSavePanel();
  }
}

function showLibraryStatus(text, warning) {
  if (!ui.libraryStatus) return;
  ui.libraryStatus.textContent = text || "";
  ui.libraryStatus.className = warning
    ? "library-status library-warning"
    : "library-status";
}

function fillSelect(select, items, valueKey, labelKey, placeholder) {
  if (!select) return;
  select.textContent = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = placeholder;
  select.append(empty);
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item[valueKey] || "";
    option.textContent = item[labelKey] || item[valueKey] || "未命名";
    select.append(option);
  });
}

function setSelectValue(select, value) {
  if (!select) return;
  const options = Array.from(select.options || []);
  const selected = options.find((option) => option.value === value);
  options.forEach((option) => {
    option.selected = Boolean(selected && option === selected);
  });
  if (!selected && options[0]) {
    options[0].selected = true;
  }
}

function showLibraryWarning(text) {
  if (!ui.libraryWarning) return;
  ui.libraryWarning.hidden = !text;
  ui.libraryWarning.textContent = text || "";
}

function setLibraryRebuildVisible(visible) {
  if (ui.libraryRebuild) {
    ui.libraryRebuild.hidden = !visible;
  }
}

async function refreshLibrary(options) {
  const opts = options || {};
  const store = getQuestionStore();
  if (!store) {
    showLibraryStatus("本地题库存储不可用。", true);
    return;
  }

  const concurrency = store.getConcurrencyInfo();
  showLibraryWarning(
    concurrency.crossInstanceSafe
      ? ""
      : concurrency.warning || "并发保护已降级。"
  );

  if (!opts.silent) {
    showLibraryStatus("正在读取本地题库…", false);
  }
  setLibraryRebuildVisible(false);

  const coursesResult = await store.getCourses();
  if (!coursesResult.ok) {
    showLibraryStatus(
      `${coursesResult.error.code}：${coursesResult.error.message}`,
      true
    );
    setLibraryRebuildVisible(
      /INDEX|STORAGE/.test(coursesResult.error.code || "")
    );
    return;
  }

  state.library.courses = coursesResult.courses || [];
  const courseNames = state.library.courses.map((course) => course.courseName);
  if (coursesResult.indexRecovered) {
    showLibraryStatus("索引缺失或损坏，已从章节数据自动重建。", true);
  } else {
    showLibraryStatus(
      `共 ${state.library.courses.length} 门课程。`,
      false
    );
  }

  let selectedCourseKey = state.library.selectedCourseKey;
  if (
    !state.library.courses.some(
      (course) => course.courseKey === selectedCourseKey
    )
  ) {
    selectedCourseKey =
      state.library.courses[0]?.courseKey || "";
  }
  state.library.selectedCourseKey = selectedCourseKey;
  fillSelect(
    ui.libraryCourse,
    state.library.courses,
    "courseKey",
    "courseName",
    "选择课程"
  );
  if (selectedCourseKey) {
    setSelectValue(ui.libraryCourse, selectedCourseKey);
  }

  await loadChaptersForCourse(selectedCourseKey);
  const stats = await store.getStorageStats();
  if (stats.ok && !coursesResult.indexRecovered) {
    ui.libraryStatus.textContent =
      `${state.library.courses.length} 门课程 · ` +
      `${stats.stats.chapterCount} 个章节 · ` +
      `${stats.stats.questionCount} 道题 · ` +
      `${stats.stats.pendingCount} 道待确认`;
  }
}

async function loadChaptersForCourse(courseKey) {
  if (!ui.libraryChapter) return;
  if (!courseKey) {
    state.library.chapters = [];
    fillSelect(ui.libraryChapter, [], "chapterKey", "chapterName", "暂无章节");
    renderLibraryQuestions([]);
    if (ui.deleteChapterButton) ui.deleteChapterButton.hidden = true;
    return;
  }

  const store = getQuestionStore();
  const result = await store.getChapters(courseKey);
  if (!result.ok) {
    showLibraryStatus(
      `${result.error.code}：${result.error.message}`,
      true
    );
    setLibraryRebuildVisible(true);
    return;
  }
  state.library.chapters = result.chapters || [];
  fillSelect(
    ui.libraryChapter,
    state.library.chapters,
    "chapterKey",
    "chapterName",
    "选择章节"
  );
  let chapterKey = state.library.selectedChapterKey;
  if (
    !state.library.chapters.some(
      (chapter) => chapter.chapterKey === chapterKey
    )
  ) {
    chapterKey = state.library.chapters[0]?.chapterKey || "";
  }
  state.library.selectedChapterKey = chapterKey;
  if (chapterKey) setSelectValue(ui.libraryChapter, chapterKey);
  await loadQuestionsForChapter(chapterKey);
}

async function loadQuestionsForChapter(chapterKey) {
  if (!ui.libraryQuestions) return;
  if (!chapterKey) {
    renderLibraryQuestions([]);
    if (ui.deleteChapterButton) ui.deleteChapterButton.hidden = true;
    return;
  }
  const store = getQuestionStore();
  const result = await store.getQuestions(chapterKey);
  if (!result.ok) {
    ui.libraryQuestions.textContent = "";
    const error = document.createElement("p");
    error.className = "question-empty";
    error.textContent = `${result.error.code}：${result.error.message}`;
    ui.libraryQuestions.append(error);
    if (ui.deleteChapterButton) ui.deleteChapterButton.hidden = true;
    return;
  }
  if (ui.deleteChapterButton) ui.deleteChapterButton.hidden = false;
  renderLibraryQuestions(result.questions || []);
}

function renderLibraryQuestions(questions) {
  if (!ui.libraryQuestions) return;
  ui.libraryQuestions.textContent = "";
  if (!questions.length) {
    const empty = document.createElement("p");
    empty.className = "question-empty";
    empty.textContent = "当前章节没有已保存题目。";
    ui.libraryQuestions.append(empty);
    return;
  }

  questions.forEach((question) => {
    const card = document.createElement("article");
    card.className = "bank-question";

    const head = document.createElement("div");
    head.className = "bank-question__head";
    const number = document.createElement("span");
    number.className = "question-card__number";
    number.textContent = `第 ${question.number || "?"} 题`;
    const type = document.createElement("span");
    type.className = "question-card__type";
    type.textContent = questionTypeLabel(question.type);
    const actions = document.createElement("div");
    actions.className = "bank-question__actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mini-button mini-button--danger";
    remove.textContent = "删除";
    remove.addEventListener("click", async () => {
      if (!window.confirm("确定删除这道题？")) return;
      const store = getQuestionStore();
      const result = await store.deleteQuestion(
        question.questionKey,
        question.chapterKey
      );
      if (!result.ok) {
        showLibraryStatus(
          `${result.error.code}：${result.error.message}`,
          true
        );
        return;
      }
      await refreshLibrary({ silent: true });
    });
    actions.append(remove);
    head.append(number, type, actions);

    const stem = document.createElement("p");
    stem.className = "bank-question__stem";
    stem.textContent =
      question.stem ||
      (question.identityQuality === "partial"
        ? "题干文字受保护或不可读。"
        : "（无题干）");
    const meta = document.createElement("p");
    meta.className = "bank-question__meta";
    meta.textContent = `章节：${question.chapterName || "未命名"} · 来源：${
      question.source?.title || question.source?.path || "未知"
    }${
      question.verification === "frame_unverified"
        ? " · 未验证章节关联"
        : question.verification === "identity_unverified"
        ? " · 未验证课程/章节身份"
        : ""
    }`;
    const options = document.createElement("ul");
    options.className = "question-card__options";
    (question.options || []).forEach((option) => {
      const item = document.createElement("li");
      item.className = "question-option";
      const label = document.createElement("span");
      label.className = "question-option__label";
      label.textContent = option.label || "";
      const text = document.createElement("span");
      text.className = "question-option__text";
      text.textContent =
        option.text ||
        (option.textStatus === "ok" ? "" : "（文字不可读）");
      item.append(label, text);
      options.append(item);
    });
    const answer = document.createElement("p");
    answer.className = "bank-question__answer";
    answer.textContent = `正确答案：${
      question.correctAnswer?.status === "visible" &&
      question.correctAnswer?.value
        ? `${question.correctAnswer.value}${
            question.correctAnswer.text
              ? `（${question.correctAnswer.text}）`
              : ""
          }`
        : "未公布/未知"
    }`;

    card.append(head, stem, options, meta, answer);
    ui.libraryQuestions.append(card);
  });
}

async function refreshPending() {
  const store = getQuestionStore();
  if (!store) return;
  const result = await store.getPendingQuestions();
  if (!result.ok) {
    if (ui.pendingStatus) {
      ui.pendingStatus.textContent = `${result.error.code}：${result.error.message}`;
    }
    return;
  }
  state.pending.items = result.questions || [];
  if (ui.pendingStatus) {
    ui.pendingStatus.textContent = state.pending.items.length
      ? `${state.pending.items.length} 道待确认题目。`
      : "没有待确认题目。";
  }
  if (ui.pendingBadge) {
    ui.pendingBadge.textContent = String(state.pending.items.length);
    ui.pendingBadge.hidden = state.pending.items.length === 0;
  }
  renderPendingQuestions();
}

function pendingReason(question) {
  if (question.chapterLinkStatus === "cross_frame") {
    return "跨 frame，目录与题目 frame 未证明一致，需要人工确认章节归属。";
  }
  return `待确认：${question.chapterLinkStatus || "身份未确认"}`;
}

function renderPendingQuestions() {
  if (!ui.pendingList) return;
  ui.pendingList.textContent = "";
  if (!state.pending.items.length) {
    const empty = document.createElement("p");
    empty.className = "question-empty";
    empty.textContent = "没有待确认题目。";
    ui.pendingList.append(empty);
    return;
  }

  state.pending.items.forEach((question) => {
    const card = document.createElement("article");
    card.className = "pending-card";
    const head = document.createElement("div");
    head.className = "bank-question__head";
    const type = document.createElement("span");
    type.className = "question-card__type";
    type.textContent = questionTypeLabel(question.type);
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "mini-button";
    confirm.textContent = "确认归属";
    confirm.addEventListener("click", () => {
      openPendingConfirm(question).catch((error) => {
        if (ui.pendingConfirmWarning) {
          ui.pendingConfirmWarning.hidden = false;
          ui.pendingConfirmWarning.textContent = error.message;
        }
      });
    });
    head.append(type, confirm);

    const stem = document.createElement("p");
    stem.className = "pending-card__stem";
    stem.textContent = question.stem || "（题干受保护或不可读）";
    const meta = document.createElement("p");
    meta.className = "bank-question__meta";
    meta.textContent = `课程：${question.courseName || "未知"} · 原章节：${
      question.chapterName || "未知"
    }`;
    const reason = document.createElement("p");
    reason.className = "pending-card__reason";
    reason.textContent = pendingReason(question);

    card.append(head, stem, meta, reason);
    ui.pendingList.append(card);
  });
}

function normalizeChapterName(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
}

function sameName(a, b) {
  return (
    normalizeChapterName(a).toLowerCase() ===
    normalizeChapterName(b).toLowerCase()
  );
}

function courseDisplayName(course) {
  return `${course.courseName || "未命名课程"}${
    course.courseId ? ` · ${course.courseId}` : ""
  }`;
}

function chapterDisplayName(chapter) {
  return `${chapter.chapterName || "未命名章节"}${
    chapter.parentChapterName
      ? ` · 上级：${chapter.parentChapterName}`
      : ""
  }${chapter.chapterId ? ` · ${chapter.chapterId}` : ""}`;
}

function buildPendingCourses(question) {
  const courses = (state.library.courses || []).map((course) => ({
    ...course,
    _source: "official",
    displayName: courseDisplayName(course)
  }));
  const exact = courses.find(
    (course) => course.courseKey === question.courseKey
  );
  if (!exact && question.courseName) {
    courses.push({
      courseKey: question.courseKey,
      courseId: question.courseId || null,
      classId: question.classId || null,
      cpi: question.cpi || null,
      courseName: question.courseName,
      chapterCount: 1,
      _source: "pending_catalog",
      displayName: `${courseDisplayName(question)} · 来自待确认目录`
    });
  }
  return courses;
}

function choosePendingCourse(question, courses) {
  const byName = courses.filter((course) =>
    sameName(course.courseName, question.courseName)
  );
  if (byName.length > 1) {
    return { course: null, ambiguous: true };
  }
  const exact = courses.find(
    (course) => course.courseKey === question.courseKey
  );
  if (exact) return { course: exact, ambiguous: false };
  if (byName.length === 1) {
    return { course: byName[0], ambiguous: false };
  }
  return { course: null, ambiguous: false };
}

function buildPendingChapters(question, courseKey, officialChapters) {
  const chapters = (officialChapters || []).map((chapter) => ({
    ...chapter,
    _source: "official",
    displayName: chapterDisplayName(chapter)
  }));
  if (
    courseKey === question.courseKey &&
    !chapters.some((chapter) => chapter.chapterKey === question.chapterKey)
  ) {
    chapters.push({
      chapterKey: question.chapterKey,
      chapterId: question.chapterId || null,
      chapterIdSource: question.chapterIdSource || "coursetree",
      chapterIdStatus: question.chapterIdStatus || "missing",
      chapterName: question.chapterName || null,
      parentChapterName: question.parentChapterName || null,
      questionCount: 1,
      _source: "pending_catalog",
      displayName: `${chapterDisplayName(question)} · 来自待确认目录`
    });
  }
  return chapters;
}

function choosePendingChapter(question, chapters) {
  const official = chapters.filter(
    (chapter) => chapter._source !== "pending_catalog"
  );
  const candidates = official.length > 0 ? official : chapters;
  const byName = candidates.filter((chapter) =>
    sameName(chapter.chapterName, question.chapterName)
  );
  if (byName.length > 1) {
    return { chapter: null, ambiguous: true };
  }
  const exact = candidates.find(
    (chapter) => chapter.chapterKey === question.chapterKey
  );
  if (exact) return { chapter: exact, ambiguous: false };
  if (byName.length === 1) {
    return { chapter: byName[0], ambiguous: false };
  }
  return { chapter: null, ambiguous: false };
}

function updatePendingConfirmState() {
  if (!ui.pendingConfirmButton) return;
  const courseKey = ui.pendingCourse?.value;
  const chapterKey = ui.pendingChapter?.value;
  const course = state.pending.confirmCourses.find(
    (item) => item.courseKey === courseKey
  );
  const chapter = state.pending.confirmChapters.find(
    (item) => item.chapterKey === chapterKey
  );
  let warning = "";
  if (!course) {
    warning = "请选择目标课程。";
  } else if (!chapter) {
    warning = "请选择目标章节。";
  } else if (
    !chapter.chapterId ||
    chapter.chapterIdStatus !== "stable"
  ) {
    warning = "目标章节没有稳定 chapterId，不能正式入库。";
  }
  ui.pendingConfirmButton.disabled = Boolean(warning);
  if (warning) {
    ui.pendingConfirmWarning.hidden = false;
    ui.pendingConfirmWarning.textContent = warning;
  } else {
    ui.pendingConfirmWarning.hidden = true;
    ui.pendingConfirmWarning.textContent = "";
  }
}

async function openPendingConfirm(question) {
  state.pending.selected = question;
  if (!ui.pendingConfirm) return;
  if (ui.pendingConfirmButton) ui.pendingConfirmButton.disabled = true;
  ui.pendingConfirm.hidden = false;
  ui.pendingConfirmTitle.textContent = `确认题目归属：${
    question.stem || "（无题干）"
  }`;
  ui.pendingConfirmWarning.hidden = true;
  ui.pendingConfirmWarning.textContent = "";

  if (!state.library.courses.length) {
    await refreshLibrary({ silent: true });
  }

  const courses = buildPendingCourses(question);
  state.pending.confirmCourses = courses;
  fillSelect(
    ui.pendingCourse,
    courses,
    "courseKey",
    "displayName",
    "选择目标课程"
  );

  const courseChoice = choosePendingCourse(question, courses);
  let warning = "";
  if (courseChoice.course) {
    setSelectValue(ui.pendingCourse, courseChoice.course.courseKey);
  } else if (courseChoice.ambiguous) {
    warning =
      "找到多个同名课程，不能自动选择，请根据课程 ID 手动确认。";
  }

  await loadPendingChapters(ui.pendingCourse.value, {
    autoSelect: true,
    inheritedWarning: warning
  });
}

async function loadPendingChapters(courseKey, options) {
  const opts = options || {};
  const store = getQuestionStore();
  if (!ui.pendingChapter) return;
  state.pending.confirmChapters = [];
  fillSelect(ui.pendingChapter, [], "chapterKey", "displayName", "选择章节");
  updatePendingConfirmState();
  if (!courseKey) {
    if (opts.inheritedWarning) {
      ui.pendingConfirmWarning.hidden = false;
      ui.pendingConfirmWarning.textContent = opts.inheritedWarning;
    }
    return;
  }
  if (!store) return;

  const result = await store.getChapters(courseKey);
  if (!result.ok) {
    ui.pendingConfirmWarning.hidden = false;
    ui.pendingConfirmWarning.textContent = `${result.error.code}：${result.error.message}`;
    return;
  }

  const question = state.pending.selected;
  const chapters = buildPendingChapters(
    question || {},
    courseKey,
    result.chapters || []
  );
  state.pending.confirmChapters = chapters;
  fillSelect(
    ui.pendingChapter,
    chapters,
    "chapterKey",
    "displayName",
    "选择目标章节"
  );

  let warning = opts.inheritedWarning || "";
  const chapterChoice = choosePendingChapter(question || {}, chapters);
  if (opts.autoSelect !== false) {
    if (chapterChoice.chapter) {
      setSelectValue(ui.pendingChapter, chapterChoice.chapter.chapterKey);
    } else if (chapterChoice.ambiguous) {
      warning =
        "找到多个同名章节，不能自动选择，请根据章节 ID 或上级章节手动确认。";
    } else {
      warning = "没有找到同名目标章节，请手动选择。";
    }
  }

  updatePendingConfirmState();
  if (warning) {
    ui.pendingConfirmWarning.hidden = false;
    ui.pendingConfirmWarning.textContent = warning;
  }
}

function pendingToOfficialQuestion(pending, course, chapter) {
  const observation = pending.importObservation || {};
  const correct = pending.correctAnswer || {};
  const path = pending.source?.path || "";
  return {
    type: pending.type,
    number: pending.number,
    course: course.courseName,
    chapter: chapter.chapterName,
    parentChapterName: chapter.parentChapterName || null,
    stem: pending.stem,
    stemTextStatus: pending.stemTextStatus,
    options: pending.options,
    optionCount: pending.options?.length || 0,
    textStatus: pending.textStatus,
    textMessage: pending.textMessage,
    chapterId: chapter.chapterId,
    chapterIdSource: "manual",
    chapterIdStatus: "stable",
    chapterFrameId: pending.chapterFrameId,
    chapterFrameStatus: pending.chapterFrameStatus || "missing",
    frameId: pending.frameId,
    // 这是人工确认后的明确来源声明，不是把原 pending 记录原地改写。
    chapterLinkStatus: "direct",
    sourceUrl: path ? `https://manual.invalid${path}` : null,
    sourceTitle: pending.source?.title || null,
    media: pending.media || [],
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
}

async function confirmPendingQuestion() {
  const pending = state.pending.selected;
  const store = getQuestionStore();
  if (!pending || !store) return;
  const courseKey = ui.pendingCourse?.value;
  const chapterKey = ui.pendingChapter?.value;
  const course = state.pending.confirmCourses.find(
    (item) => item.courseKey === courseKey
  );
  const chapter = state.pending.confirmChapters.find(
    (item) => item.chapterKey === chapterKey
  );
  if (!course || !chapterKey) {
    ui.pendingConfirmWarning.hidden = false;
    ui.pendingConfirmWarning.textContent = "请选择目标课程和章节。";
    return;
  }
  if (!chapter || !chapter.chapterId || chapter.chapterIdStatus !== "stable") {
    ui.pendingConfirmWarning.hidden = false;
    ui.pendingConfirmWarning.textContent =
      "目标章节没有稳定 chapterId，不能确认入库。";
    return;
  }

  if (
    typeof window.confirm === "function" &&
    !window.confirm(
      "人工确认会把该题归入目标章节，并重新走正式入库门禁。继续？"
    )
  ) {
    return;
  }

  ui.pendingConfirmButton.disabled = true;
  try {
    const raw = pendingToOfficialQuestion(pending, course, chapter);
    const result = await store.saveOfficialQuestion(raw, {
      courseId: course.courseId,
      classId: course.classId,
      cpi: course.cpi,
      pageType: "manual_confirmation",
      now: Date.now()
    });
    if (!result.ok) {
      ui.pendingConfirmWarning.hidden = false;
      ui.pendingConfirmWarning.textContent =
        `${result.error.code}：${result.error.message}；原待确认记录已保留。`;
      return;
    }
    const removed = await store.deletePendingQuestion(
      pending.questionKey,
      pending.chapterKey
    );
    ui.pendingConfirmWarning.hidden = false;
    ui.pendingConfirmWarning.textContent = removed.ok
      ? "已正式入库，原待确认记录已移除。"
      : "已正式入库，但原待确认记录未移除；请手动清理。";
    await refreshPending();
    await refreshLibrary({ silent: true });
  } finally {
    ui.pendingConfirmButton.disabled = false;
  }
}

async function deleteCurrentChapter() {
  const chapterKey = state.library.selectedChapterKey;
  const store = getQuestionStore();
  if (!chapterKey || !store) return;
  const includePending = window.confirm(
    "是否同时删除该章节的待确认题目？确定=同时删除；取消=只删除正式章节。"
  );
  const result = await store.deleteChapter(chapterKey, { includePending });
  if (!result.ok) {
    showLibraryStatus(`${result.error.code}：${result.error.message}`, true);
    return;
  }
  await refreshLibrary({ silent: true });
  await refreshPending();
}

function questionTypeLabel(type) {
  return type === "multiple_choice"
    ? "多选题"
    : type === "judgment"
    ? "判断题"
    : "单选题";
}

async function exportBackup() {
  const store = getQuestionStore();
  if (!store) return;
  const result = await store.exportData();
  if (!result.ok) {
    ui.backupStatus.textContent = `${result.error.code}：${result.error.message}`;
    return;
  }
  const text = JSON.stringify(result.backup, null, 2);
  const blob = new Blob([text], { type: "application/json" });
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
  ui.backupStatus.textContent = "已导出 JSON 备份。";
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

async function previewBackupFile(file) {
  if (!file) return;
  try {
    const text = await readFileText(file);
    const backup = JSON.parse(text);
    if (
      !backup ||
      backup.schemaVersion !== 1 ||
      !Array.isArray(backup.official) ||
      !Array.isArray(backup.pending)
    ) {
      throw new Error("不是当前版本支持的题库备份。");
    }
    state.backup = backup;
    ui.backupPreview.hidden = false;
    ui.backupPreview.textContent =
      `备份版本：${backup.schemaVersion}\n` +
      `正式章节：${backup.official.length}\n` +
      `待确认章节：${backup.pending.length}\n` +
      "导入前会再次校验身份；存储无事务保证。";
    ui.importConfirmButton.hidden = false;
    ui.backupStatus.textContent = "";
  } catch (error) {
    state.backup = null;
    ui.backupPreview.hidden = true;
    ui.importConfirmButton.hidden = true;
    ui.backupStatus.textContent = `备份文件无效：${error.message}`;
  }
}

async function confirmImportBackup(backupOverride) {
  const store = getQuestionStore();
  const backup = backupOverride || state.backup;
  if (!store || !backup) return;
  const confirmed = window.confirm(
    "导入前建议先导出当前题库。浏览器存储不具备事务保证，恢复失败可能留下部分数据。继续？"
  );
  if (!confirmed) return;
  const result = await store.importData(backup);
  if (!result.ok) {
    const error = result.error || {};
    ui.backupStatus.textContent =
      `${error.code || "IMPORT_FAILED"}：${error.message || "导入失败"}` +
      (error.partial
        ? `；partial=${error.partial}，rollbackAttempted=${error.rollbackAttempted}，rollbackSucceeded=${error.rollbackSucceeded}`
        : "");
    return;
  }
  ui.backupStatus.textContent = "备份导入成功。";
  state.backup = null;
  ui.backupPreview.hidden = true;
  ui.importConfirmButton.hidden = true;
  await refreshLibrary({ silent: true });
  await refreshPending();
}

function bindLibraryEvents() {
  ui.libraryRefresh?.addEventListener("click", () => {
    refreshLibrary().catch((error) => showLibraryStatus(error.message, true));
  });
  ui.libraryRebuild?.addEventListener("click", async () => {
    const store = getQuestionStore();
    if (!store) return;
    const result = await store.rebuildIndexes();
    if (!result.ok) {
      showLibraryStatus(`${result.error.code}：${result.error.message}`, true);
      return;
    }
    showLibraryStatus("索引已重建。", false);
    await refreshLibrary({ silent: true });
  });
  ui.libraryCourse?.addEventListener("change", async () => {
    state.library.selectedCourseKey = ui.libraryCourse.value;
    state.library.selectedChapterKey = "";
    await loadChaptersForCourse(ui.libraryCourse.value);
  });
  ui.libraryChapter?.addEventListener("change", async () => {
    state.library.selectedChapterKey = ui.libraryChapter.value;
    await loadQuestionsForChapter(ui.libraryChapter.value);
  });
  ui.deleteChapterButton?.addEventListener("click", () => {
    deleteCurrentChapter().catch((error) =>
      showLibraryStatus(error.message, true)
    );
  });
  ui.pendingRefresh?.addEventListener("click", () => {
    refreshPending().catch((error) => {
      if (ui.pendingStatus) ui.pendingStatus.textContent = error.message;
    });
  });
  ui.pendingCourse?.addEventListener("change", () => {
    loadPendingChapters(ui.pendingCourse.value, {
      autoSelect: false
    }).catch(() => {});
  });
  ui.pendingChapter?.addEventListener("change", () => {
    updatePendingConfirmState();
  });
  ui.pendingCancel?.addEventListener("click", () => {
    ui.pendingConfirm.hidden = true;
    state.pending.selected = null;
  });
  ui.pendingConfirmButton?.addEventListener("click", () => {
    confirmPendingQuestion().catch((error) => {
      if (ui.pendingConfirmWarning) {
        ui.pendingConfirmWarning.hidden = false;
        ui.pendingConfirmWarning.textContent = error.message;
      }
    });
  });
  ui.exportButton?.addEventListener("click", () => {
    exportBackup().catch((error) => {
      if (ui.backupStatus) ui.backupStatus.textContent = error.message;
    });
  });
  ui.importFile?.addEventListener("change", () => {
    previewBackupFile(ui.importFile.files?.[0]).catch(() => {});
  });
  ui.importConfirmButton?.addEventListener("click", () => {
    confirmImportBackup().catch((error) => {
      if (ui.backupStatus) ui.backupStatus.textContent = error.message;
    });
  });
  ui.saveButton?.addEventListener("click", () => {
    handleSaveExtraction().catch((error) => {
      showSaveStatus(`保存失败：${error.message}`, "warn");
    });
  });
  ui.saveExtractFileButton?.addEventListener("click", () => {
    exportExtractionJson();
  });
  ui.saveUnverifiedButton?.addEventListener("click", () => {
    handleLenientSave().catch((error) => {
      showSaveStatus(`宽松保存失败：${error.message}`, "warn");
    });
  });
}

// ---------- 模拟练习 ----------

function getPracticeApi() {
  return globalThis.QuestionPractice || null;
}

function setPracticeStatus(text, warning) {
  if (!ui.practiceStatus) return;
  ui.practiceStatus.textContent = text || "";
  ui.practiceStatus.className = warning
    ? "library-status library-warning"
    : "library-status";
}

async function refreshPracticeSetup() {
  if (state.practice.session) return;
  const store = getQuestionStore();
  if (!store) {
    setPracticeStatus("本地题库存储不可用。", true);
    return;
  }
  const result = await store.getCourses();
  if (!result.ok) {
    setPracticeStatus(
      `${result.error.code}：${result.error.message}`,
      true
    );
    return;
  }
  state.practice.courses = result.courses || [];
  fillSelect(
    ui.practiceCourse,
    state.practice.courses,
    "courseKey",
    "courseName",
    "选择课程"
  );
  let courseKey = state.practice.selectedCourseKey;
  if (
    !state.practice.courses.some(
      (course) => course.courseKey === courseKey
    )
  ) {
    courseKey = state.practice.courses[0]?.courseKey || "";
  }
  state.practice.selectedCourseKey = courseKey;
  if (courseKey) setSelectValue(ui.practiceCourse, courseKey);
  await loadPracticeChapters(courseKey);
  updatePracticeStartState();
}

async function loadPracticeChapters(courseKey) {
  const store = getQuestionStore();
  state.practice.chapters = [];
  state.practice.selectedChapterKey = "";
  fillSelect(
    ui.practiceChapter,
    [],
    "chapterKey",
    "chapterName",
    "选择章节"
  );
  if (!courseKey) {
    updatePracticeStartState();
    return;
  }
  const result = await store.getChapters(courseKey);
  if (!result.ok) {
    setPracticeStatus(
      `${result.error.code}：${result.error.message}`,
      true
    );
    updatePracticeStartState();
    return;
  }
  state.practice.chapters = result.chapters || [];
  fillSelect(
    ui.practiceChapter,
    state.practice.chapters,
    "chapterKey",
    "chapterName",
    "选择章节"
  );
  const chapterKey = state.practice.chapters[0]?.chapterKey || "";
  state.practice.selectedChapterKey = chapterKey;
  if (chapterKey) setSelectValue(ui.practiceChapter, chapterKey);
  setPracticeStatus(
    state.practice.chapters.length
      ? `${state.practice.chapters.length} 个章节可练习。`
      : "当前课程没有可练习章节。",
    state.practice.chapters.length === 0
  );
  updatePracticeStartState();
}

function updatePracticeStartState() {
  if (ui.practiceStart) {
    ui.practiceStart.disabled = !ui.practiceChapter?.value;
  }
}

async function startPracticeSession() {
  const store = getQuestionStore();
  const practice = getPracticeApi();
  const chapterKey = ui.practiceChapter?.value;
  if (!store || !practice || !chapterKey) {
    setPracticeStatus("请选择有效章节后再开始。", true);
    return;
  }
  const result = await store.getQuestions(chapterKey);
  if (!result.ok) {
    setPracticeStatus(
      `${result.error.code}：${result.error.message}`,
      true
    );
    return;
  }
  if (!result.questions.length) {
    setPracticeStatus("当前章节没有已保存题目，无法练习。", true);
    return;
  }
  const session = practice.createSession(result.questions, {
    mode: ui.practiceMode?.value || "sequential"
  });
  state.practice.session = session;
  state.practice.index = 0;
  state.practice.answers = [];
  state.practice.selection = [];
  state.practice.submitted = false;
  state.practice.startedAt = Date.now();
  state.practice.selectedChapterKey = chapterKey;

  ui.practiceSetup.hidden = true;
  ui.practiceSummary.hidden = true;
  ui.practiceSession.hidden = false;
  renderPracticeQuestion();
}

function practiceCurrentQuestion() {
  const session = state.practice.session;
  return session ? session.questions[state.practice.index] : null;
}

function practiceSelectionFromInputs() {
  const inputs = ui.practiceQuestion
    ? Array.from(ui.practiceQuestion.querySelectorAll("input:checked"))
    : [];
  return inputs.map((input) => input.value).sort();
}

function renderPracticeQuestion() {
  const question = practiceCurrentQuestion();
  const session = state.practice.session;
  if (!question || !session) return;
  const practice = getPracticeApi();
  const index = state.practice.index;
  const answer = state.practice.answers[index];

  if (ui.practiceProgressText) {
    ui.practiceProgressText.textContent = `第 ${index + 1} / ${
      session.total
    } 题`;
  }
  if (ui.practiceProgressRemaining) {
    ui.practiceProgressRemaining.textContent = `剩余 ${
      session.total - index - 1
    } 题`;
  }

  ui.practiceQuestion.textContent = "";
  const stem = document.createElement("p");
  stem.className = "practice-question__stem";
  stem.textContent = question.stem || "（题干文字受保护或不可读）";
  const options = document.createElement("div");
  options.className = "practice-question__options";
  const inputType =
    question.type === "multiple_choice" ? "checkbox" : "radio";
  const answerSet = answer && answer.correctAnswer
    ? answer.correctAnswer.split("")
    : [];
  const selectedSet = state.practice.selection;

  (question.options || []).forEach((option) => {
    const label = document.createElement("label");
    label.className = "practice-option";
    const input = document.createElement("input");
    input.type = inputType;
    input.name = "practice-answer";
    input.value = String(option.label || "");
    input.checked = selectedSet.includes(input.value);
    input.disabled = state.practice.submitted;
    const text = document.createElement("span");
    text.textContent = `${option.label || ""}. ${
      option.text ||
      (option.textStatus === "ok" ? "" : "（文字不可读）")
    }`;
    if (answer && answer.correctAnswer) {
      if (answerSet.includes(input.value)) {
        label.classList.add("is-correct");
      } else if (
        selectedSet.includes(input.value) &&
        answer.result !== "correct"
      ) {
        label.classList.add("is-wrong");
      }
    }
    input.addEventListener("change", () => {
      state.practice.selection = practiceSelectionFromInputs();
      Array.from(options.children).forEach((item) => {
        const field = item.querySelector("input");
        item.classList.toggle(
          "is-selected",
          Boolean(field && field.checked)
        );
      });
    });
    label.append(input, text);
    if (input.checked) label.classList.add("is-selected");
    options.append(label);
  });

  ui.practiceQuestion.append(stem, options);
  if (ui.practiceSubmit) {
    ui.practiceSubmit.hidden = state.practice.submitted;
  }
  if (ui.practiceNext) {
    ui.practiceNext.hidden = !state.practice.submitted;
    ui.practiceNext.textContent =
      index + 1 >= session.total ? "查看总结" : "下一题";
  }

  if (answer) {
    renderPracticeFeedback(question, answer, practice);
  } else {
    ui.practiceFeedback.hidden = true;
    ui.practiceFeedback.textContent = "";
  }
}

function renderPracticeFeedback(question, answer, practice) {
  const correctValue = answer.correctAnswer
    ? practice.answerText(question, answer.correctAnswer)
    : "";
  const userText = practice.answerText(question, answer.userAnswer);
  let title = "";
  if (answer.result === "correct") {
    title = "回答正确。";
  } else if (answer.result === "incorrect") {
    title = "回答错误。";
  } else {
    title = "正确答案未公布，无法判定。";
  }
  const analysis =
    question.teacherAnalysis && question.teacherAnalysis.text
      ? question.teacherAnalysis.text
      : "暂无教师解析。";
  ui.practiceFeedback.hidden = false;
  ui.practiceFeedback.className =
    "practice-feedback " +
    (answer.result === "correct"
      ? "is-correct"
      : answer.result === "incorrect"
      ? "is-wrong"
      : "");
  ui.practiceFeedback.textContent =
    `${title} 你的答案：${userText || "未作答"}` +
    (correctValue ? `；正确答案：${correctValue}` : "") +
    `\n${analysis}`;
}

async function submitPracticeAnswer() {
  const question = practiceCurrentQuestion();
  const practice = getPracticeApi();
  if (!question || !practice || state.practice.submitted) return;
  const selection = practiceSelectionFromInputs();
  if (!selection.length) {
    ui.practiceFeedback.hidden = false;
    ui.practiceFeedback.className = "practice-feedback is-wrong";
    ui.practiceFeedback.textContent = "请先选择答案。";
    return;
  }
  const graded = practice.gradeAnswer(question, selection.join(""));
  state.practice.selection = selection;
  state.practice.answers[state.practice.index] = {
    ...graded,
    questionKey: question.questionKey,
    type: question.type,
    number: question.number
  };
  state.practice.submitted = true;
  renderPracticeQuestion();
}

function nextPracticeQuestion() {
  const session = state.practice.session;
  if (!session || !state.practice.submitted) return;
  if (state.practice.index + 1 >= session.total) {
    finishPracticeSession();
    return;
  }
  state.practice.index += 1;
  state.practice.selection = [];
  state.practice.submitted = false;
  renderPracticeQuestion();
}

function finishPracticeSession() {
  const session = state.practice.session;
  const practice = getPracticeApi();
  if (!session || !practice) return;
  const summary = practice.buildSummary(
    state.practice.answers,
    state.practice.startedAt,
    Date.now(),
    session.total
  );
  ui.practiceSession.hidden = true;
  ui.practiceSummary.hidden = false;
  ui.practiceSummaryText.textContent =
    `总题数：${summary.total}\n` +
    `已答题：${summary.answered}\n` +
    `正确：${summary.correct}\n` +
    `错误：${summary.incorrect}\n` +
    `答案未知：${summary.unknown}\n` +
    `正确率：${summary.accuracy}%\n` +
    `用时：${Math.max(1, Math.round(summary.elapsedMs / 1000))} 秒`;
  state.practice.session = null;
}

function exitPractice() {
  state.practice.session = null;
  state.practice.answers = [];
  state.practice.selection = [];
  state.practice.submitted = false;
  ui.practiceSession.hidden = true;
  ui.practiceSummary.hidden = true;
  ui.practiceSetup.hidden = false;
  updatePracticeStartState();
}

function bindPracticeEvents() {
  ui.practiceRefresh?.addEventListener("click", () => {
    refreshPracticeSetup().catch((error) =>
      setPracticeStatus(error.message, true)
    );
  });
  ui.practiceCourse?.addEventListener("change", () => {
    state.practice.selectedCourseKey = ui.practiceCourse.value;
    loadPracticeChapters(ui.practiceCourse.value).catch((error) =>
      setPracticeStatus(error.message, true)
    );
  });
  ui.practiceChapter?.addEventListener("change", () => {
    state.practice.selectedChapterKey = ui.practiceChapter.value;
    updatePracticeStartState();
  });
  ui.practiceStart?.addEventListener("click", () => {
    startPracticeSession().catch((error) =>
      setPracticeStatus(error.message, true)
    );
  });
  ui.practiceSubmit?.addEventListener("click", () => {
    submitPracticeAnswer().catch((error) =>
      setPracticeStatus(error.message, true)
    );
  });
  ui.practiceNext?.addEventListener("click", () => {
    nextPracticeQuestion();
  });
  ui.practiceQuit?.addEventListener("click", () => {
    exitPractice();
  });
  ui.practiceRestart?.addEventListener("click", () => {
    ui.practiceSummary.hidden = true;
    ui.practiceSetup.hidden = false;
    startPracticeSession().catch((error) =>
      setPracticeStatus(error.message, true)
    );
  });
  ui.practiceBack?.addEventListener("click", () => {
    exitPractice();
    activateTab("library");
  });
}

// ---------- 操作 ----------

async function handleRecognize() {
  if (state.busy) {
    return;
  }

  startRecognitionLoading();

  try {
    const analysis = await analyzeCurrentTab();
    renderResult(analysis.result, {
      url: analysis.rawUrl,
      title: analysis.pageTitle
    });
  } catch (error) {
    console.error("页面识别失败：", error);
    showError(toFriendlyError(error));
  } finally {
    setBusy(false);
  }
}

async function handleExtract() {
  if (state.busy) {
    return;
  }

  startExtractionLoading();

  try {
    const analysis = await analyzeCurrentTab();

    renderResult(analysis.result, {
      url: analysis.rawUrl,
      title: analysis.pageTitle
    });

    if (!analysis.result.isChaoxing) {
      showExtractError("当前页面不是学习通，不能提取题目。");
      return;
    }

    if (analysis.result.examLike) {
      showExtractError(
        "检测到考试页面。本扩展不会读取、提取或处理考试内容。"
      );
      return;
    }

    const frames = await collectQuestionFrames(analysis.tab.id);
    if (frames.length === 0) {
      showExtractError(
        "没有从页面读取到题目数据。请确认页面已加载完成，或刷新页面后重试。"
      );
      return;
    }

    analysis.frameTree = await collectFrameTree(analysis.tab.id);
    const data = mergeQuestionFrames(frames, analysis);
    const saveContext = await buildSaveContext(analysis);
    const savePlan = buildSaveExtractionPlan(data, saveContext);
    renderQuestions(data, analysis, savePlan, saveContext);
  } catch (error) {
    console.error("题目提取失败：", error);
    showExtractError(toFriendlyError(error).replace("识别失败", "读取失败"));
  } finally {
    setBusy(false);
  }
}

// ---------- 初始化 ----------

async function init() {
  cacheElements();

  setText("version", readVersion());
  setText("browser", detectBrowser());

  bindTabs();
  activateTab("recognize");

  if (ui.button) {
    ui.button.addEventListener("click", handleRecognize);
  } else {
    console.error("找不到识别按钮，弹窗可能未正确加载。");
  }

  if (ui.extractButton) {
    ui.extractButton.addEventListener("click", handleExtract);
  } else {
    console.error("找不到题目提取按钮，弹窗可能未正确加载。");
  }

  bindLibraryEvents();
  bindPracticeEvents();

  if (ui.openLibrary) {
    ui.openLibrary.addEventListener("click", (event) => {
      event.preventDefault();
      if (hasExtensionApi() && chrome.tabs?.create) {
        chrome.tabs.create({
          url: chrome.runtime.getURL("popup/library.html")
        });
      } else {
        window.open("library.html", "_blank");
      }
    });
  }

  setText("storage", await checkStorage());
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    console.error("弹窗初始化失败：", error);
  });
});
