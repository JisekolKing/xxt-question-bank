"use strict";

/**
 * 本地题库纯数据层测试（开发工具，不参与插件运行）。
 * 不访问 DOM、不调用 chrome.storage、不依赖 UI。
 */

const assert = require("node:assert");
const path = require("node:path");
const Bank = require(path.join(__dirname, "..", "popup", "question-bank.js"));

let failed = 0;
function test(name, run) {
  try {
    run();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

function chapterFor(record) {
  return { chapterKey: record.chapterKey, questions: {} };
}

const NOW = 1780000000000;

function context(overrides = {}) {
  return {
    courseId: "266489679",
    classId: "789012",
    cpi: "345678",
    pageType: "homework",
    now: NOW,
    ...overrides
  };
}

function question(overrides = {}) {
  return {
    type: "single_choice",
    number: 1,
    course: "药理学",
    chapter: "2.8 题库02-001",
    parentChapterName: "第二章",
    stem: "题干内容",
    stemTextStatus: "ok",
    options: [
      { label: "A", text: "选项甲", textStatus: "ok" },
      { label: "B", text: "选项乙", textStatus: "ok" }
    ],
    optionCount: 2,
    textStatus: "ok",
    textMessage: "",
    chapterId: "cur1231902406",
    chapterIdSource: "coursetree",
    chapterIdStatus: "stable",
    chapterFrameId: 0,
    chapterFrameStatus: "stable",
    frameId: 777,
    chapterLinkStatus: "direct",
    sourceUrl:
      "https://mooc1.chaoxing.com/mooc-ans/mooc2/work/view?chapterId=1231902406&token=secret",
    sourceTitle: "作业详情",
    media: [],
    answer: {
      user: "B",
      correct: "A",
      result: "incorrect",
      score: 0,
      correctStatus: "visible",
      userText: "选项乙",
      correctText: "选项甲"
    },
    ...overrides
  };
}

console.log("本地题库纯数据层测试\n");

test("courseKey 使用 courseId + classId + cpi，课程名不参与", () => {
  const first = Bank.makeCourseKey({
    courseId: "266489679",
    classId: "789012",
    cpi: "345678"
  });
  const same = Bank.makeCourseKey({
    courseId: "266489679",
    classId: "789012",
    cpi: "345678"
  });
  const differentCpi = Bank.makeCourseKey({
    courseId: "266489679",
    classId: "789012",
    cpi: "999999"
  });

  assert.ok(first);
  assert.strictEqual(first, same);
  assert.notStrictEqual(first, differentCpi);
  assert.strictEqual(
    Bank.makeCourseKey({ courseId: "266489679", classId: null }),
    null
  );
});

test("chapterKey 使用 courseKey + chapterId；缺失 stable ID 返回 null", () => {
  const courseKey = Bank.makeCourseKey({
    courseId: "266489679",
    classId: "789012",
    cpi: "345678"
  });
  const first = Bank.makeChapterKey({
    courseKey,
    chapterId: "cur1231902406",
    chapterIdStatus: "stable"
  });
  const second = Bank.makeChapterKey({
    courseKey,
    chapterId: "cur9999999999",
    chapterIdStatus: "stable"
  });
  const missing = Bank.makeChapterKey({
    courseKey,
    chapterId: null,
    chapterIdStatus: "missing"
  });

  assert.ok(first);
  assert.notStrictEqual(first, second);
  assert.strictEqual(missing, null);
});

test("缺少课程或章节 ID 时拒绝正式归类", () => {
  const noCourse = Bank.planImport(question(), {
    courseId: null,
    classId: null
  });
  const noChapter = Bank.planImport(
    question({ chapterId: null, chapterIdStatus: "missing" })
  );
  const ambiguous = Bank.planImport(
    question({ chapterId: null, chapterIdStatus: "ambiguous" })
  );

  assert.strictEqual(noCourse.target, "rejected");
  assert.strictEqual(noChapter.target, "rejected");
  assert.strictEqual(ambiguous.target, "rejected");
});

test("stable + direct 进入正式归类", () => {
  const result = Bank.toBankQuestion(question(), context());

  assert.strictEqual(result.plan.target, "official");
  assert.ok(result.question);
  assert.strictEqual(result.question.chapterLinkStatus, "direct");
  assert.ok(result.question.questionKey);
  assert.strictEqual(result.question.teacherAnalysis, null);
  assert.strictEqual(result.question.analysisStatus, "not_supported");
});

test("stable + cross_frame 进入待确认，不进入正式 target", () => {
  const result = Bank.toBankQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  );

  assert.strictEqual(result.plan.target, "pending");
  assert.strictEqual(result.plan.reason, "cross_frame_requires_confirmation");
  assert.ok(result.question);
  assert.strictEqual(result.question.chapterLinkStatus, "cross_frame");
});

test("宽松模式可保存跨 frame 题目但标记未验证", () => {
  const result = Bank.toBankQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context({ allowUnverified: true })
  );
  assert.strictEqual(result.plan.target, "official");
  assert.strictEqual(result.plan.unverified, true);
  assert.strictEqual(result.question.verification, "frame_unverified");
  assert.strictEqual(result.question.chapterLinkStatus, "cross_frame");
});

