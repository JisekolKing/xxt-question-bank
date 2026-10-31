"use strict";

/**
 * 学习通课程题库助手 · 本地题库纯数据层
 *
 * 本模块只做：
 *   - courseKey / chapterKey / questionKey 生成；
 *   - canonical identity 保存与比较；
 *   - buildQuestion() 题目对象到题库对象的规范化；
 *   - 章节身份门禁；
 *   - 纯函数 upsert。
 *
 * 不读取 DOM，不调用 chrome.storage，不依赖 UI，不做练习记录。
 */

(function (root, factory) {
  const api = factory();
  root.QuestionBank = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA_VERSION = 1;

  function normalize(value) {
    return String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeId(value) {
    return String(value == null ? "" : value)
      .replace(/\s+/g, "")
      .trim();
  }

  function hashText(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36).padStart(7, "0");
  }

  function makeCourseKey(input) {
    const data = input || {};
    const courseId = normalizeId(data.courseId);
    const classId = normalizeId(data.classId);
    const cpi = normalizeId(data.cpi);
    if (!courseId || !classId) {
      return null;
    }
    return `c_${hashText(["course", courseId, classId, cpi].join("\u0001"))}`;
  }

  function makeChapterKey(input) {
    const data = input || {};
    const courseKey = normalizeId(data.courseKey);
    const chapterId = normalizeId(data.chapterId);
    const status = normalize(data.chapterIdStatus) || "missing";
    if (!courseKey || !chapterId || status !== "stable") {
      return null;
    }
    return `ch_${hashText(["chapter", courseKey, chapterId].join("\u0001"))}`;
  }

  function normalizeOption(option) {
    return {
      label: String(option && option.label != null ? option.label : ""),
      text: option && option.text != null ? String(option.text) : null,
      textStatus:
        option &&
        (option.textStatus === "ok" ||
          option.textStatus === "protected_text" ||
          option.textStatus === "unreadable")
          ? option.textStatus
          : "ok"
    };
  }

  function normalizeOptions(options) {
    return (Array.isArray(options) ? options : []).map(normalizeOption);
  }

  function makeQuestionKey(input) {
    const data = input || {};
    const chapterKey = normalizeId(data.chapterKey);
    if (!chapterKey) {
      return null;
    }
    const type =
      data.type === "multiple_choice"
        ? "multiple_choice"
        : data.type === "judgment"
        ? "judgment"
        : "single_choice";
    const options = normalizeOptions(data.options)
      .map(
        (option) =>
          normalize(option.label).toUpperCase() +
          "=" +
          normalize(option.text)
      )
      .join("\u0003");
    return `q_${hashText(
      ["question", chapterKey, type, normalize(data.stem), options].join(
        "\u0001"
      )
    )}`;
  }

  function pathnameOf(rawUrl) {
    if (!rawUrl) {
      return null;
    }
    try {
      return new URL(String(rawUrl)).pathname || null;
    } catch (error) {
      return null;
    }
  }

  function mediaPathOf(rawUrl) {
    if (!rawUrl) {
      return null;
    }
    try {
      const url = new URL(String(rawUrl));
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
      }
      return url.pathname || null;
    } catch (error) {
      return null;
    }
  }

  function sanitizeMedia(media) {
    return (Array.isArray(media) ? media : [])
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const safe = {};
        ["kind", "scope", "option", "alt", "text"].forEach((key) => {
          if (item[key] != null) {
            safe[key] = item[key];
          }
        });
        const path = mediaPathOf(item.src);
        if (path) {
          safe.path = path;
        }
        return safe;
      })
      .filter(Boolean);
  }

  function readContextValue(data, context, key) {
    if (context && context[key] != null) {
      return context[key];
    }
    return data[key];
  }

  function getIdentityQuality(question) {
    const options = normalizeOptions(question && question.options);
    const allOptionsReadable = options.every(
      (option) => option.textStatus === "ok"
    );
    const stemReadable =
      question &&
      (question.stemTextStatus === "ok" || question.stemTextStatus == null);
    if (
      question &&
      question.textStatus === "ok" &&
      stemReadable &&
      options.length >= 2 &&
      allOptionsReadable
    ) {
      return "complete";
    }
    return "partial";
  }

  function canonicalQuestion(data) {
    const type =
      data.type === "multiple_choice"
        ? "multiple_choice"
        : data.type === "judgment"
        ? "judgment"
        : "single_choice";
    return {
      type,
      stem: normalize(data.stem),
      options: normalizeOptions(data.options).map((option) => ({
        label: normalize(option.label).toUpperCase(),
        text: normalize(option.text)
      }))
    };
  }

  function canonicalIdentity(data, context) {
    return {
      course: {
        courseId: normalizeId(readContextValue(data, context, "courseId")),
        classId: normalizeId(readContextValue(data, context, "classId")),
        cpi: normalizeId(readContextValue(data, context, "cpi"))
      },
      chapter: {
        chapterId: normalizeId(readContextValue(data, context, "chapterId"))
      },
      question: canonicalQuestion(data)
    };
  }

  function deriveCanonicalFromRecord(question, chapter) {
    if (!question || !chapter) {
      return null;
    }
    const courseId = normalizeId(chapter.courseId);
    const classId = normalizeId(chapter.classId);
    const chapterId = normalizeId(chapter.chapterId);
    if (!courseId || !classId || !chapterId) {
      return null;
    }
    return {
      course: {
        courseId,
        classId,
        cpi: normalizeId(chapter.cpi)
      },
      chapter: { chapterId },
      question: canonicalQuestion(question)
    };
  }

  function canonicalSignature(identity) {
    if (!identity || typeof identity !== "object") {
      return null;
    }
    return JSON.stringify(identity);
  }

  function identityKeys(identity) {
    if (!identity || typeof identity !== "object") {
      return null;
    }
    const courseKey = makeCourseKey(identity.course);
    const chapterKey = makeChapterKey({
      courseKey,
      chapterId:
        identity.chapter && identity.chapter.chapterId,
      chapterIdStatus: "stable"
    });
    const question = identity.question || {};
    const questionKey = makeQuestionKey({
      chapterKey,
      type: question.type,
      stem: question.stem,
      options: question.options
    });
    return { courseKey, chapterKey, questionKey };
  }

  /**
   * 只根据题目自身字段判断目标，不使用全局 analysis。
   * @returns {{target:string, reason:string, courseKey:string|null,
   *   chapterKey:string|null, questionKey:string|null}}
   */
  function planImport(question, context) {
    const data = question || {};
    const contextData = context || {};
    const courseId = readContextValue(data, contextData, "courseId");
    const classId = readContextValue(data, contextData, "classId");
    const cpi = readContextValue(data, contextData, "cpi");
    const courseKey = makeCourseKey({ courseId, classId, cpi });

    if (!courseKey) {
      return {
        target: "rejected",
        reason: "missing_course_identity",
        courseKey: null,
        chapterKey: null,
        questionKey: null
      };
    }

    const chapterIdStatus =
      data.chapterIdStatus || contextData.chapterIdStatus || "missing";
    const chapterId = data.chapterId || contextData.chapterId || null;
    if (chapterIdStatus !== "stable" || !normalizeId(chapterId)) {
      return {
        target: "rejected",
        reason:
          chapterIdStatus === "ambiguous"
            ? "ambiguous_chapter_identity"
            : "missing_stable_chapter_identity",
        courseKey,
        chapterKey: null,
        questionKey: null
      };
    }

    const chapterKey = makeChapterKey({
      courseKey,
      chapterId,
      chapterIdStatus
    });
    if (!chapterKey) {
      return {
        target: "rejected",
        reason: "missing_stable_chapter_identity",
        courseKey,
        chapterKey: null,
        questionKey: null
      };
    }

    const questionKey = makeQuestionKey({
      chapterKey,
      type: data.type,
      stem: data.stem,
      options: data.options
    });
    if (!questionKey) {
      return {
        target: "rejected",
        reason: "missing_question_identity",
        courseKey,
        chapterKey,
        questionKey: null
      };
    }

    const linkStatus = data.chapterLinkStatus || "missing";
    if (linkStatus === "direct" || linkStatus === "descendant") {
      const fallbackIdentity = contextData.identityFallback === "name";
      return {
        target: "official",
        reason: fallbackIdentity
          ? "identity_fallback"
          : linkStatus === "descendant"
          ? "stable_frame_descendant"
          : "stable_direct",
        unverified: fallbackIdentity,
        courseKey,
        chapterKey,
        questionKey
      };
    }

    if (linkStatus === "cross_frame") {
      if (contextData.allowUnverified === true) {
        return {
          target: "official",
          reason: "cross_frame_unverified",
          unverified: true,
          courseKey,
          chapterKey,
          questionKey
        };
      }
      return {
        target: "pending",
        reason: "cross_frame_requires_confirmation",
        courseKey,
        chapterKey,
        questionKey
      };
    }

    return {
      target: "rejected",
      reason: "unconfirmed_chapter_link",
      courseKey,
      chapterKey,
      questionKey
    };
  }

  function buildCorrectAnswer(question, now) {
    const answer = question && question.answer;
    if (!answer || typeof answer !== "object") {
      return null;
    }
    const status =
      answer.correctStatus === "visible" ||
      answer.correctStatus === "not_visible" ||
      answer.correctStatus === "unknown"
        ? answer.correctStatus
        : "unknown";
    if (status !== "visible") {
      return null;
    }
    const value =
      typeof answer.correct === "string" && answer.correct.length > 0
        ? answer.correct
        : null;
    if (!value) {
      return null;
    }
    return {
      value,
      text:
        typeof answer.correctText === "string" ? answer.correctText : null,
      status,
      source: "page",
      updatedAt: now
    };
  }

  function buildImportObservation(question, now) {
    const answer = question && question.answer;
    if (!answer || typeof answer !== "object") {
      return null;
    }
    return {
      userAnswer:
        typeof answer.user === "string" && answer.user.length > 0
          ? answer.user
          : null,
      userText:
        typeof answer.userText === "string" ? answer.userText : null,
      result:
        answer.result === "correct" || answer.result === "incorrect"
          ? answer.result
          : "unknown",
      score:
        typeof answer.score === "number" && Number.isFinite(answer.score)
          ? answer.score
          : null,
      correctStatus:
        answer.correctStatus === "visible" ||
        answer.correctStatus === "not_visible" ||
        answer.correctStatus === "unknown"
          ? answer.correctStatus
          : "unknown",
      capturedAt: now,
      frameId: Number.isFinite(question.frameId) ? question.frameId : null,
      chapterFrameId: Number.isFinite(question.chapterFrameId)
        ? question.chapterFrameId
        : null,
      chapterFrameStatus: question.chapterFrameStatus || "missing",
      chapterLinkStatus: question.chapterLinkStatus || "missing",
      sourcePath: pathnameOf(question.sourceUrl),
      sourceTitle: question.sourceTitle || null
    };
  }

  /**
   * 规范化 buildQuestion() 的题目对象。target 为 rejected 时返回 null。
   * @returns {{plan:object, question:object|null}}
   */
  function toBankQuestion(question, context) {
    const data = question || {};
    const contextData = context || {};
    const plan = planImport(data, contextData);
    if (plan.target === "rejected") {
      return { plan, question: null };
    }

    const now =
      Number.isFinite(contextData.now) ? contextData.now : Date.now();
    const options = normalizeOptions(data.options);
    const identity = canonicalIdentity(data, contextData);
    const questionKey = plan.questionKey;
    const courseId = normalizeId(
      readContextValue(data, contextData, "courseId")
    );
    const classId = normalizeId(
      readContextValue(data, contextData, "classId")
    );
    const cpi = normalizeId(readContextValue(data, contextData, "cpi"));
    const chapterId =
      readContextValue(data, contextData, "chapterId") || null;
    const chapterIdSource =
      data.chapterIdSource || contextData.chapterIdSource || null;
    const chapterIdStatus =
      data.chapterIdStatus || contextData.chapterIdStatus || "missing";
    const courseName =
      normalize(
        readContextValue(data, contextData, "courseName") ||
          data.course ||
          ""
      ) || null;
    const chapterName =
      normalize(
        readContextValue(data, contextData, "chapterName") ||
          data.chapter ||
          ""
      ) || null;
    const parentChapterName =
      normalize(
        readContextValue(data, contextData, "parentChapterName") ||
          data.parentChapterName ||
          ""
      ) || null;

    return {
      plan,
      question: {
        schemaVersion: SCHEMA_VERSION,
        importTarget: plan.target,
        verification:
          plan.reason === "frame_unverified" ||
          plan.reason === "cross_frame_unverified"
            ? "frame_unverified"
            : plan.reason === "identity_fallback"
            ? "identity_unverified"
            : "verified",
        questionKey,
        courseKey: plan.courseKey,
        courseId,
        classId,
        cpi,
        courseName,

        chapterKey: plan.chapterKey,
        chapterId: chapterId,
        chapterIdSource: chapterIdSource,
        chapterIdStatus: chapterIdStatus,
        chapterName,
        parentChapterName,
        chapterFrameId: Number.isFinite(data.chapterFrameId)
          ? data.chapterFrameId
          : null,
        chapterFrameStatus: data.chapterFrameStatus || "missing",
        chapterLinkStatus: data.chapterLinkStatus || "missing",
        frameId: Number.isFinite(data.frameId) ? data.frameId : null,

        canonicalIdentity: identity,

        type:
          data.type === "multiple_choice"
            ? "multiple_choice"
            : data.type === "judgment"
            ? "judgment"
            : "single_choice",
        number: Number.isFinite(data.number) ? data.number : null,
        stem:
          data.textStatus === "ok" && typeof data.stem === "string"
            ? data.stem
            : null,
        stemTextStatus:
          data.stemTextStatus === "ok" ||
          data.stemTextStatus === "protected_text" ||
          data.stemTextStatus === "unreadable"
            ? data.stemTextStatus
            : data.textStatus === "ok"
            ? "ok"
            : "protected_text",
        options,
        optionCount: options.length,
        textStatus:
          data.textStatus === "ok" ||
          data.textStatus === "protected_text" ||
          data.textStatus === "mixed" ||
          data.textStatus === "unreadable"
            ? data.textStatus
            : "ok",
        textMessage: data.textMessage || "",
        identityQuality: getIdentityQuality(data),

        correctAnswer: buildCorrectAnswer(data, now),
        teacherAnalysis: null,
        analysisStatus: "not_supported",
        importObservation: buildImportObservation(data, now),

        media: sanitizeMedia(data.media),
        source: {
          path: pathnameOf(data.sourceUrl),
          title: data.sourceTitle || null,
          pageType: contextData.pageType || null,
          importedAt: now
        },

        createdAt: now,
        updatedAt: now,
        answerConflicts: {}
      },
      plan
    };
  }

  function mergeCorrectAnswer(existing, incoming, now, conflicts) {
    const current = existing && existing.correctAnswer;
    const next = incoming && incoming.correctAnswer;
    if (!next) {
      return current || null;
    }
    if (!current || !current.value) {
      return {
        ...next,
        updatedAt: now
      };
    }
    if (next.value && next.value !== current.value) {
      const previous = conflicts.correct;
      const history = previous
        ? previous.history || [previous]
        : [];
      const entry = {
        existing: current.value,
        incoming: next.value,
        lastSeenAt: now
      };
      conflicts.correct = {
        ...entry,
        history: [...history, entry]
      };
      return current;
    }
    if (current.status === "visible" && next.status !== "visible") {
      return current;
    }
    return {
      ...current,
      ...next,
      value: current.value,
      updatedAt: now
    };
  }

  function conflictHistory(value) {
    if (!value) {
      return [];
    }
    return Array.isArray(value.history) ? value.history : [value];
  }

  function mergeConflicts(existing, incoming) {
    const current = existing || {};
    const next = incoming || {};
    const merged = { ...next, ...current };
    Object.keys(next).forEach((key) => {
      if (!current[key]) {
        return;
      }
      merged[key] = {
        ...current[key],
        history: [
          ...conflictHistory(next[key]),
          ...conflictHistory(current[key])
        ]
      };
    });
    return merged;
  }

  function mergeTeacherAnalysis(existing, incoming) {
    const current = existing && existing.teacherAnalysis;
    const next = incoming && incoming.teacherAnalysis;
    if (!next) {
      return current || null;
    }
    if (!current) {
      return next;
    }
    return current;
  }

  function cloneCanonicalIdentity(identity) {
    if (!identity || typeof identity !== "object") {
      return null;
    }
    return {
      course: { ...(identity.course || {}) },
      chapter: { ...(identity.chapter || {}) },
      question: {
        ...(identity.question || {}),
        options: Array.isArray(identity.question && identity.question.options)
          ? identity.question.options.map((option) => ({ ...option }))
          : []
      }
    };
  }

  function cloneQuestion(question) {
    return {
      ...question,
      options: (question.options || []).map((option) => ({ ...option })),
      media: Array.isArray(question.media) ? question.media.slice() : [],
      correctAnswer: question.correctAnswer
        ? { ...question.correctAnswer }
        : null,
      importObservation: question.importObservation
        ? { ...question.importObservation }
        : null,
      teacherAnalysis: question.teacherAnalysis
        ? { ...question.teacherAnalysis }
        : null,
      canonicalIdentity: cloneCanonicalIdentity(question.canonicalIdentity),
      answerConflicts: { ...(question.answerConflicts || {}) }
    };
  }

  function isOfficialRecord(incoming) {
    if (
      !incoming ||
      incoming.importTarget !== "official" ||
      incoming.chapterIdStatus !== "stable" ||
      !(
        incoming.chapterLinkStatus === "direct" ||
        incoming.chapterLinkStatus === "descendant" ||
        (incoming.chapterLinkStatus === "cross_frame" &&
          incoming.verification === "frame_unverified")
      ) ||
      !normalizeId(incoming.chapterId) ||
      !incoming.chapterKey ||
      !incoming.questionKey ||
      !incoming.canonicalIdentity
    ) {
      return false;
    }
    const keys = identityKeys(incoming.canonicalIdentity);
    return Boolean(
      keys &&
        keys.courseKey === incoming.courseKey &&
        keys.chapterKey === incoming.chapterKey &&
        keys.questionKey === incoming.questionKey
    );
  }

  /**
   * 纯函数 upsert。不修改传入的 chapter 对象。
   * @returns {{chapter:object, action:string, question:object|null, reason:string|null}}
   */
  function upsertQuestion(chapter, incoming) {
    const base = chapter && typeof chapter === "object" ? chapter : {};
    const questions = {
      ...(base.questions && typeof base.questions === "object"
        ? base.questions
        : {})
    };
    const result = (nextQuestions, action, question, reason) => ({
      chapter: { ...base, questions: nextQuestions },
      action,
      question,
      reason
    });

    if (!incoming || incoming.importTarget !== "official") {
      return result(questions, "skip", null, "not_official_import");
    }
    if (!isOfficialRecord(incoming)) {
      return result(questions, "skip", null, "missing_official_identity");
    }
    if (!base.chapterKey || incoming.chapterKey !== base.chapterKey) {
      return result(questions, "skip", null, "chapter_key_mismatch");
    }

    const key = incoming.questionKey;
    const existing = questions[key];
    if (!existing) {
      const inserted = cloneQuestion(incoming);
      questions[key] = inserted;
      return result(questions, "insert", inserted, null);
    }

    const existingCanonical =
      deriveCanonicalFromRecord(existing, base) ||
      existing.canonicalIdentity;
    const existingSignature = canonicalSignature(existingCanonical);
    const incomingSignature = canonicalSignature(
      incoming.canonicalIdentity
    );
    if (
      !existingSignature ||
      !incomingSignature ||
      existingSignature !== incomingSignature
    ) {
      return result(
        questions,
        "collision",
        existing,
        "canonical_identity_mismatch"
      );
    }

    if (
      existing.identityQuality !== "complete" &&
      incoming.identityQuality !== "complete"
    ) {
      const now = incoming.updatedAt || Date.now();
      const conflicts = mergeConflicts(
        existing.answerConflicts,
        incoming.answerConflicts
      );
      const partial = cloneQuestion(existing);
      if (incoming.importObservation) {
        partial.importObservation = { ...incoming.importObservation };
      }
      partial.correctAnswer = mergeCorrectAnswer(
        existing,
        incoming,
        now,
        conflicts
      );
      partial.teacherAnalysis = mergeTeacherAnalysis(
        existing,
        incoming
      );
      partial.updatedAt = now;
      partial.answerConflicts = conflicts;
      questions[key] = partial;
      return result(
        questions,
        "update",
        partial,
        "partial_observation_updated"
      );
    }

    if (
      existing.identityQuality === "complete" &&
      incoming.identityQuality !== "complete"
    ) {
      return result(questions, "skip", existing, "incomplete_incoming");
    }

    const conflicts = mergeConflicts(
      existing.answerConflicts,
      incoming.answerConflicts
    );
    const now = incoming.updatedAt || Date.now();
    const merged = cloneQuestion(existing);

    if (
      incoming.identityQuality === "complete" ||
      existing.identityQuality !== "complete"
    ) {
      merged.stem = incoming.stem;
      merged.stemTextStatus = incoming.stemTextStatus;
      merged.options = (incoming.options || []).map((option) => ({
        ...option
      }));
      merged.optionCount = incoming.optionCount;
      merged.textStatus = incoming.textStatus;
      merged.textMessage = incoming.textMessage;
      merged.identityQuality = incoming.identityQuality;
      merged.media = Array.isArray(incoming.media)
        ? incoming.media.map((item) => ({ ...item }))
        : merged.media;
    }

    merged.correctAnswer = mergeCorrectAnswer(
      existing,
      incoming,
      now,
      conflicts
    );
    merged.teacherAnalysis = mergeTeacherAnalysis(existing, incoming);
    if (incoming.importObservation) {
      merged.importObservation = { ...incoming.importObservation };
    }
    merged.canonicalIdentity = cloneCanonicalIdentity(
      incoming.canonicalIdentity
    );
    merged.updatedAt = now;
    merged.createdAt = existing.createdAt || incoming.createdAt || now;
    merged.answerConflicts = conflicts;

    questions[key] = merged;
    return result(questions, "update", merged, null);
  }

  const api = {
    SCHEMA_VERSION,
    normalize,
    normalizeId,
    makeCourseKey,
    makeChapterKey,
    makeQuestionKey,
    canonicalIdentity,
    canonicalSignature,
    planImport,
    toBankQuestion,
    getIdentityQuality,
    sanitizeMedia,
    upsertQuestion
  };
  return api;
});
