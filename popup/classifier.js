"use strict";

/**
 * 学习通课程题库助手 · 页面识别规则
 *
 * 这个文件不接触浏览器页面，只做纯数据判断：
 *   输入：当前标签页的 URL、标题，以及页面快照（content/snapshot.js 的结果）
 *   输出：是否学习通、页面类型、课程名称、置信度和识别依据
 *
 * 设计原则：
 *   1. 多信号判断：网址 + 页面标题 + 可见标题 + 面包屑；
 *   2. 宁可返回“其他学习通页面”，也不硬猜一个类型；
 *   3. 课程名必须来自可见的课程标题元素、课程链接面包屑或页面标题，
 *      并对通用词、章节名、题型名做过滤，避免把“第一章 函数”当成课程名。
 */

(function (root) {
  "use strict";

  const PAGE_LABELS = {
    courseHome: "课程主页",
    chapterStudy: "课程学习",
    chapterQuiz: "章节测验",
    practice: "随堂练习",
    homework: "课程作业",
    other: "其他学习通页面",
    notChaoxing: "非学习通页面",
    unknown: "无法识别"
  };

  // 关键词按“越具体越靠前”排序，命中一个就够，不重复加分。
  const TYPE_TERMS = {
    chapterQuiz: ["章节测验", "章节测试", "章测验"],
    practice: ["随堂练习", "课堂练习", "随堂测试"],
    homework: ["课程作业", "章节作业", "作业详情", "我的作业", "作业"],
    courseHome: ["课程主页", "课程首页", "课程信息"]
  };

  const GENERIC_COURSE_NAMES = new Set([
    "学习通",
    "超星",
    "超星学习通",
    "学习通官网",
    "首页",
    "主页",
    "课程",
    "课程主页",
    "课程首页",
    "我的课程",
    "我的",
    "个人空间",
    "空间",
    "消息",
    "通知",
    "登录",
    "注册",
    "章节",
    "章节测验",
    "章节测试",
    "随堂练习",
    "作业",
    "考试",
    "课程作业",
    "资料",
    "讨论",
    "题库",
    "个人中心",
    "学习中心",
    "发现",
    "更多",
    "当前位置",
    "成绩",
    "成绩单",
    "签到",
    "公告",
    "任务点",
    "学习记录"
  ]);

  // 章节名、题型名不能当课程名。
  const CHAPTER_NAME_PATTERN =
    /^(第[一二三四五六七八九十百千零两\d]+[章节讲课篇单元]|单元[一二三四五六七八九十百千零两\d]+|专题[一二三四五六七八九十百千零两\d]+|模块[一二三四五六七八九十百千零两\d]+|项目[一二三四五六七八九十百千零两\d]+)/;
  const SECTION_NUMBER_PATTERN = /^\d+(\.\d+)+/;
  const PAGE_NAME_PATTERN =
    /^(作业|测验|测试|考试|练习|答案|解析|题库)|(答案|解析|题库|测试|测验|考试|作业|练习)$/;

  /** 合并空白。 */
  function normalize(value) {
    return String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
  }

  /** 判断域名是否属于学习通（严格匹配后缀，防止 chaoxing.com.evil.com）。 */
  function isChaoxingHost(hostname) {
    const host = String(hostname || "")
      .toLowerCase()
      .replace(/\.$/, "");
    if (!host) {
      return false;
    }
    return ["chaoxing.com", "chaoxing.cn"].some(
      (base) => host === base || host.endsWith("." + base)
    );
  }

  /** 解析 URL，失败时返回 ok:false，而不是抛异常。 */
  function analyzeUrl(rawUrl) {
    try {
      const parsed = new URL(String(rawUrl || ""));
      return {
        ok: true,
        href: parsed.href,
        protocol: parsed.protocol,
        host: parsed.hostname.toLowerCase(),
        path: parsed.pathname.toLowerCase(),
        search: parsed.search.toLowerCase(),
        isChaoxing: isChaoxingHost(parsed.hostname)
      };
    } catch (error) {
      return {
        ok: false,
        href: "",
        protocol: "",
        host: "",
        path: "",
        search: "",
        isChaoxing: false
      };
    }
  }

  /** 把页面标题按常见分隔符拆成片段。 */
  function splitTitle(title) {
    return normalize(title)
      .split(/\s*[-–—_|｜]\s*/)
      .map(normalize)
      .filter(Boolean);
  }

  /** 平台名、通用页名，不作为课程名。 */
  function isPlatformPiece(piece) {
    const value = normalize(piece).replace(/\s+/g, "");
    return [
      "学习通",
      "超星",
      "超星学习通",
      "学习通官网",
      "首页",
      "登录"
    ].includes(value);
  }

  /** 清洗并校验课程名候选；不可靠就返回 null。 */
  function sanitizeCourseName(raw) {
    let name = normalize(raw);
    if (!name) {
      return null;
    }

    name = name.replace(/^(?:课程名称|课程名|课程|当前位置)\s*[:：]\s*/, "");
    name = name.replace(/^[>›»\s]+/, "").replace(/[>›»\s]+$/, "");
    name = name.trim();

    if (name.length < 2 || name.length > 60) {
      return null;
    }
    if (GENERIC_COURSE_NAMES.has(name)) {
      return null;
    }
    if (CHAPTER_NAME_PATTERN.test(name)) {
      return null;
    }
    if (SECTION_NUMBER_PATTERN.test(name)) {
      return null;
    }
    if (PAGE_NAME_PATTERN.test(name)) {
      return null;
    }
    if (/(答案|解析|题库)/.test(name)) {
      return null;
    }
    if (/^(https?:\/\/|www\.)/i.test(name)) {
      return null;
    }
    if (/[<>]/.test(name)) {
      return null;
    }
    if (!/[\u4e00-\u9fa5A-Za-z]/.test(name)) {
      return null;
    }

    return name;
  }

  /** 面包屑链接是否指向课程主页（用于确认这段文字是课程名）。 */
  function isCourseLink(href) {
    const value = String(href || "").toLowerCase();
    if (!value) {
      return false;
    }
    return /(courseid=|courselistdata|\/course\/|\/mycourse\/|\/visit\/)/.test(
      value
    );
  }

  function getCrumbText(crumb) {
    if (!crumb) {
      return "";
    }
    if (typeof crumb === "string") {
      return crumb;
    }
    return normalize(crumb.text);
  }

  function getCrumbHref(crumb) {
    if (!crumb || typeof crumb !== "object") {
      return "";
    }
    return String(crumb.href || "");
  }

  /**
   * 页面类型打分。
   * 权重：页面标题 4，一级标题 3，其他标题 2，面包屑 2，网址 1~4。
   * 只有最高分 >= 3 且领先第二名 >= 2 才认可，否则归为“其他”。
   */
  function detectPageType(urlInfo, frames, tabTitle) {
    const scores = {
      courseHome: 0,
      chapterStudy: 0,
      chapterQuiz: 0,
      practice: 0,
      homework: 0
    };
    const evidence = {
      courseHome: [],
      chapterStudy: [],
      chapterQuiz: [],
      practice: [],
      homework: []
    };
    const generalEvidence = [];
    let examLike = false;

    function addScore(type, weight, reason) {
      scores[type] += weight;
      if (evidence[type].length < 2) {
        evidence[type].push(reason);
      }
    }

    function scanText(text, weight, sourceLabel) {
      const value = normalize(text);
      if (!value) {
        return;
      }
      Object.keys(TYPE_TERMS).forEach((type) => {
        const hit = TYPE_TERMS[type].find((term) => value.includes(term));
        if (!hit) {
          return;
        }
        addScore(type, weight, `${sourceLabel}包含「${hit}」`);
      });
    }

    // 1. 页面标题（标签页标题 + 各框架标题）
    const titles = [];
    if (tabTitle) {
      titles.push(normalize(tabTitle));
    }
    frames.forEach((frame) => {
      const title = normalize(frame && frame.title);
      if (title && !titles.includes(title)) {
        titles.push(title);
      }
    });
    titles.forEach((title) => scanText(title, 4, "页面标题"));

    // 2. 可见标题与面包屑
    frames.forEach((frame) => {
      const headings = Array.isArray(frame && frame.headings)
        ? frame.headings
        : [];
      headings.forEach((heading) => {
        const text = normalize(heading && heading.text);
        if (!text) {
          return;
        }
        const isH1 = heading.tag === "h1";
        scanText(text, isH1 ? 3 : 2, isH1 ? "一级标题" : "页面标题");
      });

      const breadcrumbs = Array.isArray(frame && frame.breadcrumbs)
        ? frame.breadcrumbs
        : [];
      breadcrumbs.forEach((crumb) => {
        scanText(getCrumbText(crumb), 2, "面包屑导航");
      });
    });

    // 3. 网址路径
    const path = urlInfo.path || "";

    // /mycourse/studentstudy 是课程学习页，不是课程主页。
    // 给 6 分，避免标题里出现“章节测验”等词时被其他类型抢走。
    if (/\/mycourse\/studentstudy/i.test(path)) {
      addScore("chapterStudy", 6, "网址包含 /mycourse/studentstudy");
    }

    let courseUrlScore = 0;
    let courseUrlReason = "";
    if (path.includes("courselistdata")) {
      courseUrlScore = 4;
      courseUrlReason = "网址包含 courselistdata";
    } else if (/\/visit\//.test(path)) {
      courseUrlScore = 3;
      courseUrlReason = "网址包含 /visit/";
    } else if (/\/mycourse\//.test(path)) {
      courseUrlScore = 3;
      courseUrlReason = "网址包含 /mycourse/";
    } else if (/\/course\//.test(path)) {
      courseUrlScore = 1;
      courseUrlReason = "网址包含 /course/";
    }
    if (courseUrlScore > 0) {
      addScore("courseHome", courseUrlScore, courseUrlReason);
    }

    if (/\/work\//.test(path) || /[?&]workid=/i.test(urlInfo.search)) {
      addScore("homework", 1, "网址包含作业/测验入口");
      addScore("chapterQuiz", 1, "网址包含作业/测验入口");
      generalEvidence.push(
        "网址包含作业/测验入口（两者共用，需要标题进一步区分）"
      );
    }

    if (/(\/practice\/|\/quick\/|\/inclass\/|\/activity\/)/.test(path)) {
      addScore("practice", 4, "网址包含练习相关路径");
    }

    if (/(\/exam\/|\/examtask\/)/.test(path)) {
      examLike = true;
      generalEvidence.push("网址包含考试相关路径");
    }

    // 4. 汇总判断
    const ranked = Object.keys(scores)
      .map((type) => ({ type, score: scores[type] }))
      .sort((a, b) => b.score - a.score);
    const top = ranked[0];
    const second = ranked[1];

    if (examLike) {
      return {
        pageType: "other",
        label: "考试页面（本阶段不处理）",
        confidence: "high",
        evidence: generalEvidence.slice(0, 3),
        note: "检测到考试相关页面。本扩展不会读取、提取或处理考试内容。",
        examLike: true
      };
    }

    if (top.score >= 3 && top.score - second.score >= 2) {
      const selectedEvidence = evidence[top.type].slice(0, 2);
      generalEvidence.forEach((item) => {
        if (selectedEvidence.length < 3) {
          selectedEvidence.push(item);
        }
      });

      return {
        pageType: top.type,
        label: PAGE_LABELS[top.type],
        confidence: top.score >= 6 ? "high" : "medium",
        evidence: selectedEvidence,
        note: `已识别为学习通${PAGE_LABELS[top.type]}页面。`,
        examLike: false
      };
    }

    if (top.score > 0) {
      return {
        pageType: "other",
        label: PAGE_LABELS.other,
        confidence: "none",
        evidence: generalEvidence.slice(0, 3),
        note: "当前页面属于学习通，但页面特征不够明确，无法可靠区分具体类型，因此不显示推测结果。",
        examLike: false
      };
    }

    return {
      pageType: "other",
      label: PAGE_LABELS.other,
      confidence: "none",
      evidence: ["域名属于 chaoxing.com"],
      note: "当前页面属于学习通，但未发现可识别的课程页面特征，因此只显示为其他学习通页面。",
      examLike: false
    };
  }

  /**
   * 课程名识别。
   * 可靠来源：可见课程标题元素（3 分）、指向课程主页的面包屑链接（2 分）。
   * 页面标题推断（1 分）只在页面类型已识别时采用，并明确标注“推断”。
   */
  function detectCourseName(tabTitle, frames, pageType) {
    const candidates = [];

    frames.forEach((frame) => {
      const courseCandidates = Array.isArray(frame && frame.courseCandidates)
        ? frame.courseCandidates
        : [];
      courseCandidates.forEach((item) => {
        const name = sanitizeCourseName(item && item.text);
        if (name) {
          candidates.push({
            name,
            score: 3,
            source: "课程标题元素"
          });
        }
      });

      const breadcrumbs = Array.isArray(frame && frame.breadcrumbs)
        ? frame.breadcrumbs
        : [];
      breadcrumbs.forEach((crumb) => {
        if (!isCourseLink(getCrumbHref(crumb))) {
          return;
        }
        const name = sanitizeCourseName(getCrumbText(crumb));
        if (name) {
          candidates.push({
            name,
            score: 2,
            source: "面包屑导航"
          });
        }
      });
    });

    const titles = [];
    if (tabTitle) {
      titles.push(normalize(tabTitle));
    }
    frames.forEach((frame) => {
      const title = normalize(frame && frame.title);
      if (title && !titles.includes(title)) {
        titles.push(title);
      }
    });

    const canUseTitle =
      pageType === "courseHome" ||
      pageType === "chapterQuiz" ||
      pageType === "practice" ||
      pageType === "homework";

    titles.forEach((title) => {
      splitTitle(title).forEach((piece) => {
        if (isPlatformPiece(piece)) {
          return;
        }
        const name = sanitizeCourseName(piece);
        if (name) {
          candidates.push({
            name,
            score: 1,
            source: "页面标题（推断）"
          });
        }
      });
    });

    const usable = candidates.filter(
      (candidate) => candidate.score > 1 || canUseTitle
    );
    if (usable.length === 0) {
      return { name: null, source: null };
    }

    const bestByName = new Map();
    usable.forEach((candidate) => {
      const existing = bestByName.get(candidate.name);
      if (!existing || candidate.score > existing.score) {
        bestByName.set(candidate.name, candidate);
      }
    });

    const sorted = Array.from(bestByName.values()).sort(
      (a, b) => b.score - a.score || b.name.length - a.name.length
    );

    return {
      name: sorted[0].name,
      source: sorted[0].source
    };
  }

  /** 清洗章节名候选；不可靠就返回 null。 */
  function sanitizeChapterName(raw, courseName, options) {
    const trusted = Boolean(options && options.trusted);
    let name = normalize(raw);
    if (!name) {
      return null;
    }

    name = name.replace(/^(?:章节名称|章节名|当前位置)\s*[:：]\s*/, "");
    name = name.replace(/^[>›»\s]+/, "").replace(/[>›»\s]+$/, "");
    name = name.trim();

    if (name.length < 2 || name.length > 80) {
      return null;
    }
    if (GENERIC_COURSE_NAMES.has(name)) {
      return null;
    }
    // 作业页的题量、满分等信息不能当章节名。
    // 注意排除“题库”中的“题”，例如“2.8 题库02-001”不能被当成“8 题”。
    if (
      /(?:共|总计)?\s*\d+\s*(?:道)?题(?!库)|(?:满分|总分)\s*\d+|\d+\s*分/.test(
        name
      )
    ) {
      return null;
    }
    // 目录中真实选中的章节可能本身就叫“绪论+传出神经系统药物测验”。
    // 只有来自可信课程目录、且不是单独“测验/作业/考试”这类通用页面名时，
    // 才允许绕过页面名过滤；普通页面标题仍走严格规则。
    const trustedCatalogTitle =
      trusted &&
      name.length >= 6 &&
      !/^(?:作业|测验|测试|考试|练习|答案|解析|题库)$/.test(name);
    const trustedTiku = trusted && /^题库\s*\d/.test(name);
    if (!trustedTiku && !trustedCatalogTitle && PAGE_NAME_PATTERN.test(name)) {
      return null;
    }
    if (courseName && name === courseName) {
      return null;
    }
    if (/[<>]/.test(name)) {
      return null;
    }
    if (!/[\u4e00-\u9fa5A-Za-z]/.test(name)) {
      return null;
    }

    return name;
  }

  function splitBreadcrumbText(text) {
    return normalize(text)
      .split(/\s*[>›»|｜]\s*/)
      .map(normalize)
      .filter(Boolean);
  }

  /**
   * 章节名识别。
   * 可靠来源：可见章节标题元素（3 分）、章节式面包屑/标题（2 分）。
   * 页面标题中的章节片段（1 分）只作为兜底，并且必须符合“第 X 章/单元/专题”等形式。
   */
  function detectChapterName(frames, courseName) {
    const candidates = [];

    function addCandidate(name, score, source, parentName, metadata) {
      if (!name) {
        return;
      }
      const extra = metadata || {};
      candidates.push({
        name,
        score,
        source,
        parentName: parentName || null,
        chapterId: extra.chapterId || null,
        chapterIdSource: extra.chapterIdSource || null,
        chapterIdStatus: extra.chapterIdStatus || "missing",
        frameId:
          typeof extra.frameId === "number" &&
          Number.isFinite(extra.frameId)
            ? extra.frameId
            : null
      });
    }

    frames.forEach((frame) => {
      const catalog = frame && frame.catalog;
      if (catalog && catalog.chapterName) {
        const catalogChapter = sanitizeChapterName(
          catalog.chapterName,
          courseName,
          { trusted: true }
        );
        const catalogParent = sanitizeChapterName(
          catalog.parentChapterName,
          courseName,
          { trusted: true }
        );
        addCandidate(
          catalogChapter,
          4,
          "课程目录",
          catalogParent,
          {
            chapterId: catalog.chapterId,
            chapterIdSource: catalog.chapterIdSource,
            chapterIdStatus: catalog.chapterIdStatus,
            frameId: frame && frame.frameId
          }
        );
      }

      const chapterCandidates = Array.isArray(frame && frame.chapterCandidates)
        ? frame.chapterCandidates
        : [];
      chapterCandidates.forEach((item) => {
        addCandidate(
          sanitizeChapterName(
            item && item.text,
            courseName,
            {
              trusted: Boolean(item && item.hint === ".ceyan_name h3")
            }
          ),
          3,
          "章节标题元素"
        );
      });

      const breadcrumbs = Array.isArray(frame && frame.breadcrumbs)
        ? frame.breadcrumbs
        : [];
      breadcrumbs.forEach((crumb) => {
        splitBreadcrumbText(getCrumbText(crumb)).forEach((piece) => {
          const name = sanitizeChapterName(piece, courseName);
          if (name && CHAPTER_NAME_PATTERN.test(name)) {
            addCandidate(name, 2, "面包屑导航");
          }
        });
      });

      const headings = Array.isArray(frame && frame.headings)
        ? frame.headings
        : [];
      headings.forEach((heading) => {
        const name = sanitizeChapterName(heading && heading.text, courseName);
        if (name && CHAPTER_NAME_PATTERN.test(name)) {
          addCandidate(name, 2, "页面标题");
        }
      });
    });

    const titles = [];
    frames.forEach((frame) => {
      const title = normalize(frame && frame.title);
      if (title && !titles.includes(title)) {
        titles.push(title);
      }
    });

    titles.forEach((title) => {
      splitTitle(title).forEach((piece) => {
        const name = sanitizeChapterName(piece, courseName);
        if (name && CHAPTER_NAME_PATTERN.test(name)) {
          addCandidate(name, 1, "页面标题（推断）");
        }
      });
    });

    if (candidates.length === 0) {
      return {
        name: null,
        source: null,
        parentName: null,
        chapterId: null,
        chapterIdSource: null,
        chapterIdStatus: "missing",
        chapterFrameId: null,
        chapterFrameStatus: "missing"
      };
    }

    const bestByName = new Map();
    candidates.forEach((candidate) => {
      const existing = bestByName.get(candidate.name);
      if (!existing || candidate.score > existing.score) {
        bestByName.set(candidate.name, candidate);
      }
    });

    const sorted = Array.from(bestByName.values()).sort(
      (a, b) => b.score - a.score || b.name.length - a.name.length
    );
    const selected = sorted[0];

    const catalogCandidates = candidates.filter(
      (candidate) =>
        candidate.source === "课程目录" && candidate.chapterId
    );
    const catalogIds = new Set(
      catalogCandidates.map((candidate) => candidate.chapterId)
    );
    const catalogFrames = new Set(
      catalogCandidates
        .map((candidate) => candidate.frameId)
        .filter((frameId) => typeof frameId === "number")
    );

    let chapterId = null;
    let chapterIdSource = null;
    let chapterIdStatus = "missing";
    let chapterFrameId = null;
    let chapterFrameStatus = "missing";

    if (catalogIds.size > 1) {
      chapterIdStatus = "ambiguous";
      chapterFrameStatus = "ambiguous";
    } else if (catalogIds.size === 1) {
      const onlyId = Array.from(catalogIds)[0];
      const matching = catalogCandidates.find(
        (candidate) =>
          candidate.chapterId === onlyId &&
          candidate.name === selected.name
      );

      if (matching) {
        chapterId = onlyId;
        chapterIdSource = matching.chapterIdSource || "coursetree";
        chapterIdStatus = "stable";

        if (catalogFrames.size === 1) {
          chapterFrameId = Array.from(catalogFrames)[0];
          chapterFrameStatus = "stable";
        } else if (catalogFrames.size > 1) {
          chapterFrameStatus = "ambiguous";
        }
      } else {
        // 目录有 ID，但最终选中的章节名称不是该目录候选，不能把 ID 硬套上去。
        chapterIdStatus = "ambiguous";
        chapterFrameStatus = "ambiguous";
      }
    }

    return {
      name: selected.name,
      source: selected.source,
      parentName: selected.parentName || null,
      chapterId,
      chapterIdSource,
      chapterIdStatus,
      chapterFrameId,
      chapterFrameStatus
    };
  }

  /**
   * 识别入口。
   * @param {{url?: string, title?: string, frames?: Array<object>}} input
   */
  function classify(input) {
    const data = input || {};
    const urlInfo = analyzeUrl(data.url);

    if (!urlInfo.ok) {
      return {
        isChaoxing: false,
        host: "",
        pageType: "unknown",
        label: PAGE_LABELS.unknown,
        confidence: "none",
        courseName: null,
        courseNameSource: null,
        chapterName: null,
        chapterNameSource: null,
        chapterId: null,
        chapterIdSource: null,
        chapterIdStatus: "missing",
        chapterFrameId: null,
        chapterFrameStatus: "missing",
        evidence: [],
        note: "当前页面地址无效，无法识别。",
        examLike: false,
        framesRead: 0
      };
    }

    if (!urlInfo.isChaoxing) {
      return {
        isChaoxing: false,
        host: urlInfo.host,
        pageType: "notChaoxing",
        label: PAGE_LABELS.notChaoxing,
        confidence: "none",
        courseName: null,
        courseNameSource: null,
        chapterName: null,
        chapterNameSource: null,
        chapterId: null,
        chapterIdSource: null,
        chapterIdStatus: "missing",
        chapterFrameId: null,
        chapterFrameStatus: "missing",
        evidence: [`当前域名 ${urlInfo.host} 不属于学习通`],
        note: "本扩展只识别学习通（chaoxing.com）课程页面。",
        examLike: false,
        framesRead: 0
      };
    }

    const frames = Array.isArray(data.frames)
      ? data.frames.filter((frame) => frame && typeof frame === "object")
      : [];

    const detection = detectPageType(urlInfo, frames, data.title);
    const course = detectCourseName(data.title, frames, detection.pageType);
    const chapter = detectChapterName(frames, course.name);

    return {
      isChaoxing: true,
      host: urlInfo.host,
      pageType: detection.pageType,
      label: detection.label,
      confidence: detection.confidence,
      courseName: course.name,
      courseNameSource: course.source,
      chapterName: chapter.name,
      chapterNameSource: chapter.source,
      chapterId: chapter.chapterId || null,
      chapterIdSource: chapter.chapterIdSource || null,
      chapterIdStatus: chapter.chapterIdStatus || "missing",
      chapterFrameId:
        typeof chapter.chapterFrameId === "number"
          ? chapter.chapterFrameId
          : null,
      chapterFrameStatus: chapter.chapterFrameStatus || "missing",
      parentChapterName: chapter.parentName || null,
      parentChapterNameSource: chapter.parentName ? "课程目录" : null,
      evidence: detection.evidence,
      note: detection.note,
      examLike: detection.examLike,
      framesRead: frames.length
    };
  }

  const api = {
    classify,
    isChaoxingHost,
    PAGE_LABELS
  };

  root.ChaoxingClassifier = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
