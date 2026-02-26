console.log("🚀 UoPeople Sync Engine: v2.0 Reading Fix Active");

// ─────────────────────────────────────────────
// 工具函式
// ─────────────────────────────────────────────

// 清理表格字元（避免 Markdown 表格破版）
const cleanMD = (text) =>
    text ? text.replace(/\|/g, "\\|").replace(/\n|\r/g, " ").trim() : "N/A";

// 取得元素的文字（相容 DOMParser 離線文件，innerText 在離線文件中無效）
const getText = (el) => (el ? (el.innerText || el.textContent || "").trim() : "");

// 將相對路徑轉換為絕對路徑（DOMParser 不會自動處理）
function resolveUrl(href, baseUrl) {
    try {
        return new URL(href, baseUrl).href;
    } catch {
        return href;
    }
}

// ─────────────────────────────────────────────
// Helper: walk next siblings to find a UL or OL
// ─────────────────────────────────────────────
function findNextListSibling(el) {
    let sib = el?.nextElementSibling;
    let steps = 0;
    while (sib && steps < 5) {
        const tag = sib.tagName.toUpperCase();
        if (tag === "UL" || tag === "OL") return sib;
        const sibText = (sib.textContent || "").trim();
        if (sibText.length > 0 && !["BR", "HR"].includes(tag)) break;
        sib = sib.nextElementSibling;
        steps++;
    }
    return null;
}

// ─────────────────────────────────────────────
// 在 DOMParser 離線文件中找出特定標題後的列表項目
// 支援：<ul>/<ol> 列表、純 <p> 段落列表、文字 regex 三種格式
// ─────────────────────────────────────────────
function extractListFromOfflineDoc(containerEl, headingPattern) {
    if (!containerEl) return [];

    // ── Strategy A: scan all elements sequentially (state machine) ──
    // Handles both <li> items AND <p> paragraphs after a matching heading.
    // Stops when it hits a new heading that does NOT match the pattern.
    const all = Array.from(containerEl.querySelectorAll(
        "h1,h2,h3,h4,h5,h6,p,li,strong,b"
    ));
    let capturing = false;
    const items = [];

    for (const el of all) {
        // Skip elements nested inside a <li> that aren’t themselves a <li>
        // (avoids false positives from inline spans/strongs inside list items)
        const tag = el.tagName.toUpperCase();
        if (tag !== "LI" && el.closest("li")) continue;

        const text = (el.textContent || "").trim();
        if (!text) continue;

        // Is this element a heading-like element?
        const isHeadingTag = ["H1", "H2", "H3", "H4", "H5", "H6"].includes(tag);
        const isInlineLabel = ["STRONG", "B"].includes(tag) && text.length <= 100 && !el.closest("li");
        const isPLabel = tag === "P" && text.length <= 120 && !el.closest("li");
        const isHeading = isHeadingTag || isInlineLabel || isPLabel;

        if (isHeading) {
            if (headingPattern.test(text)) {
                // Start capturing after this heading
                capturing = true;
                items.length = 0; // reset in case we had a false match earlier
                continue;
            } else if (capturing && (isHeadingTag || isInlineLabel)) {
                // Hit a DIFFERENT proper heading while capturing → stop
                break;
            }
        }

        if (!capturing) continue;

        // Collect list items
        if (tag === "LI") {
            const clone = el.cloneNode(true);
            clone.querySelectorAll("ul,ol").forEach(n => n.remove());
            const t = (clone.textContent || "").trim().replace(/^[\u2022\-\*]\s*/, "");
            if (t.length > 3) items.push(t);
        }
        // Also collect short <p> tags that look like list entries
        else if (tag === "P" && !isHeading) {
            // Only if it isn’t a known section-header pattern
            if (text.length > 3 && text.length < 300 &&
                !headingPattern.test(text) &&
                !/^(topics?|learning\s+outcomes?|by\s+the\s+end)/i.test(text)) {
                items.push(text.replace(/^[\u2022\-\*\d\.\)]\s*/, ""));
            }
        }
    }
    if (items.length > 0) return items;

    // ── Strategy B: heading → next sibling UL/OL ──
    const candidates = Array.from(
        containerEl.querySelectorAll("h1,h2,h3,h4,h5,h6,p,strong,b")
    );
    for (const el of candidates) {
        const elText = (el.textContent || "").trim();
        if (elText.length > 120 || !headingPattern.test(elText)) continue;
        if (el.closest("li")) continue;

        const list = findNextListSibling(el) || findNextListSibling(el.parentElement);
        if (list) {
            const listItems = Array.from(list.querySelectorAll(":scope > li"))
                .map(li => {
                    const clone = li.cloneNode(true);
                    clone.querySelectorAll("ul,ol").forEach(n => n.remove());
                    return (clone.textContent || "").trim();
                })
                .filter(t => t.length > 3);
            if (listItems.length > 0) return listItems;
        }
    }

    // ── Strategy C: regex on plain text ──
    const fullText = containerEl.textContent || "";
    const match = fullText.match(
        new RegExp(headingPattern.source + "[s]?\\s*[:\\n]?([\\s\\S]{0,800})", "i")
    );
    if (match) {
        const extracted = match[1]
            .split(/\n/)
            .map(l => l.replace(/^[\u2022\-\*\d\.\)]\s*/, "").trim())
            .filter(l => l.length > 5 && !/^(topics?|learning|outcome|by\s+the\s+end)/i.test(l))
            .slice(0, 10);
        if (extracted.length > 0) return extracted;
    }

    return [];
}