test("workId 作业分类可以作为稳定章节", () => {
  const result = Bank.toBankQuestion(
    question({
      chapter: "Lecture1&2",
      chapterId: "work_56876045",
      chapterIdSource: "work",
      chapterIdStatus: "stable",
      chapterLinkStatus: "direct"
    }),
    context()
  );
  assert.strictEqual(result.plan.target, "official");
  assert.strictEqual(result.question.chapterId, "work_56876045");
  assert.strictEqual(result.question.chapterIdSource, "work");
  assert.ok(result.question.chapterKey);
});

test("stable + descendant 可进入正式归类", () => {
  const result = Bank.toBankQuestion(
    question({ chapterLinkStatus: "descendant" }),
    context()
  );
  assert.strictEqual(result.plan.target, "official");
  assert.strictEqual(result.question.chapterLinkStatus, "descendant");
});

test("不同章节的相同题目不会合并", () => {
  const first = Bank.toBankQuestion(question(), context()).question;
  const second = Bank.toBankQuestion(
    question({ chapterId: "cur9999999999" }),
    context()
  ).question;

  assert.notStrictEqual(first.chapterKey, second.chapterKey);
  assert.notStrictEqual(first.questionKey, second.questionKey);
});

test("同一章节重复题目 upsert 更新而不是新增", () => {
  const first = Bank.toBankQuestion(question(), context()).question;
  const second = Bank.toBankQuestion(
    question({ textMessage: "再次导入" }),
    context({ now: NOW + 1000 })
  ).question;

  const inserted = Bank.upsertQuestion(chapterFor(first), first);
  assert.strictEqual(inserted.action, "insert");
  assert.strictEqual(Object.keys(inserted.chapter.questions).length, 1);

  const updated = Bank.upsertQuestion(inserted.chapter, second);
  assert.strictEqual(updated.action, "update");
  assert.strictEqual(Object.keys(updated.chapter.questions).length, 1);
  assert.strictEqual(updated.question.questionKey, first.questionKey);
});

test("部分题目不能覆盖完整题目", () => {
  const complete = Bank.toBankQuestion(question(), context()).question;
  const partial = Bank.toBankQuestion(
    question({
      stem: "题干内容",
      stemTextStatus: "protected_text",
      textStatus: "mixed",
      options: [
        { label: "A", text: "选项甲", textStatus: "protected_text" },
        { label: "B", text: "选项乙", textStatus: "protected_text" }
      ]
    }),
    context({ now: NOW + 1000 })
  ).question;

  const inserted = Bank.upsertQuestion(chapterFor(complete), complete);
  const result = Bank.upsertQuestion(inserted.chapter, partial);

  assert.strictEqual(result.action, "skip");
  assert.strictEqual(result.reason, "incomplete_incoming");
  assert.strictEqual(
    result.question.stem,
    complete.stem
  );
  assert.strictEqual(result.question.identityQuality, "complete");
});

