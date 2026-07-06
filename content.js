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

// 將 HTML 元素轉換為帶有 Markdown 連結的乾淨文字，並過濾掉雜訊連結
function htmlToMarkdown(element, targetUrl) {
    if (!element) return "";
    if (typeof element === "string") return element;
    const clone = element.cloneNode(true);
    if (clone.querySelectorAll) {
        const links = clone.querySelectorAll("a");
        links.forEach((a) => {
            const text = (a.textContent || "").trim();
            const href = resolveUrl(a.getAttribute("href") || "", targetUrl);

            const noiseKeywords = [
                "UoPeople APA Tutorials",
                "Learning Resource Center",
                "Guidelines for Giving Meaningful Replies",
                "LIRN",
                "Tips for Searching LIRN"
            ];

            const isNoise = noiseKeywords.some(noise =>
                text.toLowerCase().includes(noise.toLowerCase()) ||
                href.toLowerCase().includes(noise.toLowerCase())
            );

            if (isNoise) {
                a.parentNode.removeChild(a);
            } else if (href && href.startsWith("http")) {
                const markdownLink = `[${text}](${href})`;
                const textNode = clone.ownerDocument.createTextNode(markdownLink);
                a.parentNode.replaceChild(textNode, a);
            } else {
                const textNode = clone.ownerDocument.createTextNode(text);
                a.parentNode.replaceChild(textNode, a);
            }
        });
    }
    return getText(clone);
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

function extractAllListsFromOfflineDoc(containerEl, headingPattern) {
    if (!containerEl) return [];

    const allItems = [];

    // ── Strategy A: scan all elements sequentially (state machine) ──
    const all = Array.from(containerEl.querySelectorAll(
        "h1,h2,h3,h4,h5,h6,p,li,strong,b"
    ));
    let capturing = false;
    let currentSectionItems = [];

    for (const el of all) {
        const tag = el.tagName.toUpperCase();
        if (tag !== "LI" && el.closest("li")) continue;

        const text = (el.textContent || "").trim();
        if (!text) continue;

        const isHeadingTag = ["H1", "H2", "H3", "H4", "H5", "H6"].includes(tag);
        const isInlineLabel = ["STRONG", "B"].includes(tag) && text.length <= 100 && !el.closest("li");
        const isPLabel = tag === "P" && text.length <= 120 && !el.closest("li");
        const isHeading = isHeadingTag || isInlineLabel || isPLabel;

        if (isHeading) {
            if (headingPattern.test(text)) {
                if (capturing && currentSectionItems.length > 0) {
                    allItems.push(...currentSectionItems);
                    currentSectionItems = [];
                }
                capturing = true;
                continue;
            } else if (capturing && (isHeadingTag || isInlineLabel)) {
                capturing = false;
                if (currentSectionItems.length > 0) {
                    allItems.push(...currentSectionItems);
                    currentSectionItems = [];
                }
            }
        }

        if (capturing) {
            if (tag === "LI") {
                const clone = el.cloneNode(true);
                clone.querySelectorAll("ul,ol").forEach(n => n.remove());
                const t = (clone.textContent || "").trim().replace(/^[\u2022\-\*]\s*/, "");
                if (t.length > 3) currentSectionItems.push(t);
            } else if (tag === "P" && !isHeading) {
                if (text.length > 3 && text.length < 300 &&
                    !headingPattern.test(text) &&
                    !/^(topics?|(?:learning\s+)?outcomes?|(?:learning\s+)?objectives?|goals?|by\s+the\s+end)/i.test(text)) {
                    currentSectionItems.push(text.replace(/^[\u2022\-\*\d\.\)]\s*/, ""));
                }
            }
        }
    }
    if (capturing && currentSectionItems.length > 0) {
        allItems.push(...currentSectionItems);
    }

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
            for (const item of listItems) {
                if (!allItems.includes(item)) {
                    allItems.push(item);
                }
            }
        }
    }

    // ── Strategy C: regex search on plain text (multiple matches) ──
    const fullText = containerEl.textContent || "";
    const regex = new RegExp("(?:" + headingPattern.source + ")[s]?\\s*[:\\n]?([\\s\\S]{0,800})", "gi");
    for (const match of fullText.matchAll(regex)) {
        if (match[1]) {
            const extracted = match[1]
                .split(/\n/)
                .map(l => l.replace(/^[\u2022\-\*\d\.\)]\s*/, "").trim())
                .filter(l => l.length > 5 && !/^(topics?|(?:learning\s+)?outcomes?|(?:learning\s+)?objectives?|goals?|by\s+the\s+end)/i.test(l))
                .slice(0, 10);
            for (const item of extracted) {
                if (!allItems.includes(item)) {
                    allItems.push(item);
                }
            }
        }
    }

    return [...new Set(allItems.map(i => i.trim()))].filter(i => i.length > 3);
}

// Extract all text under a specific heading until the next heading of equal or higher level
function extractSectionByHeading(containerEl, headingPattern) {
    if (!containerEl) return "";

    const all = Array.from(containerEl.querySelectorAll(
        "h1,h2,h3,h4,h5,h6,p,li,div,ul,ol"
    ));
    let capturing = false;
    let headingLevel = 9; // level of the matching heading (e.g. 3 for H3)
    const contentParts = [];

    for (const el of all) {
        const tag = el.tagName.toUpperCase();

        const match = tag.match(/^H([1-6])$/);
        if (match) {
            const currentLevel = parseInt(match[1], 10);
            const text = (el.textContent || "").trim();

            if (headingPattern.test(text)) {
                capturing = true;
                headingLevel = currentLevel;
                continue;
            } else if (capturing && currentLevel <= headingLevel) {
                break;
            }
        }

        if (capturing) {
            if (["P", "LI"].includes(tag)) {
                const text = (el.textContent || "").trim();
                if (text && !contentParts.includes(text)) {
                    contentParts.push(text);
                }
            }
        }
    }

    return contentParts.join("\n\n");
}

// ─────────────────────────────────────────────
// 判斷是否為 Reading Assignment 類型的頁面
// ─────────────────────────────────────────────
function isReadingAssignmentPage(title, url) {
    const titleLower = title.toLowerCase();
    const isBookModule = url.includes("/mod/book/");
    const isD2LContent = url.includes("/viewContent/") || url.includes("/lessons/") || url.includes("/content/");
    const isReadingTitle =
        titleLower.includes("reading") ||
        titleLower.includes("learning guide") ||
        titleLower.includes("study guide") ||
        titleLower.includes("textbook") ||
        titleLower.includes("resource") ||
        titleLower.includes("overview");
    return isBookModule || isD2LContent || isReadingTitle;
}

// 判斷連結是否為影片平台
const isVideoUrl = (url) =>
    /youtube\.com|youtu\.be|kaltura|kaf\.|vimeo\.com|loom\.com|wistia\.com|brightcove|mediasite|panopto|ted\.com\/talks/i.test(url);

// 判斷 iframe src 是否為影片嵌入
const isVideoEmbed = (src) =>
    /youtube\.com\/embed|youtu\.be|player\.vimeo|kaltura|kaf\.|panopto|loom\.com\/embed|brightcove/i.test(src);