// ─────────────────────────────────────────────
// 判斷是否為 Reading Assignment 類型的頁面
// ─────────────────────────────────────────────
function isReadingAssignmentPage(title, url) {
    const titleLower = title.toLowerCase();
    const isBookModule = url.includes("/mod/book/");
    const isReadingTitle =
        titleLower.includes("reading") ||
        titleLower.includes("learning guide") ||
        titleLower.includes("study guide") ||
        titleLower.includes("textbook") ||
        titleLower.includes("resource");
    return isBookModule || isReadingTitle;
}

// ─────────────────────────────────────────────
// 抓取 Book/Reading Assignment 頁面內容
// ─────────────────────────────────────────────
async function fetchReadingPage(bookUrl) {
    try {
        const res = await fetch(bookUrl, { credentials: "include" });
        if (!res.ok) return `❌ 無法存取頁面 (HTTP ${res.status})`;
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        // ── Step 1：在目錄 (TOC) 中尋找 "Reading Assignment" 的章節連結 ──
        const tocSelectors = [
            ".book_toc a",
            ".list-group-item a",
            ".doublenav a",
            "#page-content a",
            ".chapter a",
        ];
        const tocLinks = Array.from(
            doc.querySelectorAll(tocSelectors.join(", "))
        );

        // 找到符合 "Reading Assignment" 的章節頁連結
        const targetLink = tocLinks.find((a) => {
            const text = getText(a);
            return /Reading\s*Assignment/i.test(text);
        });

        let finalDoc = doc;
        let finalUrl = bookUrl;

        if (targetLink) {
            const rawHref = targetLink.getAttribute("href") || "";
            const chapterUrl = resolveUrl(rawHref, bookUrl);
            console.log("📖 找到 Reading Assignment 章節:", chapterUrl);
            const res2 = await fetch(chapterUrl, { credentials: "include" });
            if (res2.ok) {
                const html2 = await res2.text();
                finalDoc = new DOMParser().parseFromString(html2, "text/html");
                finalUrl = chapterUrl;
            }
        } else {
            // 嘗試尋找「第一章」或書中所有章節，選取含有 reading 字樣最多的那頁
            console.log("⚠️ TOC 中未找到 Reading Assignment，嘗試掃描所有章節...");
            const allChapters = Array.from(
                doc.querySelectorAll(".book_toc a, .chapter a, .list-group-item a")
            );
            for (const ch of allChapters) {
                const rawHref = ch.getAttribute("href") || "";
                if (!rawHref) continue;
                const chUrl = resolveUrl(rawHref, bookUrl);
                try {
                    const r = await fetch(chUrl, { credentials: "include" });
                    if (!r.ok) continue;
                    const h = await r.text();
                    const d = new DOMParser().parseFromString(h, "text/html");
                    const content = d.querySelector(
                        ".book_content, .no-overflow, .generalbox"
                    );
                    if (content) {
                        const contentText = getText(content);
                        if (/reading/i.test(contentText) && contentText.length > 100) {
                            finalDoc = d;
                            finalUrl = chUrl;
                            break;
                        }
                    }
                } catch {
                    continue;
                }
            }
        }

        // ── Step 2：鎖定內容區域 ──
        const contentSelectors = [
            ".book_content",
            ".no-overflow",
            ".generalbox",
            "#page-content",
            ".box.py-3",
            "main",
        ];
        let contentArea = null;
        for (const sel of contentSelectors) {
            contentArea = finalDoc.querySelector(sel);
            if (contentArea) break;
        }
        if (!contentArea) contentArea = finalDoc.body;

        // ── Step 3：抓取超連結（教材連結）+ 影片連結 ──

        // 判斷連結是否為影片平台
        const isVideoUrl = (url) =>
            /youtube\.com|youtu\.be|kaltura|kaf\.|vimeo\.com|loom\.com|wistia\.com|brightcove|mediasite|panopto|ted\.com\/talks/i.test(url);

        // 判斷 iframe src 是否為影片嵌入
        const isVideoEmbed = (src) =>
            /youtube\.com\/embed|youtu\.be|player\.vimeo|kaltura|kaf\.|panopto|loom\.com\/embed|brightcove/i.test(src);

        // 將 YouTube embed URL 轉換為可觀看的完整 URL
        const normalizeVideoUrl = (src) => {
            const ytEmbed = src.match(/youtube\.com\/embed\/([A-Za-z0-9_-]+)/);
            if (ytEmbed) return `https://www.youtube.com/watch?v=${ytEmbed[1]}`;
            const kaftEmbed = src.match(/youtu\.be\/([A-Za-z0-9_-]+)/);
            if (kaftEmbed) return `https://www.youtube.com/watch?v=${kaftEmbed[1]}`;
            return src.split("?")[0]; // strip query params for cleaner URL
        };

        const entries = [];
        const seenHrefs = new Set();

        // 3a. 一般 <a> 超連結
        Array.from(contentArea.querySelectorAll("a")).forEach((a) => {
            const text = getText(a).trim();
            const href = resolveUrl(a.getAttribute("href") || "", finalUrl);
            if (!href.startsWith("http")) return;
            if (href.includes("/mod/book") || href.includes("javascript:")) return;
            if (text.length < 2) return;
            if (seenHrefs.has(href)) return;
            seenHrefs.add(href);
            const icon = isVideoUrl(href) ? "🎥" : "📄";
            entries.push(`- ${icon} [${text}](${href})`);
        });

        // 3b. <iframe> 嵌入影片（YouTube、Kaltura、Vimeo 等）
        Array.from(contentArea.querySelectorAll("iframe")).forEach((iframe) => {
            const src = iframe.getAttribute("src") || iframe.getAttribute("data-src") || "";
            const fullSrc = resolveUrl(src, finalUrl);
            if (!fullSrc.startsWith("http")) return;
            if (!isVideoEmbed(fullSrc)) return;
            if (seenHrefs.has(fullSrc)) return;
            seenHrefs.add(fullSrc);
            const watchUrl = normalizeVideoUrl(fullSrc);
            const titleAttr = iframe.getAttribute("title") || iframe.getAttribute("name") || "";
            const label = titleAttr.trim() || "Embedded Video";
            entries.push(`- 🎥 [${label}](${watchUrl})`);
        });

        // 3c. <video> 或 <source> 直連影片檔
        Array.from(contentArea.querySelectorAll("video, video source")).forEach((el) => {
            const src = el.getAttribute("src") || "";
            const fullSrc = resolveUrl(src, finalUrl);
            if (!fullSrc.startsWith("http") || seenHrefs.has(fullSrc)) return;
            seenHrefs.add(fullSrc);
            const label = el.closest("[title]")?.getAttribute("title") || "Video";
            entries.push(`- 🎥 [${label}](${fullSrc})`);
        });

        if (entries.length > 0) {
            return `#### 📚 Reading Assignment List\n${entries.join("\n")}`;
        }

        // ── Step 4：無連結時，抓取純文字內容 ──
        const textContent = getText(contentArea).substring(0, 800);
        if (textContent.length > 20) {
            return `#### 📖 Reading Assignment Text\n> ${textContent.replace(
                /\n/g,
                "\n> "
            )}`;
        }

        return "⚠️ 找到了頁面但內容為空，可能需要登入後才能存取。";
    } catch (e) {
        console.error("fetchReadingPage error:", e);
        return `❌ 無法讀取 Reading Assignment 內容：${e.message}`;
    }
}