test("正确答案冲突时保留旧值并记录冲突", () => {
  const first = Bank.toBankQuestion(question(), context()).question;
  const second = Bank.toBankQuestion(
    question({
      answer: {
        user: "C",
        correct: "C",
        result: "incorrect",
        score: 0,
        correctStatus: "visible",
        userText: "选项丙",
        correctText: "选项丙"
      }
    }),
    context({ now: NOW + 1000 })
  ).question;

  const inserted = Bank.upsertQuestion(chapterFor(first), first);
  const result = Bank.upsertQuestion(inserted.chapter, second);

  assert.strictEqual(result.question.correctAnswer.value, "A");
  assert.strictEqual(result.question.answerConflicts.correct.existing, "A");
  assert.strictEqual(result.question.answerConflicts.correct.incoming, "C");
});

test("正确答案为空时不能覆盖已有答案", () => {
  const first = Bank.toBankQuestion(question(), context()).question;
  const second = Bank.toBankQuestion(
    question({
      answer: {
        user: null,
        correct: null,
        result: "unknown",
        score: null,
        correctStatus: "not_visible",
        userText: null,
        correctText: null
      }
    }),
    context({ now: NOW + 1000 })
  ).question;

  const inserted = Bank.upsertQuestion(chapterFor(first), first);
  const result = Bank.upsertQuestion(inserted.chapter, second);

  assert.strictEqual(result.question.correctAnswer.value, "A");
  assert.strictEqual(result.question.correctAnswer.status, "visible");
});

test("source 只保留 pathname，不保留 query 或完整 URL", () => {
  const result = Bank.toBankQuestion(question(), context());
  const source = result.question.source;

  assert.strictEqual(source.path, "/mooc-ans/mooc2/work/view");
  assert.strictEqual(source.title, "作业详情");
  assert.strictEqual(source.path.includes("?"), false);
  assert.strictEqual(JSON.stringify(source).includes("secret"), false);
  assert.strictEqual("sourceUrl" in result.question, false);
});

test("用户答案不会污染 correctAnswer", () => {
  const result = Bank.toBankQuestion(question(), context()).question;

  assert.strictEqual(result.correctAnswer.value, "A");
  assert.strictEqual(result.importObservation.userAnswer, "B");
  assert.strictEqual(result.importObservation.result, "incorrect");
});

test("frameId 不参与 questionKey", () => {
  const first = Bank.toBankQuestion(
    question({ frameId: 0 }),
    context()
  ).question;
  const second = Bank.toBankQuestion(
    question({ frameId: 777 }),
    context()
  ).question;

  assert.strictEqual(first.questionKey, second.questionKey);
});

test("pending/rejected 不能进入正式章节", () => {
  const pending = Bank.toBankQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  ).question;
  const pendingResult = Bank.upsertQuestion(
    chapterFor(pending),
    pending
  );
  assert.strictEqual(pendingResult.action, "skip");
  assert.strictEqual(pendingResult.reason, "not_official_import");

  const rejected = Bank.toBankQuestion(
    question({ chapterId: null, chapterIdStatus: "missing" }),
    context()
  ).question;
  assert.strictEqual(rejected, null);
});

test("pending 记录保留完整的待确认信息", () => {
  const pending = Bank.toBankQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  ).question;

  assert.strictEqual(pending.importTarget, "pending");
  assert.strictEqual(pending.courseName, "药理学");
  assert.strictEqual(pending.chapterName, "2.8 题库02-001");
  assert.strictEqual(pending.parentChapterName, "第二章");
  assert.strictEqual(pending.courseId, "266489679");
  assert.strictEqual(pending.classId, "789012");
  assert.strictEqual(pending.cpi, "345678");
  assert.ok(pending.chapterId);
  assert.ok(pending.chapterKey);
});