const normalizeVideoUrl = (src) => {
    const ytEmbed = src.match(/youtube\.com\/embed\/([A-Za-z0-9_-]+)/);
    if (ytEmbed) return `https://www.youtube.com/watch?v=${ytEmbed[1]}`;
    const kaftEmbed = src.match(/youtu\.be\/([A-Za-z0-9_-]+)/);
    if (kaftEmbed) return `https://www.youtube.com/watch?v=${kaftEmbed[1]}`;
    return src.split("?")[0];
};

const extractFromDoc = (targetDoc, targetUrl, entries, seenHrefs) => {
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
        contentArea = targetDoc.querySelector(sel);
        if (contentArea) break;
    }
    if (!contentArea) contentArea = targetDoc.body;

    // 一般 <a> 超連結
    Array.from(contentArea.querySelectorAll("a")).forEach((a) => {
        const text = getText(a).trim();
        const href = resolveUrl(a.getAttribute("href") || "", targetUrl);
        if (!href.startsWith("http")) return;
        if (href.includes("/mod/book") || href.includes("javascript:")) return;
        if (text.length < 2) return;
        if (seenHrefs.has(href)) return;
        seenHrefs.add(href);
        const icon = isVideoUrl(href) ? "🎥" : "📄";
        entries.push(`- ${icon} [${text}](${href})`);
    });

    // <iframe> 嵌入影片
    Array.from(contentArea.querySelectorAll("iframe")).forEach((iframe) => {
        const src = iframe.getAttribute("src") || iframe.getAttribute("data-src") || "";
        const fullSrc = resolveUrl(src, targetUrl);
        if (!fullSrc.startsWith("http")) return;
        if (!isVideoEmbed(fullSrc)) return;
        if (seenHrefs.has(fullSrc)) return;
        seenHrefs.add(fullSrc);
        const watchUrl = normalizeVideoUrl(fullSrc);
        const titleAttr = iframe.getAttribute("title") || iframe.getAttribute("name") || "";
        const label = titleAttr.trim() || "Embedded Video";
        entries.push(`- 🎥 [${label}](${watchUrl})`);
    });

    // <video> 或 <source>
    Array.from(contentArea.querySelectorAll("video, video source")).forEach((el) => {
        const src = el.getAttribute("src") || "";
        const fullSrc = resolveUrl(src, targetUrl);
        if (!fullSrc.startsWith("http") || seenHrefs.has(fullSrc)) return;
        seenHrefs.add(fullSrc);
        const label = el.closest("[title]")?.getAttribute("title") || "Video";
        entries.push(`- 🎥 [${label}](${fullSrc})`);
    });
    
    return getText(contentArea).substring(0, 800);
};

// ─────────────────────────────────────────────
// 抓取 Book/Reading Assignment 頁面內容
// ─────────────────────────────────────────────
async function fetchReadingPage(bookUrl) {
    try {
        const res = await fetch(bookUrl, { credentials: "include" });
        if (!res.ok) return `❌ 無法存取頁面 (HTTP ${res.status})`;
        const html = await res.text();
        if (html.trimStart().startsWith('%PDF')) {
            return "%PDF [binary data skipped]";
        }
        const doc = new DOMParser().parseFromString(html, "text/html");

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

        const seenHrefs = new Set();
        const entries = [];
        let fallbackText = "";

        if (tocLinks.length === 0) {
            console.log("📄 D2L/Single page reading assignment detected. Extracting directly...");
            fallbackText = extractFromDoc(doc, bookUrl, entries, seenHrefs);
        } else {
            // 尋找傳統的 "Reading Assignment" 章節
            const readingLink = tocLinks.find((a) => /Reading\s*Assignment/i.test(getText(a)));

            if (readingLink) {
                const rawHref = readingLink.getAttribute("href") || "";
                const chapterUrl = resolveUrl(rawHref, bookUrl);
                console.log("📖 找到 Reading Assignment 章節:", chapterUrl);
                const res2 = await fetch(chapterUrl, { credentials: "include" });
                if (res2.ok) {
                    const html2 = await res2.text();
                    const finalDoc = new DOMParser().parseFromString(html2, "text/html");
                    fallbackText = extractFromDoc(finalDoc, chapterUrl, entries, seenHrefs);
                }
            } else {
                console.log("⚠️ TOC 中未找到單一的 Reading Assignment，掃描所有不屬於作業的章節...");
                
                // 被排除的關鍵字 (例如: Overview, Assignment, Discussion, Quiz, Journal, Checklist)
                const excludePattern = /^(overview|discussion\s+assignment|written\s+assignment|learning\s+journal|self-quiz|checklist|portfolio\s+activity|review\s+quiz|tasks?|class\s+introductions?)$/i;

                const allChapters = Array.from(doc.querySelectorAll(".book_toc a, .chapter a, .list-group-item a"));
                const uniqueChapters = [];
                const seenChapUrls = new Set();
                
                for (const ch of allChapters) {
                    const rawHref = ch.getAttribute("href") || "";
                    if (!rawHref) continue;
                    const url = resolveUrl(rawHref, bookUrl);
                    if (seenChapUrls.has(url)) continue;
                    seenChapUrls.add(url);
                    uniqueChapters.push({ el: ch, url });
                }

                for (const ch of uniqueChapters) {
                    const text = getText(ch.el).replace(/^\d+(\.\d+)*\s*/, "").trim(); // 移除章節編號 (如 1.2)
                    if (excludePattern.test(text)) {
                        console.log(`⏩ 跳過非閱讀章節: ${text}`);
                        continue;
                    }
                    
                    try {
                        const r = await fetch(ch.url, { credentials: "include" });
                        if (!r.ok) continue;
                        const h = await r.text();
                        const d = new DOMParser().parseFromString(h, "text/html");
                        const txt = extractFromDoc(d, ch.url, entries, seenHrefs);
                        if (!fallbackText) fallbackText = txt; // 只保留第一個有內容的作為 fallback text
                    } catch (e) {
                        console.warn(`Fetch error for chapter ${text}:`, e);
                    }
                }
            }
        }

        if (entries.length > 0) {
            return `#### 📚 Reading Assignment List\n${entries.join("\n")}`;
        }

        if (fallbackText && fallbackText.length > 20) {
            return `#### 📖 Reading Assignment Text\n> ${fallbackText.replace(/\n/g, "\n> ")}`;
        }

        return "⚠️ 找到了頁面但內容為空，可能需要登入後才能存取。";
    } catch (e) {
        console.error("fetchReadingPage error:", e);
        return `❌ 無法讀取 Reading Assignment 內容：${e.message}`;
    }
}