// ─────────────────────────────────────────────
// 從 Learning Guide 的 Overview 章節抓取 Topics + Learning Outcomes
// ─────────────────────────────────────────────
async function fetchOverviewMetadata(bookUrl) {
    try {
        const baseUrl = bookUrl.replace(/([&?])chapterid=\d+/i, "");

        // 選取書本內容區域 (by priority, 避免拹到 navbar)
        const CONTENT_SELECTORS = [
            "#region-main .book_content",
            ".book_content",
            "#region-main article",
            "#region-main [role='main']",
            "#region-main",
        ];

        // ─── Post-process helper ─────────────────────────────────────
        // 1. Stop when hitting a "Tasks / Checklist" section
        // 2. Split merged LO sentences at ". " boundaries
        // 3. Deduplicate
        const STOP_PATTERNS = /^(tasks?|checklist|activ|note|important|prerequisite|resource)[\s:]*$/i;
        const TASK_ITEM_SUFFIX = /^(read\s+through|complete\s+and|take\s+and|submit\s+the|log\s+on|watch\s+the|post\s+your|respond\s+to)/i;
        const cleanExtracted = (items, splitSentences) => {
            const result = [];
            for (const raw of items) {
                const item = raw.trim();
                if (!item || item.length < 4) continue;
                if (STOP_PATTERNS.test(item) || TASK_ITEM_SUFFIX.test(item)) break;
                if (splitSentences && item.length > 100) {
                    const parts = item.split(/\.\s+(?=[A-Z][a-z])/);
                    if (parts.length > 1) {
                        parts.forEach(p => {
                            const c = p.replace(/\.\s*$/, "").trim();
                            if (c.length > 8) result.push(c);
                        });
                        continue;
                    }
                }
                result.push(item);
            }
            return [...new Set(result)];
        };

        const fetchAndParse = async (url) => {
            const r = await fetch(url, { credentials: "include" });
            if (!r.ok) return null;
            const html = await r.text();
            const d = new DOMParser().parseFromString(html, "text/html");

            let content = null;
            for (const sel of CONTENT_SELECTORS) {
                const el = d.querySelector(sel);
                if (el && (el.textContent || "").trim().length > 50) { content = el; break; }
            }
            if (!content) content = d.body;

            const pageTitle = getText(d.querySelector("h1, h2, .page-header-headings"));
            console.log(`📊 [Overview] URL: ${url}`);
            console.log(`📊 [Overview] Title: "${pageTitle}" | Selector: ${content === d.body ? "body" : CONTENT_SELECTORS.find(s => d.querySelector(s) === content) || "?"}`);
            console.log(`📊 [Overview] innerHTML (800): ${(content.innerHTML || "").substring(0, 800)}`);

            const topics = cleanExtracted(extractListFromOfflineDoc(content, /topics?/i), false);
            const outcomes = cleanExtracted(extractListFromOfflineDoc(content, /learning\s+outcomes?/i), true);

            console.log(`📊 [Overview] Topics (clean): [${topics.join(" | ")}]`);
            console.log(`📊 [Overview] Outcomes (clean): [${outcomes.join(" | ")}]`);

            return { topics, outcomes, doc: d };
        };

        // ① 先試書本起始頁
        const base = await fetchAndParse(baseUrl);
        if (!base) return { topics: [], outcomes: [] };
        if (base.topics.length > 0 || base.outcomes.length > 0) {
            return { topics: base.topics, outcomes: base.outcomes };
        }

        // ② 從 doc 中找所有含 chapterid=... 的 <a> 連結（書本章節指定樣式）
        const chapLinks = Array.from(base.doc.querySelectorAll("a[href*='chapterid']"));
        console.log(`📊 [Overview] Book chapter links: ${chapLinks.map(a => `"${a.textContent.trim()}"→${a.getAttribute('href')}`).join(" | ")}`);

        // 尋找 Overview 或 Introduction 章節
        const chapLink =
            chapLinks.find(a => /^overview$/i.test(a.textContent.trim())) ||
            chapLinks.find(a => /overview/i.test(a.textContent)) ||
            chapLinks.find(a => /introduction/i.test(a.textContent)) ||
            chapLinks[0];

        if (chapLink) {
            const chUrl = resolveUrl(chapLink.getAttribute("href") || "", baseUrl);
            if (chUrl !== baseUrl) {
                const ch = await fetchAndParse(chUrl);
                if (ch) return { topics: ch.topics, outcomes: ch.outcomes };
            }
        }

        return { topics: [], outcomes: [] };
    } catch (e) {
        console.warn("fetchOverviewMetadata error:", e.message);
        return { topics: [], outcomes: [] };
    }
}