test("chapterKey 不匹配时拒绝 upsert", () => {
  const first = Bank.toBankQuestion(question(), context()).question;
  const result = Bank.upsertQuestion(
    { chapterKey: "ch_other", questions: {} },
    first
  );

  assert.strictEqual(result.action, "skip");
  assert.strictEqual(result.reason, "chapter_key_mismatch");
  assert.strictEqual(Object.keys(result.chapter.questions).length, 0);
});

test("两个不同 partial 题目不会互相覆盖", () => {
  const partial = (number) =>
    Bank.toBankQuestion(
      question({
        number,
        stem: null,
        stemTextStatus: "protected_text",
        textStatus: "mixed",
        options: [
          { label: "A", text: null, textStatus: "protected_text" },
          { label: "B", text: null, textStatus: "protected_text" }
        ],
        textMessage: `partial-${number}`
      }),
      context()
    ).question;

  const first = partial(1);
  const second = partial(2);
  assert.strictEqual(first.questionKey, second.questionKey);

  const inserted = Bank.upsertQuestion(chapterFor(first), first);
  const result = Bank.upsertQuestion(inserted.chapter, second);

  assert.strictEqual(result.action, "update");
  assert.strictEqual(
    result.reason,
    "partial_observation_updated"
  );
  assert.strictEqual(result.question.textMessage, "partial-1");
});

test("hash 相同但 canonical identity 不同时不发生错误合并", () => {
  const first = Bank.toBankQuestion(question(), context()).question;
  const collision = {
    ...first,
    stem: "另一道题干",
    canonicalIdentity: {
      ...first.canonicalIdentity,
      question: {
        ...first.canonicalIdentity.question,
        stem: "另一道题干"
      }
    }
  };

  const inserted = Bank.upsertQuestion(chapterFor(first), first);
  const result = Bank.upsertQuestion(inserted.chapter, collision);

  assert.strictEqual(result.action, "skip");
  assert.strictEqual(result.reason, "missing_official_identity");
  assert.strictEqual(
    inserted.chapter.questions[first.questionKey].stem,
    first.stem
  );
});

test("correctStatus 非 visible 时不保存正确答案值", () => {
  const result = Bank.toBankQuestion(
    question({
      answer: {
        user: "B",
        correct: "A",
        result: "incorrect",
        score: 0,
        correctStatus: "not_visible",
        userText: "选项乙",
        correctText: "选项甲"
      }
    }),
    context()
  ).question;

  assert.strictEqual(result.correctAnswer, null);
  assert.strictEqual(result.importObservation.userAnswer, "B");
});

test("media 不保留完整 URL、query 或 hash", () => {
  const result = Bank.toBankQuestion(
    question({
      media: [
        {
          kind: "image",
          scope: "stem",
          src: "https://cdn.example.com/img/photo.png?token=secret#frag",
          alt: "示意图"
        }
      ]
    }),
    context()
  ).question;

  assert.strictEqual(result.media.length, 1);
  assert.strictEqual(result.media[0].kind, "image");
  assert.strictEqual(result.media[0].path, "/img/photo.png");
  assert.strictEqual("src" in result.media[0], false);
  const serialized = JSON.stringify(result.media);
  assert.strictEqual(serialized.includes("secret"), false);
  assert.strictEqual(serialized.includes("?"), false);
  assert.strictEqual(serialized.includes("#"), false);
});

test("incoming 冲突信息不会丢失", () => {
  const first = Bank.toBankQuestion(question(), context()).question;
  first.answerConflicts = {
    old: { existing: "A", incoming: "B", lastSeenAt: NOW }
  };
  const second = Bank.toBankQuestion(question(), context()).question;
  second.answerConflicts = {
    incomingOnly: { existing: "C", incoming: "D", lastSeenAt: NOW + 1 }
  };

  const inserted = Bank.upsertQuestion(chapterFor(first), first);
  const result = Bank.upsertQuestion(inserted.chapter, second);

  assert.ok(result.question.answerConflicts.old);
  assert.ok(result.question.answerConflicts.incomingOnly);
});