// ─── Post-process helper for extraction ─────────────────────────────
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

            const topics = cleanExtracted(extractAllListsFromOfflineDoc(content, /topics?/i), false);
            const outcomes = cleanExtracted(extractAllListsFromOfflineDoc(content, /(?:learning\s+)?outcomes?|(?:learning\s+)?objectives?|goals?/i), true);
            const reflectionQuestions = extractAllListsFromOfflineDoc(content, /reflection\s+questions?|questions?\s+(?:to\s+)?consider|think\s+about|key\s+questions?/i);

            console.log(`📊 [Overview] Topics (clean): [${topics.join(" | ")}]`);
            console.log(`📊 [Overview] Outcomes (clean): [${outcomes.join(" | ")}]`);
            console.log(`📊 [Overview] Reflection Questions: [${reflectionQuestions.join(" | ")}]`);

            return { topics, outcomes, reflectionQuestions, doc: d };
        };

        // ① 先試書本起始頁
        const base = await fetchAndParse(baseUrl);
        if (!base) return { topics: [], outcomes: [], reflectionQuestions: [] };
        if (base.topics.length > 0 || base.outcomes.length > 0) {
            return { topics: base.topics, outcomes: base.outcomes, reflectionQuestions: base.reflectionQuestions || [] };
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
                if (ch) return { topics: ch.topics, outcomes: ch.outcomes, reflectionQuestions: ch.reflectionQuestions || [] };
            }
        }

        return { topics: [], outcomes: [], reflectionQuestions: [] };
    } catch (e) {
        console.warn("fetchOverviewMetadata error:", e.message);
        return { topics: [], outcomes: [], reflectionQuestions: [] };
    }
}

// ─────────────────────────────────────────────
// 抓取任務詳情（深度抓取）
// ─────────────────────────────────────────────
async function fetchDeepDetail(url, title) {
    try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return { detail: `❌ 無法存取 (HTTP ${res.status})`, deadline: "N/A", topics: [], outcomes: [], discussionPrompt: "", assignmentInstructions: "", rubricText: null };
        const html = await res.text();
        if (html.trimStart().startsWith('%PDF')) {
            return { detail: "%PDF [binary data skipped]", deadline: "N/A", topics: [], outcomes: [], discussionPrompt: "", assignmentInstructions: "", rubricText: null };
        }
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
        let reflectionQuestions = [];
        let discussionPrompt = "";
        let assignmentInstructions = "";

        const isD2L = window.location.hostname.includes("learn.uopeople.edu");

        // ── 判斷是否為 Reading Assignment / Learning Guide 類型 ──
        if (isReadingAssignmentPage(title, url)) {
            console.log(`📖 識別為 Reading 類型：${title}`);
            if (isD2L) {
                const iframe = doc.querySelector('iframe.d2l-iframe, iframe[src*="/content/"], iframe[src*="/d2l/"]');
                let targetUrl = url;
                if (iframe) {
                    const src = iframe.getAttribute("src") || iframe.getAttribute("data-src") || "";
                    targetUrl = resolveUrl(src, url);
                    console.log(`📖 找到 D2L 閱讀文件 iframe 網址: ${targetUrl}`);
                }
                const readingDetail = await fetchReadingPage(targetUrl);
                const overviewMeta = await fetchOverviewMetadata(targetUrl);
                detail = readingDetail;
                topics = overviewMeta.topics;
                outcomes = overviewMeta.outcomes;
                reflectionQuestions = overviewMeta.reflectionQuestions || [];
            } else {
                // 並行抓取：Reading 連結清單 + Overview 的 Topics/Outcomes
                const [readingDetail, overviewMeta] = await Promise.all([
                    fetchReadingPage(url),
                    fetchOverviewMetadata(url),
                ]);
                detail = readingDetail;
                topics = overviewMeta.topics;
                outcomes = overviewMeta.outcomes;
                reflectionQuestions = overviewMeta.reflectionQuestions || [];
            }
        } else {
            // 一般任務（Discussion、Assignment 等）
            const bodySelectors = [
                ".post-content", "#intro", ".no-overflow",
                ".generalbox", ".page-content", ".box.py-3",
                ".d2l-htmlblock", ".d2l-htmlblock-untrusted", "#discussion-description",
            ];
            let bodyEl = null;
            for (const sel of bodySelectors) {
                bodyEl = doc.querySelector(sel);
                if (bodyEl) break;
            }
            const rawText = bodyEl ? htmlToMarkdown(bodyEl, url) : "No content";
            detail = rawText;

            if (url.includes("forum")) {
                discussionPrompt = rawText;
            } else if (url.includes("assign")) {
                assignmentInstructions = rawText;
            }
        }

        let rubricText = null;
        if (title.includes("Assignment Activity")) {
            try {
                const topicPageRes = await fetch(url, { credentials: "include" });
                if (topicPageRes.ok) {
                    const pageHtml = await topicPageRes.text();
                    const pageDoc = new DOMParser().parseFromString(pageHtml, "text/html");
                    const rubricSelectors = [
                        ".d2l-htmlblock-untrusted",
                        ".d2l-page-title",
                        '[data-rel="description"]',
                        ".d2l-le-itemsummary"
                    ];
                    let matchedEl = null;
                    for (const sel of rubricSelectors) {
                        matchedEl = pageDoc.querySelector(sel);
                        if (matchedEl && getText(matchedEl).trim().length > 0) {
                            break;
                        }
                    }
                    if (matchedEl) {
                        rubricText = htmlToMarkdown(matchedEl, url);
                    }
                }
            } catch (e) {
                console.warn(`Secondary fetch failed for ${title}:`, e);
            }
        }

        return { detail, deadline, topics, outcomes, reflectionQuestions, discussionPrompt, assignmentInstructions, rubricText };
    } catch (e) {
        console.error("fetchDeepDetail error:", e);
        return { detail: `❌ Fetch failed: ${e.message}`, deadline: "N/A", topics: [], outcomes: [], reflectionQuestions: [], discussionPrompt: "", assignmentInstructions: "", rubricText: null };
    }
}

// ─────────────────────────────────────────────
// Helper: walk DOM recursively including Shadow DOMs
// ─────────────────────────────────────────────
function* walkDomWithShadow(root = document.body) {
    if (!root) return;
    yield root;
    
    if (root.shadowRoot) {
        yield* walkDomWithShadow(root.shadowRoot);
    }
    
    let child = root.firstElementChild;
    while (child) {
        yield* walkDomWithShadow(child);
        child = child.nextElementSibling;
    }
}

// ─────────────────────────────────────────────
// Helper: Find deadline in container, climbing up through shadow boundaries
// ─────────────────────────────────────────────
function findDeadlineInContainer(el) {
    let parent = el;
    for (let i = 0; i < 4 && parent; i++) {
        const text = parent.innerText || parent.textContent || "";
        const match = text.match(/due:\s*([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}\s*(?:AM|PM))/i) ||
                      text.match(/due\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))/i) ||
                      text.match(/due:\s*([A-Za-z]{3}\s+\d{1,2},\s+\d{4})/i) ||
                      text.match(/due\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i) ||
                      text.match(/due\s+date:\s*([^\n]+)/i);
        if (match) {
            return match[1] || match[0];
        }
        parent = parent.parentElement || parent.getRootNode()?.host;
    }
    return "N/A";
}