// ─────────────────────────────────────────────
// 抓取任務詳情（深度抓取）
// ─────────────────────────────────────────────
async function fetchDeepDetail(url, title) {
    try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return { detail: `❌ 無法存取 (HTTP ${res.status})`, deadline: "N/A", topics: [], outcomes: [] };
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        // ── 解析 Due Date ──
        const bodyText = getText(doc.body);
        const dateRegex =
            /Due:\s+[A-Za-z]+,\s+\d{1,2}\s+[A-Za-z]+\s+\d{4},\s+\d{1,2}:\d{2}\s+(?:AM|PM)/i;
        const deadlineMatch = bodyText.match(dateRegex);
        const deadline = deadlineMatch
            ? deadlineMatch[0].replace(/Due:/i, "").trim()
            : "N/A";

        let detail = "";
        let topics = [];
        let outcomes = [];

        // ── 判斷是否為 Reading Assignment / Learning Guide 類型 ──
        if (isReadingAssignmentPage(title, url)) {
            console.log(`📖 識別為 Reading 類型：${title}`);
            // 並行抓取：Reading 連結清單 + Overview 的 Topics/Outcomes
            const [readingDetail, overviewMeta] = await Promise.all([
                fetchReadingPage(url),
                fetchOverviewMetadata(url),
            ]);
            detail = readingDetail;
            topics = overviewMeta.topics;
            outcomes = overviewMeta.outcomes;
        } else {
            // 一般任務（Discussion、Assignment 等）
            const bodySelectors = [
                ".post-content", "#intro", ".no-overflow",
                ".generalbox", ".page-content", ".box.py-3",
            ];
            let bodyEl = null;
            for (const sel of bodySelectors) {
                bodyEl = doc.querySelector(sel);
                if (bodyEl) break;
            }
            const rawText = bodyEl ? getText(bodyEl).substring(0, 600) : "No content";
            detail = `> ${rawText.replace(/\n/g, "\n> ")}`;
        }

        return { detail, deadline, topics, outcomes };
    } catch (e) {
        console.error("fetchDeepDetail error:", e);
        return { detail: `❌ Fetch failed: ${e.message}`, deadline: "N/A", topics: [], outcomes: [] };
    }
}