test("upsert 不原地修改输入对象", () => {
  const incoming = Bank.toBankQuestion(question(), context()).question;
  const targetChapter = chapterFor(incoming);
  const beforeIncoming = JSON.stringify(incoming);
  const beforeChapter = JSON.stringify(targetChapter);

  Bank.upsertQuestion(targetChapter, incoming);

  assert.strictEqual(JSON.stringify(incoming), beforeIncoming);
  assert.strictEqual(JSON.stringify(targetChapter), beforeChapter);
});

test("手工构造 official 的 pending 题也不能绕过", () => {
  const pending = Bank.toBankQuestion(
    question({ chapterLinkStatus: "cross_frame" }),
    context()
  ).question;
  const forged = {
    ...pending,
    importTarget: "official",
    questionKey: "q_forged"
  };

  const result = Bank.upsertQuestion(chapterFor(pending), forged);
  assert.strictEqual(result.action, "skip");
  assert.strictEqual(result.reason, "missing_official_identity");
});

test("upsert 更新时也不修改输入对象", () => {
  const first = Bank.toBankQuestion(question(), context()).question;
  const second = Bank.toBankQuestion(
    question({ textMessage: "更新" }),
    context({ now: NOW + 1000 })
  ).question;
  const inserted = Bank.upsertQuestion(chapterFor(first), first);
  const beforeIncoming = JSON.stringify(second);
  const beforeChapter = JSON.stringify(inserted.chapter);

  Bank.upsertQuestion(inserted.chapter, second);

  assert.strictEqual(JSON.stringify(second), beforeIncoming);
  assert.strictEqual(JSON.stringify(inserted.chapter), beforeChapter);
});

test("同键冲突信息也保留历史", () => {
  const first = Bank.toBankQuestion(question(), context()).question;
  first.answerConflicts = {
    correct: { existing: "A", incoming: "B", lastSeenAt: NOW }
  };
  const second = Bank.toBankQuestion(question(), context()).question;
  second.answerConflicts = {
    correct: { existing: "C", incoming: "D", lastSeenAt: NOW + 1 }
  };

  const inserted = Bank.upsertQuestion(chapterFor(first), first);
  const result = Bank.upsertQuestion(inserted.chapter, second);

  assert.strictEqual(result.question.answerConflicts.correct.history.length, 2);
  assert.strictEqual(
    result.question.answerConflicts.correct.history[0].existing,
    "C"
  );
  assert.strictEqual(
    result.question.answerConflicts.correct.history[1].existing,
    "A"
  );
});

test("旧记录 canonicalIdentity 缺失或不一致时可按章节内容修复", () => {
  const first = Bank.toBankQuestion(question(), context()).question;
  const second = Bank.toBankQuestion(question(), context()).question;
  const targetChapter = {
    ...chapterFor(first),
    courseId: first.courseId,
    classId: first.classId,
    cpi: first.cpi,
    chapterId: first.chapterId
  };

  const missingCanonical = {
    ...first,
    canonicalIdentity: null
  };
  const missingResult = Bank.upsertQuestion(
    {
      ...targetChapter,
      questions: { [first.questionKey]: missingCanonical }
    },
    second
  );
  assert.strictEqual(missingResult.action, "update");
  assert.ok(missingResult.question.canonicalIdentity);

  const legacyCanonical = {
    ...first,
    canonicalIdentity: {
      ...first.canonicalIdentity,
      question: { ...first.canonicalIdentity.question, stem: "旧格式" }
    }
  };
  const legacyResult = Bank.upsertQuestion(
    {
      ...targetChapter,
      questions: { [first.questionKey]: legacyCanonical }
    },
    second
  );
  assert.strictEqual(legacyResult.action, "update");
  assert.ok(legacyResult.question.canonicalIdentity);
});

console.log("");
if (failed > 0) {
  console.error(`测试失败：${failed} 个用例未通过`);
  process.exitCode = 1;
} else {
  console.log("全部本地题库纯数据层测试通过");
}
