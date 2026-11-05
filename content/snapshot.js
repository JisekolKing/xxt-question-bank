"use strict";

/**
 * 学习通课程题库助手 · 页面快照脚本
 *
 * 这个文件只做一件事：在用户点击「识别当前页面」后，读取当前页面里
 * **肉眼可见**的少量结构信息，交给弹窗判断页面类型和课程名称。
 *
 * 明确不读取：
 *   - Cookie、localStorage、账号密码、登录令牌；
 *   - 表单输入值、题目答案、隐藏元素；
 *   - 整个页面的正文。
 *
 * 注意：本函数会被 chrome.scripting.executeScript({ func }) 序列化后注入页面，
 * 因此函数内部必须自包含，不能引用本文件之外的变量或函数。
 */

globalThis.collectPageSnapshot = function collectPageSnapshot() {
  "use strict";

  const MAX_TEXT_LENGTH = 120;
  const MAX_HEADINGS = 15;
  const MAX_BREADCRUMBS = 12;
  const MAX_COURSE_CANDIDATES = 8;
  const MAX_COURSE_LINKS = 20;

  /** 合并空白并截断，避免把大段文本带回弹窗。 */
  function clean(value, limit) {
    const maxLength = limit || MAX_TEXT_LENGTH;
    const text = String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
    return text.length > maxLength ? text.slice(0, maxLength) : text;
  }

  /** 判断元素是否真的在页面上可见（排除隐藏、透明、零尺寸元素）。 */
  function isVisible(element) {
    if (!element || !element.isConnected) {
      return false;
    }
    if (element.getAttribute("aria-hidden") === "true") {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (!style) {
      return false;
    }
    if (style.visibility === "hidden" || style.display === "none") {
      return false;
    }
    if (style.opacity === "0") {
      return false;
    }

    return true;
  }

  // ---------- 1. 可见标题（标题里常包含“章节测验”“随堂练习”等线索） ----------

  const headings = [];
  const headingNodes = document.querySelectorAll(
    "h1, h2, h3, [role='heading']"
  );

  for (const node of headingNodes) {
    if (headings.length >= MAX_HEADINGS) {
      break;
    }
    if (!isVisible(node)) {
      continue;
    }

    const text = clean(node.innerText, 100);
    if (text.length < 2) {
      continue;
    }
    if (headings.some((item) => item.text === text)) {
      continue;
    }

    headings.push({
      tag: node.tagName.toLowerCase(),
      text
    });
  }

  // ---------- 2. 可见面包屑 / 位置导航（通常含课程名） ----------

  const breadcrumbSelectors = [
    "#breadcrumb",
    ".breadcrumb",
    ".breadcrumbs",
    ".crumbs",
    "[class*='breadcrumb']",
    "[class*='crumb']",
    "#position",
    ".current-position"
  ];

  const breadcrumbs = [];

  for (const selector of breadcrumbSelectors) {
    let nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (error) {
      continue;
    }

    for (const node of nodes) {
      if (breadcrumbs.length >= MAX_BREADCRUMBS) {
        break;
      }
      if (!isVisible(node)) {
        continue;
      }

      const links = node.querySelectorAll("a");
      const pieces = [];

      if (links.length > 0) {
        links.forEach((link) => {
          if (!isVisible(link)) {
            return;
          }
          const text = clean(link.innerText, 80);
          if (text.length >= 2) {
            pieces.push({ text, href: link.href || "" });
          }
        });
      } else {
        const text = clean(node.innerText, 160);
        if (text.length >= 2) {
          pieces.push({ text, href: "" });
        }
      }

      for (const piece of pieces) {
        if (breadcrumbs.length >= MAX_BREADCRUMBS) {
          break;
        }
        if (breadcrumbs.some((item) => item.text === piece.text)) {
          continue;
        }
        breadcrumbs.push(piece);
      }
    }
  }

  // ---------- 3. 可见的课程名称元素（按常见 class / id 查找） ----------

  const courseSelectors = [
    ".courseName",
    "#courseName",
    ".course-name",
    ".course_name",
    ".courseTitle",
    ".course-title",
    ".course_title",
    "[class*='courseName']",
    "[class*='course-name']"
  ];

  const courseCandidates = [];

  for (const selector of courseSelectors) {
    let nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (error) {
      continue;
    }

    for (const node of nodes) {
      if (courseCandidates.length >= MAX_COURSE_CANDIDATES) {
        break;
      }
      if (!isVisible(node)) {
        continue;
      }

      const text = clean(node.innerText, 80);
      if (text.length < 2) {
        continue;
      }
      if (courseCandidates.some((item) => item.text === text)) {
        continue;
      }

      courseCandidates.push({
        text,
        source: "selector",
        hint: selector,
        href:
          typeof node.closest === "function" && node.closest("a[href]")
            ? node.closest("a[href]").href || ""
            : ""
      });
    }
  }

  // ---------- 3b. 可见课程链接（只读文本和正常 href，用于可选 courseId） ----------

  const courseLinks = [];
  const linkNodes = document.querySelectorAll("a[href]");

  for (const link of linkNodes) {
    if (courseLinks.length >= MAX_COURSE_LINKS) {
      break;
    }
    if (!isVisible(link)) {
      continue;
    }

    const href = link.href || link.getAttribute("href") || "";
    if (!/courseid=/i.test(href)) {
      continue;
    }

    const text = clean(link.innerText, 80);
    if (text.length < 2) {
      continue;
    }
    if (
      courseLinks.some(
        (item) => item.text === text && item.href === href
      )
    ) {
      continue;
    }

    courseLinks.push({ text, href });
  }

  // ---------- 4. 可见的章节名称元素（如果页面提供） ----------

  const chapterSelectors = [
    ".ceyan_name h3",
    ".chapterText",
    "#chapterText",
    ".chapter-title",
    ".chapterTitle",
    ".chapterName",
    ".chapter-name",
    ".chapter_name",
    "#chapterName",
    "[class*='chapterName']",
    "[class*='chapter-title']",
    ".nodeTitle",
    ".node-title",
    ".section-title"
  ];

  const chapterCandidates = [];

  for (const selector of chapterSelectors) {
    let nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (error) {
      continue;
    }

    for (const node of nodes) {
      if (chapterCandidates.length >= 6) {
        break;
      }
      if (!isVisible(node)) {
        continue;
      }

      const rawText = String(node.innerText == null ? "" : node.innerText)
        .replace(/\s+/g, " ")
        .trim();
      if (rawText.length < 2 || rawText.length > 80) {
        continue;
      }
      const text = rawText;
      if (chapterCandidates.some((item) => item.text === text)) {
        continue;
      }

      chapterCandidates.push({
        text,
        source: "selector",
        hint: selector
      });
    }
  }

  // ---------- 4b. 课程学习页目录（#coursetree） ----------

  function extractCatalog() {
    const tree = document.querySelector("#coursetree");
    if (!tree || !isVisible(tree)) {
      return null;
    }

    const selectedNodes = Array.from(
      tree.querySelectorAll(".posCatalog_select.posCatalog_active")
    ).filter(isVisible);

    // 没有选中项，或存在多个可见选中项时，不猜测当前章节。
    if (selectedNodes.length !== 1) {
      return null;
    }

    const selected = selectedNodes[0];
    const nameElement =
      selected.querySelector(".posCatalog_name") ||
      selected.querySelector(".posCatalog_title");
    const chapterName = clean(
      nameElement
        ? nameElement.getAttribute("title") || nameElement.innerText
        : selected.innerText,
      120
    );
    if (chapterName.length < 2) {
      return null;
    }

    // 只使用选中节点自身的 id；真实页面已验证该 id 在 selected 上。
    // 不根据章节名称生成 id，也不读取父级 LI 的 id。
    const chapterId = String(selected.getAttribute("id") || "").trim() || null;

    let parentChapterName = null;
    if (!selected.classList.contains("firstLayer")) {
      const level = selected.closest(".posCatalog_level");
      const parentLi = level && level.parentElement;
      if (parentLi) {
        const firstLayer = Array.from(parentLi.children).find(
          (child) =>
            child.classList &&
            child.classList.contains("posCatalog_select") &&
            child.classList.contains("firstLayer")
        );
        const parentTitle =
          firstLayer && firstLayer.querySelector(".posCatalog_title");
        const parentText = clean(
          parentTitle ? parentTitle.innerText : "",
          120
        );
        if (parentText.length >= 2) {
          parentChapterName = parentText;
        }
      }
    }

    return {
      chapterName,
      parentChapterName,
      chapterId,
      chapterIdSource: chapterId ? "coursetree" : null,
      chapterIdStatus: chapterId ? "stable" : "missing",
      source: "coursetree"
    };
  }

  const catalog = extractCatalog();

  // ---------- 4c. 作业页标题（作为作业分类名） ----------

  function extractWorkTitle() {
    const selectors = [
      ".page-title",
      ".mark_title",
      ".work-title",
      ".exam-title",
      "[class*='workTitle']",
      "[class*='work_title']",
      "h1"
    ];
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        if (!isVisible(node)) continue;
        const title = clean(
          String(node.innerText == null ? "" : node.innerText).replace(
            /^(?:作业标题|作业名称)\s*[:：]\s*/,
            ""
          ),
          120
        );
        if (title.length >= 2) {
          if (
            /^(?:作业详情|作业|作业标题|作业名称|考试详情|考试|测验详情)$/.test(
              title
            )
          ) {
            continue;
          }
          return {
            text: title,
            selector
          };
        }
      }
    }
    return null;
  }

  const workTitle = extractWorkTitle();

  return {
    url: location.href,
    title: clean(document.title, 160),
    headings,
    breadcrumbs,
    courseCandidates,
    courseLinks,
    chapterCandidates,
    workTitle: workTitle ? workTitle.text : null,
    workTitleHint: workTitle ? workTitle.selector : null,
    catalog
  };
};
