"use strict";

/**
 * 学习通课程题库助手 · 本地题库存储层
 *
 * 使用 chrome.storage.local，按课程/章节分片保存正式题库；
 * pending 独立分片；索引可从实际分片重建。
 *
 * 不接 UI，不做练习记录。
 */

(function (root, factory) {
  const Bank =
    root.QuestionBank ||
    (typeof require === "function" ? require("./question-bank.js") : null);
  const api = factory(root, Bank);
  root.QuestionBankStorage = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  root,
  Bank
) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const PREFIX = "questionBank:v1:";
  const INDEX_KEY = `${PREFIX}index`;
  const CHAPTER_PREFIX = `${PREFIX}chapter:`;
  const PENDING_PREFIX = `${PREFIX}pending:`;

  function normalizeId(value) {
    return String(value == null ? "" : value)
      .replace(/\s+/g, "")
      .trim();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function chapterStorageKey(courseKey, chapterKey) {
    return `${CHAPTER_PREFIX}${courseKey}:${chapterKey}`;
  }

  function pendingStorageKey(courseKey, chapterKey) {
    return `${PENDING_PREFIX}${courseKey}:${chapterKey}`;
  }

  function isStorageKey(key, prefix) {
    return typeof key === "string" && key.startsWith(prefix);
  }

  function makeError(code, message, extra) {
    return {
      ok: false,
      error: {
        code,
        message: String(message || code),
        ...(extra || {})
      }
    };
  }

  function isQuotaError(error) {
    const text = String((error && error.message) || error || "");
    return /quota|QUOTA_BYTES|storage.*full|exceeded/i.test(text);
  }

  function storageError(operation, error) {
    const code = isQuotaError(error)
      ? "STORAGE_QUOTA_EXCEEDED"
      : "STORAGE_WRITE_FAILED";
    return makeError(code, `${operation}失败：${String(
      (error && error.message) || error
    )}`, { operation });
  }

  function readError(operation, error) {
    return makeError("STORAGE_READ_FAILED", `${operation}失败：${String(
      (error && error.message) || error
    )}`, { operation });
  }

  function getDefaultStorage() {
    return root.chrome &&
      root.chrome.storage &&
      root.chrome.storage.local
      ? root.chrome.storage.local
      : null;
  }

  function createStorage(options) {
    const opts = options || {};
    const storage = opts.storage || getDefaultStorage();
    const locks = Object.prototype.hasOwnProperty.call(opts, "locks")
      ? opts.locks
      : (root.navigator && root.navigator.locks) || null;
    const lockName = opts.lockName || "questionBank:v1:write";
    const now =
      typeof opts.now === "function"
        ? opts.now
        : () => (Number.isFinite(opts.now) ? opts.now : Date.now());
    let writeQueue = Promise.resolve();

    function getConcurrencyInfo() {
      const webLocks = Boolean(
        locks && typeof locks.request === "function"
      );
      return {
        mode: webLocks ? "web-locks" : "local",
        crossInstanceSafe: webLocks,
        lockName: webLocks ? lockName : null,
        warning: webLocks
          ? null
          : "navigator.locks 不可用，仅保证当前实例内写入串行"
      };
    }

    function withWriteLock(operation) {
      const run = writeQueue.then(
        async () => {
          if (locks && typeof locks.request === "function") {
            try {
              return await locks.request(
                lockName,
                { mode: "exclusive" },
                operation
              );
            } catch (error) {
              return makeError(
                "LOCK_FAILED",
                `获取写入锁失败：${String(
                  (error && error.message) || error
                )}`
              );
            }
          }
          return operation();
        },
        async () => {
          if (locks && typeof locks.request === "function") {
            try {
              return await locks.request(
                lockName,
                { mode: "exclusive" },
                operation
              );
            } catch (error) {
              return makeError(
                "LOCK_FAILED",
                `获取写入锁失败：${String(
                  (error && error.message) || error
                )}`
              );
            }
          }
          return operation();
        }
      );
      writeQueue = run.catch(() => {});
      return run;
    }

    function enqueue(operation) {
      return withWriteLock(operation);
    }

    async function getAll() {
      try {
        return (await storage.get(null)) || {};
      } catch (error) {
        throw readError("读取全部存储", error);
      }
    }

    async function getKey(key) {
      try {
        const result = await storage.get(key);
        return result && result[key];
      } catch (error) {
        throw readError("读取存储", error);
      }
    }

    async function setEntries(entries) {
      try {
        await storage.set(entries);
      } catch (error) {
        throw storageError("写入存储", error);
      }
    }

    async function removeKeys(keys) {
      try {
        await storage.remove(keys);
      } catch (error) {
        throw storageError("删除存储", error);
      }
    }

    function ensureStorage() {
      if (!storage) {
        return makeError(
          "STORAGE_UNAVAILABLE",
          "当前环境没有 chrome.storage.local"
        );
      }
      return null;
    }

    function parseIndex(all) {
      const value = all && all[INDEX_KEY];
      if (!value || typeof value !== "object") {
        return null;
      }
      if (value.schemaVersion !== SCHEMA_VERSION || !value.courses) {
        return null;
      }
      return value;
    }

    function buildIndexFromAll(all) {
      const courses = {};
      let pendingCount = 0;
      Object.keys(all || {}).forEach((key) => {
        if (isStorageKey(key, CHAPTER_PREFIX)) {
          const chapter = all[key];
          if (
            !chapter ||
            typeof chapter !== "object" ||
            !chapter.courseKey ||
            !chapter.chapterKey
          ) {
            return;
          }
          const course =
            courses[chapter.courseKey] ||
            (courses[chapter.courseKey] = {
              courseKey: chapter.courseKey,
              courseId: chapter.courseId || null,
              classId: chapter.classId || null,
              cpi: chapter.cpi || null,
              courseName: chapter.courseName || null,
              updatedAt: chapter.updatedAt || 0,
              chapters: {}
            });
          course.updatedAt = Math.max(
            course.updatedAt || 0,
            chapter.updatedAt || 0
          );
          course.chapters[chapter.chapterKey] = {
            chapterKey: chapter.chapterKey,
            chapterId: chapter.chapterId || null,
            chapterIdSource: chapter.chapterIdSource || null,
            chapterIdStatus: chapter.chapterIdStatus || "missing",
            chapterName: chapter.chapterName || null,
            parentChapterName: chapter.parentChapterName || null,
            questionCount: Object.keys(chapter.questions || {}).length,
            updatedAt: chapter.updatedAt || 0
          };
        } else if (isStorageKey(key, PENDING_PREFIX)) {
          const pending = all[key];
          if (pending && typeof pending === "object") {
            pendingCount += Object.keys(pending.questions || {}).length;
          }
        }
      });
      return {
        schemaVersion: SCHEMA_VERSION,
        updatedAt: now(),
        courses,
        pendingCount
      };
    }

    async function refreshIndexFromAll() {
      const all = await getAll();
      const index = buildIndexFromAll(all);
      await setEntries({ [INDEX_KEY]: index });
      return index;
    }

    async function readIndex() {
      const all = await getAll();
      return parseIndex(all);
    }

    async function findChapterStorage(all, chapterKey) {
      const index = parseIndex(all);
      if (index) {
        const courses = Object.values(index.courses || {});
        for (const course of courses) {
          if (
            course.chapters &&
            course.chapters[chapterKey]
          ) {
            return chapterStorageKey(
              course.courseKey,
              chapterKey
            );
          }
        }
      }
      return Object.keys(all || {}).find((key) => {
        if (!isStorageKey(key, CHAPTER_PREFIX)) {
          return false;
        }
        const chapter = all[key];
        return Boolean(chapter && chapter.chapterKey === chapterKey);
      }) || null;
    }

    async function findPendingStorage(all, chapterKey) {
      return Object.keys(all || {}).find((key) => {
        if (!isStorageKey(key, PENDING_PREFIX)) {
          return false;
        }
        const pending = all[key];
        return Boolean(pending && pending.chapterKey === chapterKey);
      }) || null;
    }

    function chapterMetadata(question) {
      return {
        schemaVersion: SCHEMA_VERSION,
        kind: "official",
        courseKey: question.courseKey,
        courseId: question.courseId || null,
        classId: question.classId || null,
        cpi: question.cpi || null,
        courseName: question.courseName || null,
        chapterKey: question.chapterKey,
        chapterId: question.chapterId || null,
        chapterIdSource: question.chapterIdSource || null,
        chapterIdStatus: question.chapterIdStatus || "missing",
        chapterName: question.chapterName || null,
        parentChapterName: question.parentChapterName || null
      };
    }

    function pendingMetadata(question) {
      return {
        schemaVersion: SCHEMA_VERSION,
        kind: "pending",
        courseKey: question.courseKey,
        courseId: question.courseId || null,
        classId: question.classId || null,
        cpi: question.cpi || null,
        courseName: question.courseName || null,
        chapterKey: question.chapterKey,
        chapterId: question.chapterId || null,
        chapterIdSource: question.chapterIdSource || null,
        chapterIdStatus: question.chapterIdStatus || "missing",
        chapterName: question.chapterName || null,
        parentChapterName: question.parentChapterName || null
      };
    }

    function sameIdentity(a, b) {
      return (
        Bank.canonicalSignature(a) &&
        Bank.canonicalSignature(a) === Bank.canonicalSignature(b)
      );
    }

    function mergePending(chapter, incoming) {
      const questions = {
        ...((chapter && chapter.questions) || {})
      };
      if (!incoming || incoming.importTarget !== "pending") {
        return {
          questions,
          action: "skip",
          reason: "not_pending_import"
        };
      }
      if (!incoming.questionKey || !incoming.canonicalIdentity) {
        return {
          questions,
          action: "skip",
          reason: "missing_pending_identity"
        };
      }
      const existing = questions[incoming.questionKey];
      if (!existing) {
        questions[incoming.questionKey] = clone(incoming);
        return {
          questions,
          action: "insert",
          reason: null
        };
      }
      if (!sameIdentity(existing.canonicalIdentity, incoming.canonicalIdentity)) {
        return {
          questions,
          action: "collision",
          reason: "canonical_identity_mismatch"
        };
      }
      if (
        existing.identityQuality !== "complete" &&
        incoming.identityQuality !== "complete"
      ) {
        return {
          questions,
          action: "skip",
          reason: "ambiguous_partial_identity"
        };
      }
      if (
        existing.identityQuality === "complete" &&
        incoming.identityQuality !== "complete"
      ) {
        return {
          questions,
          action: "skip",
          reason: "incomplete_incoming"
        };
      }
      const merged = {
        ...existing,
        ...clone(incoming),
        createdAt: existing.createdAt || incoming.createdAt,
        answerConflicts: {
          ...(incoming.answerConflicts || {}),
          ...(existing.answerConflicts || {})
        }
      };
      questions[incoming.questionKey] = merged;
      return { questions, action: "update", reason: null };
    }

    async function saveOfficialQuestion(question, context) {
      const storageErrorResult = ensureStorage();
      if (storageErrorResult) return storageErrorResult;

      return enqueue(async () => {
        const converted = Bank.toBankQuestion(question, context);
        if (converted.plan.target !== "official" || !converted.question) {
          return makeError(
            "NOT_OFFICIAL",
            "题目未通过正式章节身份校验",
            { reason: converted.plan.reason }
          );
        }
        const incoming = converted.question;
        const key = chapterStorageKey(
          incoming.courseKey,
          incoming.chapterKey
        );
        let existing;
        try {
          existing = await getKey(key);
        } catch (error) {
          return error;
        }
        if (existing && existing.chapterKey !== incoming.chapterKey) {
          return makeError(
            "CHAPTER_MISMATCH",
            "目标章节分片与题目 chapterKey 不一致"
          );
        }

        const base = existing || {
          ...chapterMetadata(incoming),
          questions: {},
          createdAt: now(),
          updatedAt: now()
        };
        const result = Bank.upsertQuestion(base, incoming);
        if (result.action !== "insert" && result.action !== "update") {
          return makeError(
            result.action === "collision"
              ? "IDENTITY_COLLISION"
              : "IDENTITY_REJECTED",
            result.reason || "题目未通过 upsert",
            { reason: result.reason }
          );
        }

        const chapter = {
          ...base,
          ...chapterMetadata(incoming),
          questions: result.chapter.questions,
          updatedAt: now()
        };
        try {
          await setEntries({ [key]: chapter });
        } catch (error) {
          return error;
        }

        let index;
        try {
          index = await refreshIndexFromAll();
        } catch (error) {
          return makeError(
            "INDEX_WRITE_FAILED",
            "题目已写入，但索引更新失败",
            { dataSaved: true, questionKey: incoming.questionKey }
          );
        }

        return {
          ok: true,
          action: result.action,
          question: result.question,
          questionKey: incoming.questionKey,
          courseKey: incoming.courseKey,
          chapterKey: incoming.chapterKey,
          indexUpdated: true,
          index
        };
      });
    }

    async function saveUnverifiedQuestion(question, context) {
      return saveOfficialQuestion(question, {
        ...(context || {}),
        allowUnverified: true
      });
    }

    async function savePendingQuestion(question, context) {
      const storageErrorResult = ensureStorage();
      if (storageErrorResult) return storageErrorResult;

      return enqueue(async () => {
        const converted = Bank.toBankQuestion(question, context);
        if (converted.plan.target !== "pending" || !converted.question) {
          return makeError(
            "NOT_PENDING",
            "题目不是待确认状态",
            { reason: converted.plan.reason }
          );
        }
        const incoming = converted.question;
        const key = pendingStorageKey(
          incoming.courseKey,
          incoming.chapterKey
        );
        let existing;
        try {
          existing = await getKey(key);
        } catch (error) {
          return error;
        }
        const base = existing || {
          ...pendingMetadata(incoming),
          questions: {},
          createdAt: now(),
          updatedAt: now()
        };
        const merged = mergePending(base, incoming);
        if (merged.action !== "insert" && merged.action !== "update") {
          return makeError(
            merged.action === "collision"
              ? "IDENTITY_COLLISION"
              : "IDENTITY_REJECTED",
            merged.reason || "待确认题目未通过 upsert",
            { reason: merged.reason }
          );
        }
        const pending = {
          ...base,
          ...pendingMetadata(incoming),
          questions: merged.questions,
          updatedAt: now()
        };
        try {
          await setEntries({ [key]: pending });
        } catch (error) {
          return error;
        }
        try {
          await refreshIndexFromAll();
        } catch (error) {
          return makeError(
            "INDEX_WRITE_FAILED",
            "待确认题目已写入，但索引更新失败",
            { dataSaved: true, questionKey: incoming.questionKey }
          );
        }
        return {
          ok: true,
          action: merged.action,
          question: merged.questions[incoming.questionKey],
          questionKey: incoming.questionKey,
          courseKey: incoming.courseKey,
          chapterKey: incoming.chapterKey,
          indexUpdated: true
        };
      });
    }

    async function ensureIndexForRead() {
      try {
        const all = await getAll();
        const existing = parseIndex(all);
        if (existing) {
          return { ok: true, index: existing, recovered: false };
        }
        const result = await withWriteLock(async () => {
          try {
            const index = await refreshIndexFromAll();
            return { ok: true, index };
          } catch (error) {
            return error;
          }
        });
        if (!result || result.ok === false) {
          return result || makeError("INDEX_REBUILD_FAILED", "索引重建失败");
        }
        return {
          ok: true,
          index: result.index,
          recovered: true
        };
      } catch (error) {
        return error;
      }
    }

    async function getCourses() {
      const storageErrorResult = ensureStorage();
      if (storageErrorResult) return storageErrorResult;
      const indexResult = await ensureIndexForRead();
      if (!indexResult.ok) return indexResult;
      const index = indexResult.index;
      return {
        ok: true,
        indexRecovered: indexResult.recovered,
        courses: Object.values(index.courses).map((course) => ({
          courseKey: course.courseKey,
          courseId: course.courseId || null,
          classId: course.classId || null,
          cpi: course.cpi || null,
          courseName: course.courseName || null,
          updatedAt: course.updatedAt || 0,
          chapterCount: Object.keys(course.chapters || {}).length
        }))
      };
    }

    async function getChapters(courseKey) {
      const storageErrorResult = ensureStorage();
      if (storageErrorResult) return storageErrorResult;
      const indexResult = await ensureIndexForRead();
      if (!indexResult.ok) return indexResult;
      const index = indexResult.index;
      const course = index.courses[courseKey];
      if (!course) {
        return {
          ok: true,
          indexRecovered: indexResult.recovered,
          chapters: []
        };
      }
      return {
        ok: true,
        indexRecovered: indexResult.recovered,
        chapters: Object.values(course.chapters || {})
      };
    }

    async function findChapterByKey(chapterKey) {
      const all = await getAll();
      const key = await findChapterStorage(all, chapterKey);
      return { all, key };
    }

    async function getQuestions(chapterKey) {
      const storageErrorResult = ensureStorage();
      if (storageErrorResult) return storageErrorResult;
      try {
        const { all, key } = await findChapterByKey(chapterKey);
        if (!key) {
          return { ok: true, questions: [] };
        }
        const chapter = all[key];
        return {
          ok: true,
          questions: Object.values((chapter && chapter.questions) || {})
        };
      } catch (error) {
        return error;
      }
    }

    async function getPendingQuestions() {
      const storageErrorResult = ensureStorage();
      if (storageErrorResult) return storageErrorResult;
      try {
        const all = await getAll();
        const questions = [];
        Object.keys(all).forEach((key) => {
          if (!isStorageKey(key, PENDING_PREFIX)) {
            return;
          }
          const pending = all[key];
          if (pending && pending.questions) {
            Object.values(pending.questions).forEach((question) => {
              questions.push(question);
            });
          }
        });
        return { ok: true, questions };
      } catch (error) {
        return error;
      }
    }

    async function getQuestion(questionKey, chapterKey) {
      const storageErrorResult = ensureStorage();
      if (storageErrorResult) return storageErrorResult;
      try {
        const all = await getAll();
        const matches = [];
        for (const key of Object.keys(all)) {
          if (!isStorageKey(key, CHAPTER_PREFIX)) {
            continue;
          }
          const chapter = all[key];
          if (
            chapter &&
            chapter.questions &&
            chapter.questions[questionKey] &&
            (!chapterKey || chapter.chapterKey === chapterKey)
          ) {
            matches.push({
              question: chapter.questions[questionKey],
              chapterKey: chapter.chapterKey,
              courseKey: chapter.courseKey,
              source: "official"
            });
          }
        }
        for (const key of Object.keys(all)) {
          if (!isStorageKey(key, PENDING_PREFIX)) {
            continue;
          }
          const pending = all[key];
          if (
            pending &&
            pending.questions &&
            pending.questions[questionKey] &&
            (!chapterKey || pending.chapterKey === chapterKey)
          ) {
            matches.push({
              question: pending.questions[questionKey],
              chapterKey: pending.chapterKey,
              courseKey: pending.courseKey,
              source: "pending"
            });
          }
        }
        if (matches.length === 0) {
          return makeError("NOT_FOUND", "题目不存在");
        }
        if (matches.length > 1) {
          return makeError(
            "AMBIGUOUS_QUESTION_KEY",
            "该 questionKey 对应多个章节或存储位置，请传入 chapterKey",
            {
              matches: matches.map((match) => ({
                chapterKey: match.chapterKey,
                courseKey: match.courseKey,
                source: match.source
              }))
            }
          );
        }
        return { ok: true, ...matches[0] };
      } catch (error) {
        return error;
      }
    }

    async function deleteQuestion(questionKey, chapterKey) {
      const storageErrorResult = ensureStorage();
      if (storageErrorResult) return storageErrorResult;
      return enqueue(async () => {
        try {
          const all = await getAll();
          let key = null;
          if (chapterKey) {
            key = await findChapterStorage(all, chapterKey);
          } else {
            key =
              Object.keys(all).find((candidate) => {
                if (!isStorageKey(candidate, CHAPTER_PREFIX)) {
                  return false;
                }
                const chapter = all[candidate];
                return Boolean(
                  chapter &&
                    chapter.questions &&
                    chapter.questions[questionKey]
                );
              }) || null;
          }
          if (!key) {
            return makeError("NOT_FOUND", "题目或章节不存在");
          }
          const chapter = all[key];
          if (!chapter.questions || !chapter.questions[questionKey]) {
            return makeError("NOT_FOUND", "题目不存在");
          }
          const questions = { ...chapter.questions };
          delete questions[questionKey];
          const updated = {
            ...chapter,
            questions,
            updatedAt: now()
          };
          await setEntries({ [key]: updated });
          try {
            await refreshIndexFromAll();
          } catch (error) {
            return makeError(
              "INDEX_WRITE_FAILED",
              "题目已删除，但索引更新失败",
              { dataSaved: true }
            );
          }
          return {
            ok: true,
            deleted: true,
            questionKey,
            chapterKey: chapter.chapterKey,
            indexUpdated: true
          };
        } catch (error) {
          return error;
        }
      });
    }

    async function deletePendingQuestion(questionKey, chapterKey) {
      const storageErrorResult = ensureStorage();
      if (storageErrorResult) return storageErrorResult;
      return enqueue(async () => {
        try {
          const all = await getAll();
          const key = await findPendingStorage(all, chapterKey);
          if (!key) {
            return makeError("NOT_FOUND", "待确认章节不存在");
          }
          const pending = all[key];
          if (!pending.questions || !pending.questions[questionKey]) {
            return makeError("NOT_FOUND", "待确认题目不存在");
          }
          const questions = { ...pending.questions };
          delete questions[questionKey];
          const updated = {
            ...pending,
            questions,
            updatedAt: now()
          };
          await setEntries({ [key]: updated });
          try {
            await refreshIndexFromAll();
          } catch (error) {
            return makeError(
              "INDEX_WRITE_FAILED",
              "待确认题目已删除，但索引更新失败",
              { dataSaved: true }
            );
          }
          return {
            ok: true,
            deleted: true,
            questionKey,
            chapterKey,
            source: "pending"
          };
        } catch (error) {
          return error;
        }
      });
    }

    async function deleteChapter(chapterKey, options) {
      const storageErrorResult = ensureStorage();
      if (storageErrorResult) return storageErrorResult;
      const includePending = !options || options.includePending !== false;
      return enqueue(async () => {
        try {
          const all = await getAll();
          const chapterKeyToRemove = await findChapterStorage(
            all,
            chapterKey
          );
          const pendingKeyToRemove = includePending
            ? await findPendingStorage(all, chapterKey)
            : null;
          if (!chapterKeyToRemove && !pendingKeyToRemove) {
            return makeError("NOT_FOUND", "章节不存在");
          }
          const remove = [];
          if (chapterKeyToRemove) remove.push(chapterKeyToRemove);
          if (pendingKeyToRemove) remove.push(pendingKeyToRemove);
          await removeKeys(remove);
          try {
            await refreshIndexFromAll();
          } catch (error) {
            return makeError(
              "INDEX_WRITE_FAILED",
              "章节已删除，但索引更新失败",
              { dataSaved: true }
            );
          }
          return {
            ok: true,
            deleted: true,
            chapterKey,
            removedOfficial: Boolean(chapterKeyToRemove),
            removedPending: Boolean(pendingKeyToRemove),
            pendingRetained: includePending ? false : Boolean(
              await findPendingStorage(all, chapterKey)
            ),
            indexUpdated: true
          };
        } catch (error) {
          return error;
        }
      });
    }

    async function rebuildIndexes() {
      const storageErrorResult = ensureStorage();
      if (storageErrorResult) return storageErrorResult;
      return enqueue(async () => {
        try {
          const index = await refreshIndexFromAll();
          return { ok: true, index };
        } catch (error) {
          return error;
        }
      });
    }

    async function getStorageStats() {
      const storageErrorResult = ensureStorage();
      if (storageErrorResult) return storageErrorResult;
      try {
        const all = await getAll();
        let courseCount = 0;
        let chapterCount = 0;
        let questionCount = 0;
        let pendingCount = 0;
        let bytes = 0;
        Object.keys(all).forEach((key) => {
          if (!key.startsWith(PREFIX)) return;
          const value = all[key];
          bytes += JSON.stringify(value).length;
          if (isStorageKey(key, CHAPTER_PREFIX)) {
            chapterCount += 1;
            questionCount += Object.keys(
              (value && value.questions) || {}
            ).length;
          } else if (isStorageKey(key, PENDING_PREFIX)) {
            pendingCount += Object.keys(
              (value && value.questions) || {}
            ).length;
          }
        });
        const index = parseIndex(all);
        if (index) {
          courseCount = Object.keys(index.courses || {}).length;
        }
        return {
          ok: true,
          stats: {
            schemaVersion: SCHEMA_VERSION,
            courseCount,
            chapterCount,
            questionCount,
            pendingCount,
            storageKeys: Object.keys(all).filter((key) =>
              key.startsWith(PREFIX)
            ).length,
            approximateBytes: bytes
          }
        };
      } catch (error) {
        return error;
      }
    }

    async function exportData() {
      const storageErrorResult = ensureStorage();
      if (storageErrorResult) return storageErrorResult;
      return withWriteLock(async () => {
        try {
          const all = await getAll();
          const official = [];
          const pending = [];
          Object.keys(all).forEach((key) => {
            if (isStorageKey(key, CHAPTER_PREFIX)) {
              official.push(clone(all[key]));
            } else if (isStorageKey(key, PENDING_PREFIX)) {
              pending.push(clone(all[key]));
            }
          });
          return {
            ok: true,
            backup: {
              schemaVersion: SCHEMA_VERSION,
              exportedAt: now(),
              official,
              pending
            }
          };
        } catch (error) {
          return error;
        }
      });
    }

    function validateBackupShape(backup) {
      if (
        !backup ||
        typeof backup !== "object" ||
        backup.schemaVersion !== SCHEMA_VERSION ||
        !Array.isArray(backup.official) ||
        !Array.isArray(backup.pending)
      ) {
        return "备份结构无效或版本不支持";
      }
      return null;
    }

    function validateCanonicalQuestion(question, chapter) {
      const identity = question && question.canonicalIdentity;
      if (
        !identity ||
        !identity.course ||
        !identity.chapter ||
        !identity.question
      ) {
        return "题目缺少 canonical identity";
      }
      const courseKey = Bank.makeCourseKey(identity.course);
      const chapterKey = Bank.makeChapterKey({
        courseKey,
        chapterId: identity.chapter.chapterId,
        chapterIdStatus: "stable"
      });
      if (courseKey !== chapter.courseKey || chapterKey !== chapter.chapterKey) {
        return "题目 canonical 课程/章节与分片不一致";
      }
      const expected = Bank.makeQuestionKey({
        chapterKey: chapter.chapterKey,
        type: identity.question.type,
        stem: identity.question.stem,
        options: identity.question.options
      });
      if (!expected || expected !== question.questionKey) {
        return "题目 questionKey 与 canonical identity 不一致";
      }
      return null;
    }

    function validateOfficialQuestion(question, chapter) {
      if (
        !question ||
        question.importTarget !== "official" ||
        question.chapterKey !== chapter.chapterKey ||
        question.chapterIdStatus !== "stable" ||
        !(
          question.chapterLinkStatus === "direct" ||
          question.chapterLinkStatus === "descendant" ||
          (question.chapterLinkStatus === "cross_frame" &&
            question.verification === "frame_unverified")
        ) ||
        !question.chapterId ||
        !question.questionKey ||
        !question.canonicalIdentity
      ) {
        return "正式题目身份字段无效";
      }
      return validateCanonicalQuestion(question, chapter);
    }

    function validatePendingQuestion(question, pending) {
      if (
        !question ||
        question.importTarget !== "pending" ||
        question.chapterKey !== pending.chapterKey ||
        question.chapterLinkStatus !== "cross_frame" ||
        !question.questionKey ||
        !question.canonicalIdentity
      ) {
        return "待确认题目身份字段无效";
      }
      return validateCanonicalQuestion(question, pending);
    }

    async function rollbackSnapshot(previous, touchedKeys) {
      try {
        const restore = {};
        const remove = [];
        touchedKeys.forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(previous, key)) {
            restore[key] = clone(previous[key]);
          } else {
            remove.push(key);
          }
        });
        if (Object.keys(restore).length > 0) {
          await setEntries(restore);
        }
        if (remove.length > 0) {
          await removeKeys(remove);
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error.error || {
            code: "ROLLBACK_FAILED",
            message: String((error && error.message) || error)
          }
        };
      }
    }

    async function importData(backup) {
      const storageErrorResult = ensureStorage();
      if (storageErrorResult) return storageErrorResult;
      const shapeError = validateBackupShape(backup);
      if (shapeError) {
        return makeError("INVALID_BACKUP", shapeError);
      }
      return enqueue(async () => {
        try {
          const all = await getAll();
          const chapterWrites = {};
          const pendingWrites = {};
          const officialSeen = new Set();
          const pendingSeen = new Set();

          for (const chapter of backup.official) {
            if (
              !chapter ||
              !chapter.courseKey ||
              !chapter.chapterKey ||
              !chapter.questions ||
              typeof chapter.questions !== "object"
            ) {
              return makeError("INVALID_BACKUP", "正式章节结构无效");
            }
            if (officialSeen.has(chapter.chapterKey)) {
              return makeError("INVALID_BACKUP", "正式章节重复");
            }
            officialSeen.add(chapter.chapterKey);
            const key = chapterStorageKey(
              chapter.courseKey,
              chapter.chapterKey
            );
            let base = chapterWrites[key] || all[key];
            if (base && base.chapterKey !== chapter.chapterKey) {
              return makeError("INVALID_BACKUP", "正式章节键冲突");
            }
            base =
              base ||
              {
                ...chapterMetadata(chapter),
                questions: {},
                createdAt: now(),
                updatedAt: now()
              };
            let questions = { ...(base.questions || {}) };
            for (const question of Object.values(chapter.questions)) {
              const error = validateOfficialQuestion(question, chapter);
              if (error) {
                return makeError("INVALID_BACKUP", error);
              }
              const result = Bank.upsertQuestion(
                { ...base, questions },
                question
              );
              if (
                result.action !== "insert" &&
                result.action !== "update"
              ) {
                return makeError(
                  "INVALID_BACKUP",
                  result.reason || "正式题目身份冲突"
                );
              }
              questions = result.chapter.questions;
            }
            chapterWrites[key] = {
              ...base,
              ...chapterMetadata(chapter),
              questions,
              updatedAt: now()
            };
          }

          for (const pending of backup.pending) {
            if (
              !pending ||
              !pending.courseKey ||
              !pending.chapterKey ||
              !pending.questions ||
              typeof pending.questions !== "object"
            ) {
              return makeError("INVALID_BACKUP", "待确认章节结构无效");
            }
            if (pendingSeen.has(pending.chapterKey)) {
              return makeError("INVALID_BACKUP", "待确认章节重复");
            }
            pendingSeen.add(pending.chapterKey);
            const key = pendingStorageKey(
              pending.courseKey,
              pending.chapterKey
            );
            let base = pendingWrites[key] || all[key];
            base =
              base ||
              {
                ...pendingMetadata(pending),
                questions: {},
                createdAt: now(),
                updatedAt: now()
              };
            let questions = { ...(base.questions || {}) };
            for (const question of Object.values(pending.questions)) {
              const error = validatePendingQuestion(question, pending);
              if (error) {
                return makeError("INVALID_BACKUP", error);
              }
              const merged = mergePending(
                { ...base, questions },
                question
              );
              if (
                merged.action !== "insert" &&
                merged.action !== "update"
              ) {
                return makeError(
                  "INVALID_BACKUP",
                  merged.reason || "待确认题目身份冲突"
                );
              }
              questions = merged.questions;
            }
            pendingWrites[key] = {
              ...base,
              ...pendingMetadata(pending),
              questions,
              updatedAt: now()
            };
          }

          const entries = { ...chapterWrites, ...pendingWrites };
          const touchedKeys = [...Object.keys(entries), INDEX_KEY];
          try {
            await setEntries(entries);
          } catch (error) {
            const rollback = await rollbackSnapshot(all, touchedKeys);
            return makeError(
              "IMPORT_PARTIAL",
              "备份写入失败，已尝试回滚",
              {
                partial: true,
                rollbackAttempted: true,
                rollbackSucceeded: rollback.ok,
                cause: error.error || error
              }
            );
          }
          let index;
          try {
            index = await refreshIndexFromAll();
          } catch (error) {
            const rollback = await rollbackSnapshot(all, touchedKeys);
            return makeError(
              "IMPORT_PARTIAL",
              "备份已写入但索引更新失败，已尝试回滚",
              {
                partial: true,
                rollbackAttempted: true,
                rollbackSucceeded: rollback.ok,
                cause: error.error || error
              }
            );
          }
          return {
            ok: true,
            importedChapters: Object.keys(chapterWrites).length,
            importedPendingChapters: Object.keys(pendingWrites).length,
            indexUpdated: true,
            index
          };
        } catch (error) {
          return error;
        }
      });
    }

    const api = {
      SCHEMA_VERSION,
      INDEX_KEY,
      CHAPTER_PREFIX,
      PENDING_PREFIX,
      saveOfficialQuestion,
      saveUnverifiedQuestion,
      savePendingQuestion,
      getCourses,
      getChapters,
      getQuestions,
      getPendingQuestions,
      getQuestion,
      deleteQuestion,
      deletePendingQuestion,
      deleteChapter,
      rebuildIndexes,
      getStorageStats,
      exportData,
      importData,
      getConcurrencyInfo
    };
    return api;
  }

  return { createStorage };
});