// ─────────────────────────────────────────────
// Helper: Format D2L API Due Date
// ─────────────────────────────────────────────
function formatD2LDate(isoStr) {
    if (!isoStr) return "N/A";
    try {
        const date = new Date(isoStr);
        const options = { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true };
        return date.toLocaleString('en-US', options);
    } catch {
        return isoStr;
    }
}

async function parseSyllabusPDF(fileUrl) {
    try {
        const res = await fetch(fileUrl, { credentials: "include" });
        if (!res.ok) {
            return { success: false, error: `PDF下載失敗 (HTTP ${res.status})` };
        }
        const arrayBuffer = await res.arrayBuffer();

        // Use PDF.js to extract text
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        let fullText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            fullText += content.items.map(item => item.str).join(" ") + "\n";
        }

        // 透過 Port 長連線呼叫 background，避免 MV3 SW 被提前終止
        const response = await new Promise((resolve, reject) => {
            let settled = false;
            const port = chrome.runtime.connect({ name: "syllabus-parser" });
            port.onMessage.addListener((msg) => {
                if (settled) return;
                settled = true;
                port.disconnect();
                resolve(msg);
            });
            port.onDisconnect.addListener(() => {
                if (settled) return;
                settled = true;
                const err = chrome.runtime.lastError?.message || "Background port disconnected";
                reject(new Error(err));
            });
            port.postMessage({ action: "parseSyllabusPDF", text: fullText });
        });

        if (!response || !response.success) {
            return { success: false, error: response?.error || "背景服務未回應" };
        }
        return { success: true, data: response.data };
    } catch (e) {
        console.error("parseSyllabusPDF error:", e);
        return { success: false, error: e.message };
    }
}


