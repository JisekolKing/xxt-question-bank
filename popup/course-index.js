"use strict";

/**
 * 学习通课程题库助手 · URL 课程索引
 *
 * 通过课程页/作业页正常 URL 中的 courseId、classId、cpi 建立跨标签页索引。
 *
 * 不读取：
 *   - enc 参数；
 *   - Token、Cookie、隐藏表单字段；
 *   - 隐藏接口。
 */

(function (root) {
  "use strict";

  const PREFIX = "courseIndex:";

  function normalizeId(value) {
    return String(value == null ? "" : value)
      .replace(/\s+/g, "")
      .trim();
  }

  function readUrlIdentifiers(rawUrl) {
    const result = {
      courseId: null,
      classId: null,
      cpi: null
    };

    try {
      const url = new URL(String(rawUrl || ""));
      for (const [key, value] of url.searchParams) {
        const normalizedKey = key.toLowerCase();
        const normalizedValue = normalizeId(value);
        if (!normalizedValue) {
          continue;
        }

        if (normalizedKey === "courseid" && !result.courseId) {
          result.courseId = normalizedValue;
        } else if (
          (normalizedKey === "classid" || normalizedKey === "clazzid") &&
          !result.classId
        ) {
          result.classId = normalizedValue;
        } else if (normalizedKey === "cpi" && !result.cpi) {
          result.cpi = normalizedValue;
        }
      }
    } catch (error) {
      return result;
    }

    return result;
  }

  function indexKey(identifiers) {
    const courseId = normalizeId(identifiers && identifiers.courseId);
    const classId = normalizeId(identifiers && identifiers.classId);
    if (!courseId || !classId) {
      return null;
    }
    const cpi = normalizeId(identifiers && identifiers.cpi);
    return (
      PREFIX +
      encodeURIComponent(courseId) +
      ":" +
      encodeURIComponent(classId) +
      ":" +
      encodeURIComponent(cpi)
    );
  }

  function makeRecord(courseName, identifiers, source, now) {
    return {
      courseName: String(courseName == null ? "" : courseName).trim(),
      courseId: normalizeId(identifiers && identifiers.courseId),
      classId: normalizeId(identifiers && identifiers.classId),
      cpi: normalizeId(identifiers && identifiers.cpi) || null,
      updatedAt: Number.isFinite(now) ? now : Date.now(),
      source: String(source || "courseHome")
    };
  }

  async function saveIndex(storage, result, rawUrl, now) {
    if (
      !storage ||
      !result ||
      result.pageType !== "courseHome" ||
      !String(result.courseName || "").trim()
    ) {
      return null;
    }

    const identifiers = readUrlIdentifiers(rawUrl);
    const key = indexKey(identifiers);
    if (!key) {
      return null;
    }

    const record = makeRecord(
      result.courseName,
      identifiers,
      result.courseNameSource || "courseHome",
      now
    );

    try {
      await storage.set({ [key]: record });
      return record;
    } catch (error) {
      console.warn("课程索引保存失败：", error);
      return null;
    }
  }

  async function findIndex(storage, rawUrl) {
    if (!storage) {
      return { status: "none", record: null };
    }

    const identifiers = readUrlIdentifiers(rawUrl);
    if (!identifiers.courseId || !identifiers.classId) {
      return { status: "none", record: null };
    }

    const key = indexKey(identifiers);
    if (!key) {
      return { status: "none", record: null };
    }

    let stored;
    try {
      stored = await storage.get(key);
    } catch (error) {
      console.warn("课程索引读取失败：", error);
      return { status: "none", record: null };
    }

    const record = stored && stored[key];
    if (!record) {
      return { status: "none", record: null };
    }

    // 再次校验，防止旧数据或错误数据造成错误关联。
    if (
      normalizeId(record.courseId) !== identifiers.courseId ||
      normalizeId(record.classId) !== identifiers.classId ||
      (normalizeId(record.cpi) || "") !== (identifiers.cpi || "") ||
      !String(record.courseName || "").trim()
    ) {
      return { status: "none", record: null };
    }

    return { status: "ok", record };
  }

  const api = {
    PREFIX,
    normalizeId,
    readUrlIdentifiers,
    indexKey,
    makeRecord,
    saveIndex,
    findIndex
  };

  root.CourseIndex = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
