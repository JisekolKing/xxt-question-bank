"use strict";

/**
 * 学习通课程题库助手 · 课程上下文
 *
 * 只保存当前 tab 的课程页上下文：
 *   courseName / courseId / tabId / windowId / savedAt / expiresAt / source
 *
 * 规则：
 *   - 仅 courseHome 保存；
 *   - 仅 homework 读取；
 *   - 不同 tab、不同 window、过期、courseId 冲突都不复用；
 *   - 不读取 Cookie、Token、隐藏字段或隐藏接口；
 *   - 不写入 chrome.storage.local。
 */

(function (root) {
  "use strict";

  const TTL_MS = 2 * 60 * 60 * 1000;
  const KEY_PREFIX = "courseContext:";

  function normalize(value) {
    return String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
  }

  function storageKey(tabId) {
    return KEY_PREFIX + String(tabId);
  }

  function getCourseIdFromUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""));
      for (const [key, value] of url.searchParams) {
        if (/^courseid$/i.test(key)) {
          const id = normalize(value);
          if (id) {
            return id;
          }
        }
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  function findCourseIdInLinks(frames, courseName) {
    const target = normalize(courseName);
    if (!target) {
      return null;
    }

    const ids = new Set();
    (Array.isArray(frames) ? frames : []).forEach((frame) => {
      if (!frame || typeof frame !== "object") {
        return;
      }

      const links = Array.isArray(frame.courseLinks)
        ? frame.courseLinks
        : [];
      links.forEach((link) => {
        if (!link || normalize(link.text) !== target) {
          return;
        }
        const id = getCourseIdFromUrl(link.href);
        if (id) {
          ids.add(id);
        }
      });

      const candidates = Array.isArray(frame.courseCandidates)
        ? frame.courseCandidates
        : [];
      candidates.forEach((candidate) => {
        if (!candidate || normalize(candidate.text) !== target) {
          return;
        }
        const id = getCourseIdFromUrl(candidate.href);
        if (id) {
          ids.add(id);
        }
      });
    });

    // 同一课程名对应多个不同 courseId 时不做猜测。
    return ids.size === 1 ? Array.from(ids)[0] : null;
  }

  function makeRecord(input) {
    const now =
      input && Number.isFinite(input.now) ? input.now : Date.now();
    return {
      courseName: normalize(input && input.courseName),
      courseId: input && input.courseId ? String(input.courseId) : null,
      tabId: Number(input && input.tabId),
      windowId: Number(input && input.windowId),
      savedAt: now,
      expiresAt: now + TTL_MS,
      source: normalize(input && input.source) || "courseHome"
    };
  }

  /**
   * 返回：
   *   { status: "ok", courseName }
   *   { status: "remove" }  // 过期、tab/window 不匹配、courseId 冲突
   *   { status: "none" }    // 没有记录
   */
  function evaluateContext(record, expected) {
    const expectation = expected || {};
    if (!record || !normalize(record.courseName)) {
      return { status: "none", courseName: null };
    }

    const tabId = Number(expectation.tabId);
    const windowId = Number(expectation.windowId);
    if (
      !Number.isFinite(record.tabId) ||
      !Number.isFinite(record.windowId) ||
      record.tabId !== tabId ||
      record.windowId !== windowId
    ) {
      return { status: "remove", courseName: null };
    }

    const now = Number.isFinite(expectation.now)
      ? expectation.now
      : Date.now();
    if (!Number.isFinite(record.expiresAt) || now >= record.expiresAt) {
      return { status: "remove", courseName: null };
    }

    const recordId = record.courseId ? String(record.courseId) : null;
    const currentId = expectation.courseId
      ? String(expectation.courseId)
      : null;

    // courseId 必须对称：双方都有且一致，或双方都没有。
    // 只有一方有 ID 时无法验证，按不可信处理并清理。
    if (recordId || currentId) {
      if (!recordId || !currentId || recordId !== currentId) {
        return { status: "remove", courseName: null };
      }
    }

    return { status: "ok", courseName: normalize(record.courseName) };
  }

  async function saveContext(storage, tab, result, rawUrl, frames, now) {
    if (
      !storage ||
      !result ||
      result.pageType !== "courseHome" ||
      !normalize(result.courseName)
    ) {
      return null;
    }

    const tabId = Number(tab && tab.id);
    const windowId = Number(tab && tab.windowId);
    if (!Number.isFinite(tabId) || !Number.isFinite(windowId)) {
      return null;
    }

    const courseName = normalize(result.courseName);
    const courseId =
      getCourseIdFromUrl(rawUrl) ||
      findCourseIdInLinks(frames, courseName);

    const record = makeRecord({
      courseName,
      courseId,
      tabId,
      windowId,
      source: result.courseNameSource || "courseHome",
      now
    });

    try {
      await storage.set({ [storageKey(tabId)]: record });
      return record;
    } catch (error) {
      console.warn("课程上下文保存失败：", error);
      return null;
    }
  }

  async function loadContext(storage, tab, result, rawUrl, now) {
    if (
      !storage ||
      !result ||
      result.pageType !== "homework" ||
      normalize(result.courseName)
    ) {
      return { status: "none", courseName: null };
    }

    const tabId = Number(tab && tab.id);
    const windowId = Number(tab && tab.windowId);
    if (!Number.isFinite(tabId) || !Number.isFinite(windowId)) {
      return { status: "none", courseName: null };
    }

    const key = storageKey(tabId);
    let stored;
    try {
      stored = await storage.get(key);
    } catch (error) {
      console.warn("课程上下文读取失败：", error);
      return { status: "none", courseName: null };
    }

    const record = stored && stored[key];
    const evaluation = evaluateContext(record, {
      tabId,
      windowId,
      courseId: getCourseIdFromUrl(rawUrl),
      now
    });

    if (evaluation.status === "remove") {
      try {
        await storage.remove(key);
      } catch (error) {
        console.warn("课程上下文清理失败：", error);
      }
      return { status: "none", courseName: null };
    }

    return {
      status: evaluation.status,
      courseName: evaluation.courseName,
      record: evaluation.status === "ok" ? record : null
    };
  }

  const api = {
    TTL_MS,
    KEY_PREFIX,
    storageKey,
    normalize,
    getCourseIdFromUrl,
    findCourseIdInLinks,
    makeRecord,
    evaluateContext,
    saveContext,
    loadContext
  };

  root.CourseContext = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