// ─────────────────────────────────────────────
// Deep detail fetcher for D2L using Valence APIs
// ─────────────────────────────────────────────
async function fetchDeepDetailD2L(orgUnitId, topic, title, discussionMap, dropboxMap) {
    try {
        const ver = "1.60";
        const res = await fetch(`/d2l/api/le/${ver}/${orgUnitId}/content/topics/${topic.id}`, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // ── Syllabus 專屬處理：統一由 fetchAndParseSyllabusPDF 處理，回傳 syllabusBasis ──
        const isSyllabusTitle = /syllabus/i.test(title.trim()) && !/quiz|test|exam|forum|guide/i.test(title.trim());
        if (isSyllabusTitle) {
            console.log(`📋 偵測到Syllabus topic，交由 fetchAndParseSyllabusPDF 處理`);
            return await fetchAndParseSyllabusPDF(orgUnitId, data, topic);
        }

        let deadline = formatD2LDate(data.DueDate);
        let detail = "";
        let topics = [];
        let outcomes = [];
        let reflectionQuestions = [];
        let discussionPrompt = "";
        let assignmentInstructions = "";
        let extractedDiscussionPrompt = "";
        let extractedAssignmentInstructions = "";

        if (isReadingAssignmentPage(title, topic.url)) {
            console.log(`📖 Reading topic properties: ${title}`);
            if (data.TopicType === 1 && data.Url) {
                const fileUrl = resolveUrl(data.Url, `https://learn.uopeople.edu`);
                console.log(`📖 Fetching direct HTML content for D2L reading: ${fileUrl}`);
                try {
                    const fileRes = await fetch(fileUrl, { credentials: "include" });
                    if (fileRes.ok) {
                        const html = await fileRes.text();
                        if (html.trimStart().startsWith('%PDF')) {
                            detail = "%PDF [binary data skipped]";
                        } else {
                            const doc = new DOMParser().parseFromString(html, "text/html");
                            
                            const seenHrefs = new Set();
                            const entries = [];
                            const fallbackText = extractFromDoc(doc, fileUrl, entries, seenHrefs);
                            
                            if (entries.length > 0) {
                                detail = `#### 📚 Reading Assignment List\n${entries.join("\n")}`;
                            } else if (fallbackText && fallbackText.length > 20) {
                                detail = `#### 📖 Reading Assignment Text\n${fallbackText}`;
                            }
                            
                            const overviewMeta = {
                                topics: cleanExtracted(extractAllListsFromOfflineDoc(doc.body, /topics?/i), false),
                                outcomes: cleanExtracted(extractAllListsFromOfflineDoc(doc.body, /(?:learning\s+)?outcomes?|(?:learning\s+)?objectives?|goals?/i), true),
                                reflectionQuestions: extractAllListsFromOfflineDoc(doc.body, /reflection\s+questions?|questions?\s+(?:to\s+)?consider|think\s+about|key\s+questions?/i)
                            };
                            topics = overviewMeta.topics;
                            outcomes = overviewMeta.outcomes;
                            reflectionQuestions = overviewMeta.reflectionQuestions;

                            const extDiscussion = extractSectionByHeading(doc.body, /discussion\s+(?:assignment|forum|prompt)/i);
                            const extWritten = extractSectionByHeading(doc.body, /written\s+assignment/i);
                            const extJournal = extractSectionByHeading(doc.body, /learning\s+journal/i);
                            const extProg = extractSectionByHeading(doc.body, /programming\s+assignment/i);
                            const extPortfolio = extractSectionByHeading(doc.body, /portfolio\s+activity/i);
                            
                            if (extDiscussion) extractedDiscussionPrompt = extDiscussion;
                            if (extWritten) extractedAssignmentInstructions += `\n[Written Assignment]\n${extWritten}`;
                            if (extJournal) extractedAssignmentInstructions += `\n[Learning Journal]\n${extJournal}`;
                            if (extProg) extractedAssignmentInstructions += `\n[Programming Assignment]\n${extProg}`;
                            if (extPortfolio) extractedAssignmentInstructions += `\n[Portfolio Activity]\n${extPortfolio}`;
                        }
                    }
                } catch (e) {
                    console.warn("Failed to fetch direct reading file:", e);
                }
            }
            
            if (!detail && data.Description?.Html) {
                const descDoc = new DOMParser().parseFromString(data.Description.Html, "text/html");
                const seenHrefs = new Set();
                const entries = [];
                const fallbackText = extractFromDoc(descDoc, topic.url, entries, seenHrefs);
                
                if (entries.length > 0) {
                    detail = `#### 📚 Reading Assignment List\n${entries.join("\n")}`;
                } else if (fallbackText && fallbackText.length > 20) {
                    detail = `#### 📖 Reading Assignment Text\n${fallbackText}`;
                }
                
                const overviewMeta = {
                    topics: cleanExtracted(extractAllListsFromOfflineDoc(descDoc.body, /topics?/i), false),
                    outcomes: cleanExtracted(extractAllListsFromOfflineDoc(descDoc.body, /(?:learning\s+)?outcomes?|(?:learning\s+)?objectives?|goals?/i), true),
                    reflectionQuestions: extractAllListsFromOfflineDoc(descDoc.body, /reflection\s+questions?|questions?\s+(?:to\s+)?consider|think\s+about|key\s+questions?/i)
                };
                topics = overviewMeta.topics;
                outcomes = overviewMeta.outcomes;
                reflectionQuestions = overviewMeta.reflectionQuestions;

                const extDiscussion = extractSectionByHeading(descDoc.body, /discussion\s+(?:assignment|forum|prompt)/i);
                const extWritten = extractSectionByHeading(descDoc.body, /written\s+assignment/i);
                const extJournal = extractSectionByHeading(descDoc.body, /learning\s+journal/i);
                const extProg = extractSectionByHeading(descDoc.body, /programming\s+assignment/i);
                const extPortfolio = extractSectionByHeading(descDoc.body, /portfolio\s+activity/i);
                
                if (extDiscussion) extractedDiscussionPrompt = extDiscussion;
                if (extWritten) extractedAssignmentInstructions += `\n[Written Assignment]\n${extWritten}`;
                if (extJournal) extractedAssignmentInstructions += `\n[Learning Journal]\n${extJournal}`;
                if (extProg) extractedAssignmentInstructions += `\n[Programming Assignment]\n${extProg}`;
                if (extPortfolio) extractedAssignmentInstructions += `\n[Portfolio Activity]\n${extPortfolio}`;
            }
        } else {
            // ── General task (Discussion / Assignment / Quiz / Resource) ──
            let rawText = "";
            if (data.Description?.Html) {
                const descDoc = new DOMParser().parseFromString(data.Description.Html, "text/html");
                rawText = htmlToMarkdown(descDoc.body, topic.url);
            }
            if (!rawText) {
                rawText = data.Description?.Text || "No content";
            }
            // Full capture — no truncation
            detail = rawText;

            // ── Discussion: fetch actual prompt from Discussions API ──
            if (topic.rawType === "Discussion" && discussionMap) {
                const matchKey = title.trim().toLowerCase();
                const discTopic = discussionMap[matchKey];
                if (discTopic) {
                    if (discTopic.Description?.Html) {
                        const discDoc = new DOMParser().parseFromString(discTopic.Description.Html, "text/html");
                        discussionPrompt = htmlToMarkdown(discDoc.body, topic.url);
                    } else if (discTopic.Description?.Text) {
                        discussionPrompt = discTopic.Description.Text;
                    }
                    console.log(`💬 Found discussion prompt for "${title}" (${discussionPrompt.length} chars)`);
                }
                // Fallback: use the content topic description as the prompt
                if (!discussionPrompt && rawText.length > 10) {
                    discussionPrompt = rawText;
                }
            }

            // ── Assignment: fetch instructions + rubrics from Dropbox API ──
            if ((topic.rawType === "Assignment" || topic.rawType === "Quiz") && dropboxMap) {
                const matchKey = title.trim().toLowerCase();
                const dbFolder = dropboxMap[matchKey];
                if (dbFolder) {
                    let instrText = "";
                    if (dbFolder.Instructions?.Html) {
                        const instrDoc = new DOMParser().parseFromString(dbFolder.Instructions.Html, "text/html");
                        instrText = htmlToMarkdown(instrDoc.body, topic.url);
                    } else if (dbFolder.Instructions?.Text) {
                        instrText = dbFolder.Instructions.Text;
                    }
                    if (instrText) {
                        assignmentInstructions = instrText;
                        // Enrich detail with the full instructions
                        if (instrText.length > detail.length) {
                            detail = instrText;
                        }
                    }
                    console.log(`📝 Found assignment instructions for "${title}" (${assignmentInstructions.length} chars)`);

                    // Rubric data (if available in the folder object)
                    if (dbFolder.Rubrics && dbFolder.Rubrics.length > 0) {
                        let rubricText = "\n\n--- Rubric ---\n";
                        for (const rubric of dbFolder.Rubrics) {
                            rubricText += `${rubric.Name || "Rubric"}:\n`;
                            if (rubric.Description?.Text) {
                                rubricText += `${rubric.Description.Text}\n`;
                            }
                        }
                        assignmentInstructions += rubricText;
                    }
                }
                // Fallback: use the content topic description
                if (!assignmentInstructions && rawText.length > 10) {
                    assignmentInstructions = rawText;
                }
            }
        }

        let rubricText = null;
        if (title.includes("Assignment Activity")) {
            try {
                const topicPageRes = await fetch(topic.url, { credentials: "include" });
                if (topicPageRes.ok) {
                    const pageHtml = await topicPageRes.text();
                    const pageDoc = new DOMParser().parseFromString(pageHtml, "text/html");
                    const rubricSelectors = [
                        ".d2l-htmlblock-untrusted",
                        ".d2l-page-title",
                        '[data-rel="description"]',
                        ".d2l-le-itemsummary"
                    ];
                    let matchedEl = null;
                    for (const sel of rubricSelectors) {
                        matchedEl = pageDoc.querySelector(sel);
                        if (matchedEl && getText(matchedEl).trim().length > 0) {
                            break;
                        }
                    }
                    if (matchedEl) {
                        rubricText = htmlToMarkdown(matchedEl, topic.url);
                    }
                }
            } catch (e) {
                console.warn(`Secondary fetch failed for ${title}:`, e);
            }
        }

        return { detail, deadline, topics, outcomes, reflectionQuestions, discussionPrompt, assignmentInstructions, extractedDiscussionPrompt, extractedAssignmentInstructions, rubricText };
    } catch (e) {
        console.error("fetchDeepDetailD2L error:", e);
        return { detail: `❌ Fetch failed: ${e.message}`, deadline: "N/A", topics: [], outcomes: [], reflectionQuestions: [], discussionPrompt: "", assignmentInstructions: "", extractedDiscussionPrompt: "", extractedAssignmentInstructions: "", rubricText: null };
    }
}

// ─────────────────────────────────────────────
// Syllabus Helpers & Main Parser
// ─────────────────────────────────────────────
async function fetchAndParseSyllabusPDF(orgUnitId, data, topic) {
    try {
        const fileUrl = resolveUrl(data.Url, "https://learn.uopeople.edu");
        console.log(`[Syllabus] Resolved Syllabus HTML Url: ${fileUrl}`);
        
        const fileRes = await fetch(fileUrl, { credentials: "include" });
        if (!fileRes.ok) throw new Error(`HTML fetch failed: ${fileRes.status}`);
        const html = await fileRes.text();
        
        const doc = new DOMParser().parseFromString(html, "text/html");
        const links = Array.from(doc.querySelectorAll("a"));
        let pdfUrl = null;
        for (const a of links) {
            const rawHref = a.getAttribute("href") || "";
            const resolved = resolveUrl(rawHref, fileUrl);
            if (resolved.split('?')[0].toLowerCase().endsWith('.pdf')) {
                pdfUrl = resolved;
                break;
            }
        }
        
        if (!pdfUrl) {
            return {
                detail: "⚠️ 未在Syllabus頁面找到PDF連結",
                deadline: "N/A",
                topics: [],
                outcomes: [],
                reflectionQuestions: [],
                discussionPrompt: "",
                assignmentInstructions: "",
                extractedDiscussionPrompt: "",
                extractedAssignmentInstructions: "",
                rubricText: null
            };
        }
        
        console.log(`[Syllabus] Found Syllabus PDF Url: ${pdfUrl}`);
        
        const pdfRes = await fetch(pdfUrl, { credentials: "include" });
        if (!pdfRes.ok) throw new Error(`PDF fetch failed: ${pdfRes.status}`);
        const arrayBuffer = await pdfRes.arrayBuffer();
        
        // Use PDF.js to extract text
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        let fullText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            fullText += content.items.map(item => item.str).join(" ") + "\n";
        }
        
        console.log(`[Syllabus] Sending parsed PDF text to background worker via Port (long-lived connection)...`);
        const response = await new Promise((resolve, reject) => {
            let settled = false;
            const port = chrome.runtime.connect({ name: "syllabus-parser" });

            port.onMessage.addListener((msg) => {
                if (settled) return;
                settled = true;
                port.disconnect();
                resolve(msg);
            });

            port.onDisconnect.addListener(() => {
                if (settled) return;
                settled = true;
                const err = chrome.runtime.lastError?.message || "Background port disconnected unexpectedly";
                reject(new Error(err));
            });

            port.postMessage({ action: "parseSyllabusPDF", text: fullText });
        });
        
        if (!response || !response.success) {
            const errMsg = response ? response.error : "No response from background";
            throw new Error(errMsg);
        }
        
        let courseName = document.title;
        try {
            const courseRes = await fetch(`/d2l/api/lp/1.60/courses/${orgUnitId}`, { credentials: "include" });
            if (courseRes.ok) {
                const courseData = await courseRes.json();
                if (courseData.Name) courseName = courseData.Name;
            }
        } catch (e) {
            console.warn("Failed to fetch course details for code extraction:", e);
        }
        courseName = courseName
            .replace(/\s*-\s*University of the People/i, "")
            .replace(/\s*-\s*learn\.uopeople\.edu/i, "")
            .replace(/\s*-\s*Course Home/i, "")
            .trim();
        const courseCode = getCourseCode(courseName).replace(/[/\\?%*:|"<>]/g, "-").trim();
        
        return {
            detail: `已解析課程基準資料，詳見 ${courseCode}_課程基準.md`,
            deadline: "N/A",
            topics: [],
            outcomes: [],
            reflectionQuestions: [],
            discussionPrompt: "",
            assignmentInstructions: "",
            extractedDiscussionPrompt: "",
            extractedAssignmentInstructions: "",
            rubricText: null,
            syllabusBasis: response.data   // ← 統一欄位名，供外層掃描迴圈的 scannedSyllabusBasis 收集
        };
    } catch (e) {
        console.error("fetchAndParseSyllabusPDF error:", e);
        return {
            detail: `❌ Syllabus 解析失敗: ${e.message}`,
            deadline: "N/A",
            topics: [],
            outcomes: [],
            reflectionQuestions: [],
            discussionPrompt: "",
            assignmentInstructions: "",
            extractedDiscussionPrompt: "",
            extractedAssignmentInstructions: "",
            rubricText: null
        };
    }
}

function getCourseCode(course) {
    if (!course) return "Course";
    let clean = course
        .replace(/^(Homepage|Course Home|Home|Course Homepage)\s*-\s*/i, "")
        .trim();
    const codeMatch = clean.match(/\b([A-Z]{2,4}\s+\d{3,4}(?:-\d{2})?)\b/i);
    if (codeMatch) {
        return codeMatch[1].trim();
    }
    const parts = clean.split(/\s+-\s+/);
    return parts[0].trim();
}

function buildSyllabusMarkdown(courseCode, courseTitle, syllabusData) {
    let md = `# 課程基準: ${courseCode} - ${courseTitle}\n\n`;
    
    md += `## Course Learning Outcomes (CLOs)\n`;
    if (syllabusData.clos && syllabusData.clos.length > 0) {
        syllabusData.clos.forEach(clo => {
            md += `- ${clo}\n`;
        });
    } else {
        md += `N/A\n`;
    }
    md += `\n`;
    
    md += `## Grading Weights\n`;
    md += `| Assessment Component | Weight |\n`;
    md += `| --- | --- |\n`;
    if (syllabusData.gradingWeights && syllabusData.gradingWeights.length > 0) {
        syllabusData.gradingWeights.forEach(item => {
            md += `| ${item.assessment || "N/A"} | ${item.weight || "N/A"} |\n`;
        });
    } else {
        md += `| N/A | N/A |\n`;
    }
    md += `\n`;
    
    md += `## Course Schedule\n`;
    md += `| Unit | Topic | Activities / Assignments |\n`;
    md += `| --- | --- | --- |\n`;
    if (syllabusData.schedule && syllabusData.schedule.length > 0) {
        syllabusData.schedule.forEach(item => {
            md += `| ${item.unit || "N/A"} | ${item.topic || "N/A"} | ${item.activities || item.assignments || "N/A"} |\n`;
        });
    } else {
        md += `| N/A | N/A | N/A |\n`;
    }
    
    return md;
}

async function writeToObsidian(filename, content) {
    const resKey = await new Promise(r => chrome.storage.local.get(["obsidian_key"], r));
    const apiKey = resKey.obsidian_key;
    if (!apiKey) {
        console.error("❌ Obsidian API Key not found in storage.");
        return;
    }
    
    const endpoints = [
        { proto: "https", host: "127.0.0.1:27124" },
        { proto: "http", host: "127.0.0.1:27123" }
    ];
    let baseUrl = "";
    for (const endpoint of endpoints) {
        try {
            const res = await fetch(`${endpoint.proto}://${endpoint.host}/`, {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: AbortSignal.timeout(2000),
            });
            if (res.ok || res.status === 401 || res.status === 403) {
                baseUrl = `${endpoint.proto}://${endpoint.host}`;
                break;
            }
        } catch (e) {
            // skip
        }
    }
    
    if (!baseUrl) {
        console.error("❌ Could not connect to Obsidian Local REST API.");
        return;
    }
    
    const url = `${baseUrl}/vault/UoPeople/${encodeURIComponent(filename)}`;
    try {
        const res = await fetch(url, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "text/markdown",
            },
            body: content,
        });
        if (res.ok) {
            console.log(`✅ Successfully wrote ${filename} to Obsidian.`);
        } else {
            const body = await res.text().catch(() => "");
            console.error(`❌ Failed to write ${filename} to Obsidian: HTTP ${res.status}: ${body}`);
        }
    } catch (e) {
        console.error(`❌ Error writing to Obsidian:`, e);
    }
}

