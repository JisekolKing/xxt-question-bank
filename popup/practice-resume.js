"use strict";

/**
 * 模拟练习断点续练存储。
 *
 * 只保存当前练习会话的本地快照，不修改题库，不联网。
 * 使用独立 key，避免和题库存储互相影响。
 */

(function (root, factory) {
  const api = factory();
  root.PracticeResume = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA_VERSION = 1;
  const RESUME_KEY = "practice:v1:resume";
  const MAX_QUESTIONS = 5000;

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function normalizeScope(value) {
    return value === "course" || value === "selected"
      ? value
      : "chapter";
  }

  function normalizeSnapshot(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.schemaVersion !== SCHEMA_VERSION) return null;
    if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
      return null;
    }
    if (raw.questions.length > MAX_QUESTIONS) return null;
    if (!raw.questions.every((item) => item && typeof item === "object")) {
      return null;
    }
    const total = raw.questions.length;
    const index =
      Number.isInteger(raw.index) && raw.index >= 0 && raw.index < total
        ? raw.index
        : 0;
    return {
      schemaVersion: SCHEMA_VERSION,
      savedAt: Number.isFinite(raw.savedAt) ? raw.savedAt : 0,
      courseKey: raw.courseKey || null,
      courseName: raw.courseName || null,
      scope: normalizeScope(raw.scope),
      chapterKey: raw.chapterKey || null,
      chapterName: raw.chapterName || null,
      selectedChapterKeys: Array.isArray(raw.selectedChapterKeys)
        ? raw.selectedChapterKeys.filter((key) => typeof key === "string")
        : [],
      mode: raw.mode === "random" ? "random" : "sequential",
      chapterCount: Number.isFinite(raw.chapterCount)
        ? raw.chapterCount
        : 0,
      questions: clone(raw.questions),
      total,
      index,
      answers: Array.isArray(raw.answers) ? clone(raw.answers) : [],
      selection: Array.isArray(raw.selection)
        ? raw.selection.filter((key) => typeof key === "string")
        : [],
      submitted: Boolean(raw.submitted),
      startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : 0
    };
  }

  function createResumeStore(options) {
    const opts = options || {};
    const storage =
      opts.storage ||
      (typeof chrome !== "undefined" && chrome.storage
        ? chrome.storage.local
        : null);
    const now = typeof opts.now === "function" ? opts.now : Date.now;

    async function save(snapshot) {
      if (!storage) {
        return {
          ok: false,
          error: { code: "STORAGE_UNAVAILABLE", message: "本地存储不可用" }
        };
      }
      const normalized = normalizeSnapshot({
        ...snapshot,
        schemaVersion: SCHEMA_VERSION,
        savedAt: now()
      });
      if (!normalized) {
        return {
          ok: false,
          error: {
            code: "INVALID_RESUME",
            message: "练习断点数据无效"
          }
        };
      }
      try {
        await storage.set({ [RESUME_KEY]: normalized });
        return { ok: true, snapshot: normalized };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "RESUME_SAVE_FAILED",
            message: String((error && error.message) || error)
          }
        };
      }
    }

    async function load() {
      if (!storage) {
        return {
          ok: false,
          error: { code: "STORAGE_UNAVAILABLE", message: "本地存储不可用" }
        };
      }
      try {
        const result = await storage.get(RESUME_KEY);
        const raw = result && result[RESUME_KEY];
        const normalized = normalizeSnapshot(raw);
        if (!normalized) {
          return { ok: true, snapshot: null };
        }
        return { ok: true, snapshot: normalized };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "RESUME_LOAD_FAILED",
            message: String((error && error.message) || error)
          }
        };
      }
    }

    async function clear() {
      if (!storage) return { ok: false };
      try {
        await storage.remove(RESUME_KEY);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "RESUME_CLEAR_FAILED",
            message: String((error && error.message) || error)
          }
        };
      }
    }

    return { save, load, clear };
  }

  return {
    SCHEMA_VERSION,
    RESUME_KEY,
    normalizeSnapshot,
    createResumeStore
  };
});