// ─────────────────────────────────────────────
// Extract list items that appear after a heading matching a pattern
// Works on live DOM elements (innerText is available here)
// ─────────────────────────────────────────────
function extractListAfterHeading(containerEl, headingPattern) {
    if (!containerEl) return [];
    const items = [];
    let capturing = false;

    // Walk all child nodes in order
    const walker = document.createTreeWalker(
        containerEl,
        NodeFilter.SHOW_ELEMENT,
        null
    );

    let node = walker.nextNode();
    while (node) {
        const tag = node.tagName.toUpperCase();
        const text = (node.innerText || node.textContent || "").trim();

        // Detect heading that matches our pattern
        if (["H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "B"].includes(tag)) {
            if (headingPattern.test(text)) {
                capturing = true;
                node = walker.nextNode();
                continue;
            } else if (capturing) {
                // Hit a different heading → stop
                break;
            }
        }

        // Also catch plain <p> or <div> acting as heading
        if (capturing && tag === "LI") {
            const li = text.replace(/^[•\-\*]\s*/, "").trim();
            if (li.length > 1) items.push(li);
        }

        node = walker.nextNode();
    }

    // Fallback: if no <li> found, try splitting plain text after the heading keyword
    if (items.length === 0 && containerEl.innerText) {
        const fullText = containerEl.innerText;
        const match = fullText.match(new RegExp(headingPattern.source + "[s]?\\s*[:\\n]([\\s\\S]{0,600})", "i"));
        if (match) {
            match[1]
                .split(/\n/)
                .map(l => l.replace(/^[•\-\*\d\.\)]\s*/, "").trim())
                .filter(l => l.length > 3 && !/^(topic|learning|outcome)/i.test(l))
                .slice(0, 8)
                .forEach(l => items.push(l));
        }
    }

    return items;
}