// ─────────────────────────────────────────────
// Scraper for D2L Brightspace Page (API-based)
// ─────────────────────────────────────────────
async function scanD2LPage(sendResponse) {
    console.log("🏁 Starting D2L REST API Scraper...");
    let scannedSyllabusBasis = null;
    
    const url = window.location.href;
    let orgUnitId = null;
    const pathMatch = url.match(/\/d2l\/(?:home|le\/lessons|le\/content|le\/sequence)\/(\d+)/i);
    if (pathMatch) {
        orgUnitId = pathMatch[1];
    } else {
        try {
            const urlObj = new URL(url);
            orgUnitId = urlObj.searchParams.get("ou");
        } catch (e) {
            console.warn("Failed to parse URL object:", e);
        }
    }

    if (!orgUnitId) {
        console.error("❌ Could not extract orgUnitId from URL:", url);
        sendResponse({
            action: "error",
            message: "Cannot detect UoPeople Course ID from active tab URL. Make sure you are on a course page."
        });
        return;
    }

    let courseName = document.title;
    try {
        const courseRes = await fetch(`/d2l/api/lp/1.60/courses/${orgUnitId}`, { credentials: "include" });
        if (courseRes.ok) {
            const courseData = await courseRes.json();
            if (courseData.Name) courseName = courseData.Name;
        }
    } catch (e) {
        console.warn("Failed to fetch course details from LP API:", e);
    }
    
    courseName = courseName
        .replace(/\s*-\s*University of the People/i, "")
        .replace(/\s*-\s*learn\.uopeople\.edu/i, "")
        .replace(/\s*-\s*Course Home/i, "")
        .trim();

    console.log("🏁 Fetching D2L TOC for course:", orgUnitId);
    let tocData;
    let resTOC;
    const versions = ["1.60", "1.50", "1.40", "1.0"];
    for (const ver of versions) {
        try {
            resTOC = await fetch(`/d2l/api/le/${ver}/${orgUnitId}/content/toc`, { credentials: "include" });
            if (resTOC.ok) {
                tocData = await resTOC.json();
                break;
            }
        } catch (e) {
            console.warn(`TOC fetch failed for version ${ver}:`, e);
        }
    }

    if (!tocData) {
        console.error("❌ Failed to fetch D2L TOC");
        sendResponse({
            action: "error",
            message: "Failed to retrieve course Table of Contents. Please make sure you are logged in."
        });
        return;
    }

    const tasks = [];
    const seenTaskIds = new Set();
    
    function traverse(node, parentModuleName = "General") {
        if (!node) return;
        
        if (Array.isArray(node)) {
            for (const item of node) {
                traverse(item, parentModuleName);
            }
            return;
        }
        
        const isModule = node.Type === 0 || 
                         (node.Modules !== undefined) || 
                         (node.Topics !== undefined) || 
                         (node.ModuleId !== undefined);
                         
        if (isModule) {
            const title = (node.Title || "").trim();
            let unitName = parentModuleName;
            if (title) {
                if (parentModuleName === "General") {
                    unitName = title;
                }
            }
            
            if (Array.isArray(node.Modules)) {
                traverse(node.Modules, unitName);
            }
            if (Array.isArray(node.Topics)) {
                traverse(node.Topics, unitName);
            }
            if (Array.isArray(node.Structure)) {
                traverse(node.Structure, unitName);
            }
        } else {
            const topicId = node.TopicId || node.Id;
            if (!topicId || seenTaskIds.has(topicId)) return;
            seenTaskIds.add(topicId);
            
            let rawType = "Reading";
            const actType = node.ActivityType;
            if (actType === 3) {
                rawType = "Assignment";
            } else if (actType === 4) {
                rawType = "Quiz";
            } else if (actType === 5 || actType === 6) {
                rawType = "Discussion";
            } else if (actType === 10 || actType === 11 || actType === 12) {
                rawType = "Resource";
            } else {
                const titleLower = (node.Title || "").toLowerCase();
                if (titleLower.includes("discussion")) {
                    rawType = "Discussion";
                } else if (titleLower.includes("assignment") || titleLower.includes("portfolio")) {
                    rawType = "Assignment";
                } else if (titleLower.includes("quiz") || titleLower.includes("exam")) {
                    rawType = "Quiz";
                } else if (titleLower.includes("reading") || titleLower.includes("learning guide") || titleLower.includes("overview")) {
                    rawType = "Reading";
                } else {
                    rawType = "Resource";
                }
            }
            
            const topicUrl = `https://learn.uopeople.edu/d2l/le/lessons/${orgUnitId}/topics/${topicId}`;
            
            let deadline = "N/A";
            if (node.DueDate) {
                deadline = formatD2LDate(node.DueDate);
            }
            
            let downloadUrl = null;
            if (node.Url) {
                downloadUrl = resolveUrl(node.Url, `https://learn.uopeople.edu`);
            }
            
            tasks.push({
                id: topicId,
                title: (node.Title || "").trim(),
                url: topicUrl,
                downloadUrl: downloadUrl,
                unitId: parentModuleName,
                deadline: deadline,
                rawType: rawType
            });
        }
    }

    traverse(tocData, "General");
    console.log(`🔍 Found ${tasks.length} D2L activities to deep scan.`);

    // ── Prefetch Discussion Forums & Topics ──
    const discussionMap = {};
    try {
        const forumsRes = await fetch(`/d2l/api/le/1.60/${orgUnitId}/discussions/forums/`, { credentials: "include" });
        if (forumsRes.ok) {
            const forums = await forumsRes.json();
            for (const forum of forums) {
                try {
                    const dtRes = await fetch(`/d2l/api/le/1.60/${orgUnitId}/discussions/forums/${forum.ForumId}/topics/`, { credentials: "include" });
                    if (dtRes.ok) {
                        const dTopics = await dtRes.json();
                        for (const dt of dTopics) {
                            if (dt.Name) discussionMap[dt.Name.trim().toLowerCase()] = dt;
                        }
                    }
                } catch (e) { /* skip */ }
            }
            console.log(`💬 Prefetched ${Object.keys(discussionMap).length} discussion topics`);
        }
    } catch (e) {
        console.warn("Discussion prefetch failed (non-critical):", e.message);
    }

    // ── Prefetch Dropbox (Assignment) Folders ──
    const dropboxMap = {};
    try {
        const foldersRes = await fetch(`/d2l/api/le/1.60/${orgUnitId}/dropbox/folders/`, { credentials: "include" });
        if (foldersRes.ok) {
            const folders = await foldersRes.json();
            for (const f of folders) {
                if (f.Name) dropboxMap[f.Name.trim().toLowerCase()] = f;
            }
            console.log(`📝 Prefetched ${Object.keys(dropboxMap).length} dropbox folders`);
        }
    } catch (e) {
        console.warn("Dropbox prefetch failed (non-critical):", e.message);
    }

    const results = new Array(tasks.length);
    const enrichedUnitDetails = {};
    const concurrencyLimit = 6;
    let activeIndex = 0;
    
    async function worker() {
        while (activeIndex < tasks.length) {
            const idx = activeIndex++;
            if (idx >= tasks.length) break;
            const task = tasks[idx];
            try {
                console.log(`🔍 D2L Deep Scan: ${task.title}`);
                const extra = await fetchDeepDetailD2L(orgUnitId, task, task.title, discussionMap, dropboxMap);

                // ── Syllabus 結果特殊處理：不進入一般results，改存入外層變數 ──
                if (extra.syllabusBasis) {
                    scannedSyllabusBasis = extra.syllabusBasis;
                    results[idx] = undefined; // 確保不進入 finalResults
                    continue;
                }

                const unitName = task.unitId || "General";

                if (!enrichedUnitDetails[unitName]) {
                    enrichedUnitDetails[unitName] = { topics: [], outcomes: [], reflectionQuestions: [] };
                }

                if (extra.topics?.length > 0) {
                    enrichedUnitDetails[unitName].topics = [...new Set([...enrichedUnitDetails[unitName].topics, ...extra.topics])];
                }
                if (extra.outcomes?.length > 0) {
                    enrichedUnitDetails[unitName].outcomes = [...new Set([...enrichedUnitDetails[unitName].outcomes, ...extra.outcomes])];
                }
                if (extra.reflectionQuestions?.length > 0) {
                    enrichedUnitDetails[unitName].reflectionQuestions = [...new Set([...(enrichedUnitDetails[unitName].reflectionQuestions || []), ...extra.reflectionQuestions])];
                }
                if (extra.extractedDiscussionPrompt) {
                    enrichedUnitDetails[unitName].extractedDiscussionPrompt = 
                        (enrichedUnitDetails[unitName].extractedDiscussionPrompt || "") + "\n\n" + extra.extractedDiscussionPrompt;
                }
                if (extra.extractedAssignmentInstructions) {
                    enrichedUnitDetails[unitName].extractedAssignmentInstructions = 
                        (enrichedUnitDetails[unitName].extractedAssignmentInstructions || "") + "\n\n" + extra.extractedAssignmentInstructions;
                }

                results[idx] = {
                    title: task.title,
                    url: task.url,
                    downloadUrl: task.downloadUrl,
                    unitTime: unitName,
                    detail: extra.detail,
                    deadline: extra.deadline !== "N/A" ? extra.deadline : task.deadline,
                    type: task.rawType === "Quiz" ? "Assignment" : task.rawType,
                    discussionPrompt: extra.discussionPrompt || "",
                    assignmentInstructions: extra.assignmentInstructions || "",
                    rubricText: extra.rubricText || null,
                    syllabusData: extra.syllabusData || null,
                };

                const isSyllabus = /syllabus/i.test(task.title.trim()) && !/quiz|test|exam|forum|guide/i.test(task.title.trim());
                if (isSyllabus && extra.syllabusData) {
                    const cleanCourseName = courseName
                        .replace(/\s*-\s*University of the People/i, "")
                        .replace(/\s*-\s*learn\.uopeople\.edu/i, "")
                        .replace(/\s*-\s*Course Home/i, "")
                        .trim();
                    const courseCode = getCourseCode(cleanCourseName).replace(/[/\\?%*:|"<>]/g, "-").trim();
                    const mdContent = buildSyllabusMarkdown(courseCode, cleanCourseName, extra.syllabusData);
                    await writeToObsidian(`_課程基準_${courseCode}.md`, mdContent);
                }
            } catch (e) {
                console.error(`Error scanning task ${task.title}:`, e);
                results[idx] = {
                    title: task.title,
                    url: task.url,
                    downloadUrl: task.downloadUrl,
                    unitTime: task.unitId || "General",
                    detail: `❌ Scan failed: ${e.message}`,
                    deadline: task.deadline,
                    type: task.rawType === "Quiz" ? "Assignment" : task.rawType,
                    discussionPrompt: "",
                    assignmentInstructions: "",
                    rubricText: null,
                };
            }
        }
    }

    const workers = Array(concurrencyLimit).fill(null).map(() => worker());
    await Promise.all(workers);

    const finalResults = results.filter(r => r !== undefined);

    sendResponse({
        action: "final",
        courseName: cleanMD(courseName),
        results: finalResults,
        unitDetails: enrichedUnitDetails,
        syllabusBasis: scannedSyllabusBasis,   // ← 新增欄位
    });
}

// ─────────────────────────────────────────────
// Scraper for Moodle Page (Original Logic)
// ─────────────────────────────────────────────
async function scanMoodlePage(sendResponse) {
    const courseName =
        document.querySelector("h1")?.innerText.trim() || document.title;

    const unitMap = {};
    document
        .querySelectorAll("li.section, section.section")
        .forEach((sec) => {
            const nameEl = sec.querySelector(
                ".sectionname, h3, .courseindex-link"
            );
            const txt = nameEl?.innerText.trim();
            if (!sec.id || !txt) return;

            const summaryEl = sec.querySelector(
                ".summarytext, .summary, div.summary, " +
                ".course-section-summary, .no-overflow, .sectionbody"
            );

            const topics = cleanExtracted(extractAllListsFromOfflineDoc(summaryEl, /topics?/i), false);
            const outcomes = cleanExtracted(extractAllListsFromOfflineDoc(summaryEl, /(?:learning\s+)?outcomes?|(?:learning\s+)?objectives?|goals?/i), true);
            const reflectionQuestions = extractAllListsFromOfflineDoc(summaryEl, /reflection\s+questions?|questions?\s+(?:to\s+)?consider|think\s+about|key\s+questions?/i);

            unitMap[sec.id] = {
                name: cleanMD(txt.split("\n")[0]),
                topics,
                outcomes,
                reflectionQuestions,
            };
        });

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

    const results = [];
    const enrichedUnitDetails = {};
    for (const [, data] of Object.entries(unitMap)) {
        if (typeof data === "object" && data.name) {
            enrichedUnitDetails[data.name] = {
                topics: data.topics || [],
                outcomes: data.outcomes || [],
                reflectionQuestions: data.reflectionQuestions || [],
            };
        }
    }

    for (const task of tasks) {
        console.log(`🔍 Moodle Deep Scan: ${task.title}`);
        const extra = await fetchDeepDetail(task.url, task.title);
        const unitData = unitMap[task.unitId] || { name: "General", topics: [], outcomes: [] };
        const unitName = typeof unitData === "string" ? unitData : unitData.name;

        if (extra.topics?.length > 0 || extra.outcomes?.length > 0) {
            if (!enrichedUnitDetails[unitName]) {
                enrichedUnitDetails[unitName] = { topics: [], outcomes: [], reflectionQuestions: [] };
            }
            if (extra.topics.length > 0)
                enrichedUnitDetails[unitName].topics = extra.topics;
            if (extra.outcomes.length > 0)
                enrichedUnitDetails[unitName].outcomes = extra.outcomes;
            if (extra.reflectionQuestions?.length > 0)
                enrichedUnitDetails[unitName].reflectionQuestions = extra.reflectionQuestions;
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
            discussionPrompt: extra.discussionPrompt || "",
            assignmentInstructions: extra.assignmentInstructions || "",
            rubricText: extra.rubricText || null,
        });
    }

    sendResponse({
        action: "final",
        courseName: cleanMD(courseName),
        results,
        unitDetails: enrichedUnitDetails,
    });
}

// ─────────────────────────────────────────────
// Chrome Extension Message Listener
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "ping") {
        sendResponse({ status: "ready" });
    } else if (msg.action === "scanPage") {
        (async () => {
            try {
                const isD2L = window.location.hostname.includes("learn.uopeople.edu");
                if (isD2L) {
                    await scanD2LPage(sendResponse);
                } else {
                    await scanMoodlePage(sendResponse);
                }
            } catch (e) {
                console.error("Error during page scan:", e);
                sendResponse({
                    action: "error",
                    message: `Scan failed due to an error: ${e.message}`
                });
            }
        })();
        return true;
    }
});