// ─────────────────────────────────────────────
// Chrome Extension Message Listener
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "ping") {
        sendResponse({ status: "ready" });
    } else if (msg.action === "scanPage") {
        (async () => {
            // ── 取得課程名稱 ──
            const courseName =
                document.querySelector("h1")?.innerText.trim() || document.title;

            // ── 建立 Unit ID → 名稱 + Topics + Learning Outcomes 的對應 ──
            const unitMap = {};
            document
                .querySelectorAll("li.section, section.section")
                .forEach((sec) => {
                    const nameEl = sec.querySelector(
                        ".sectionname, h3, .courseindex-link"
                    );
                    const txt = nameEl?.innerText.trim();
                    if (!sec.id || !txt) return;

                    // Look for a summary / description block in the section
                    const summaryEl = sec.querySelector(
                        ".summarytext, .summary, div.summary, " +
                        ".course-section-summary, .no-overflow, .sectionbody"
                    );

                    const topics = extractListAfterHeading(summaryEl, /topics?/i);
                    const outcomes = extractListAfterHeading(summaryEl, /learning\s+outcomes?/i);

                    unitMap[sec.id] = {
                        name: cleanMD(txt.split("\n")[0]),
                        topics,
                        outcomes,
                    };
                });

            // ── 收集所有課程活動連結 ──
            const links = Array.from(
                document.querySelectorAll(
                    ".activityinstance a, .activity-item a, .aalink"
                )
            );
            const tasks = [];
            const seen = new Set();

            links.forEach((l) => {
                if (l.href.includes("/mod/") && !seen.has(l.href)) {
                    const t = l.innerText
                        .replace(/Mark as done|已完成/g, "")
                        .trim();
                    if (t.length < 3 || /Print|Next|Previous/i.test(t)) return;
                    seen.add(l.href);
                    const sec = l.closest("li.section, section.section");
                    tasks.push({
                        title: cleanMD(t),
                        url: l.href,
                        unitId: sec?.id,
                    });
                }
            });

            // ── 深度抓取每個任務，同時收集 Learning Guide 的 Topics/Outcomes ──
            const results = [];
            // 先複製主頁面 section summary 抓到的 unitDetails
            const enrichedUnitDetails = {};
            for (const [, data] of Object.entries(unitMap)) {
                if (typeof data === "object" && data.name) {
                    enrichedUnitDetails[data.name] = {
                        topics: data.topics || [],
                        outcomes: data.outcomes || [],
                    };
                }
            }

            for (const task of tasks) {
                console.log(`🔍 抓取：${task.title}`);
                const extra = await fetchDeepDetail(task.url, task.title);
                const unitData = unitMap[task.unitId] || { name: "General", topics: [], outcomes: [] };
                const unitName = typeof unitData === "string" ? unitData : unitData.name;

                // 如果 Learning Guide 的 Overview 回傳了 Topics/Outcomes，
                // 用它來補強（或覆蓋）該週的 unitDetails
                if (extra.topics?.length > 0 || extra.outcomes?.length > 0) {
                    if (!enrichedUnitDetails[unitName]) {
                        enrichedUnitDetails[unitName] = { topics: [], outcomes: [] };
                    }
                    if (extra.topics.length > 0)
                        enrichedUnitDetails[unitName].topics = extra.topics;
                    if (extra.outcomes.length > 0)
                        enrichedUnitDetails[unitName].outcomes = extra.outcomes;
                }

                results.push({
                    ...task,
                    detail: extra.detail,
                    deadline: extra.deadline,
                    unitTime: unitName,
                    type: task.url.includes("forum")
                        ? "Discussion"
                        : task.url.includes("assign")
                            ? "Assignment"
                            : task.url.includes("book")
                                ? "Reading"
                                : "Resource",
                });
            }

            sendResponse({
                action: "final",
                courseName: cleanMD(courseName),
                results,
                unitDetails: enrichedUnitDetails,
            });
        })();
        return true; // 保持非同步 channel 開啟
    }
});