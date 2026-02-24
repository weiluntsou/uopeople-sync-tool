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

        // ── Step 3：抓取超連結（教材連結）──
        const links = Array.from(contentArea.querySelectorAll("a"))
            .map((a) => ({
                text: getText(a).trim(),
                href: resolveUrl(a.getAttribute("href") || "", finalUrl),
            }))
            .filter(
                ({ text, href }) =>
                    href.startsWith("http") &&
                    !href.includes("/mod/book") &&
                    !href.includes("javascript:") &&
                    text.length > 2
            )
            .map(({ text, href }) => `- [${text}](${href})`);

        if (links.length > 0) {
            return `#### 📚 Reading Assignment List\n${links.join("\n")}`;
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
// 抓取任務詳情（深度抓取）
// ─────────────────────────────────────────────
async function fetchDeepDetail(url, title) {
    try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return { detail: `❌ 無法存取 (HTTP ${res.status})`, deadline: "N/A" };
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

        // ── 判斷是否為 Reading Assignment 類型 ──
        if (isReadingAssignmentPage(title, url)) {
            console.log(`📖 識別為 Reading 類型：${title} (${url})`);
            detail = await fetchReadingPage(url);
        } else {
            // 一般任務（Discussion、Assignment 等）
            const bodySelectors = [
                ".post-content",
                "#intro",
                ".no-overflow",
                ".generalbox",
                ".page-content",
                ".box.py-3",
            ];
            let bodyEl = null;
            for (const sel of bodySelectors) {
                bodyEl = doc.querySelector(sel);
                if (bodyEl) break;
            }
            const rawText = bodyEl ? getText(bodyEl).substring(0, 600) : "無詳細內容";
            detail = `> ${rawText.replace(/\n/g, "\n> ")}`;
        }

        return { detail, deadline };
    } catch (e) {
        console.error("fetchDeepDetail error:", e);
        return { detail: `❌ 抓取失敗：${e.message}`, deadline: "N/A" };
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

            // ── 深度抓取每個任務 ──
            const results = [];
            for (const task of tasks) {
                console.log(`🔍 抓取：${task.title}`);
                const extra = await fetchDeepDetail(task.url, task.title);
                const unitData = unitMap[task.unitId] || { name: "General", topics: [], outcomes: [] };
                results.push({
                    ...task,
                    ...extra,
                    unitTime: typeof unitData === "string" ? unitData : unitData.name,
                    type: task.url.includes("forum")
                        ? "Discussion"
                        : task.url.includes("assign")
                            ? "Assignment"
                            : task.url.includes("book")
                                ? "Reading"
                                : "Resource",
                });
            }

            // Build a clean unitDetails map for popup (keyed by unit name)
            const unitDetails = {};
            for (const [, data] of Object.entries(unitMap)) {
                if (typeof data === "object" && data.name) {
                    unitDetails[data.name] = {
                        topics: data.topics || [],
                        outcomes: data.outcomes || [],
                    };
                }
            }

            sendResponse({
                action: "final",
                courseName: cleanMD(courseName),
                results,
                unitDetails,   // { "Week 1: ..." : { topics: [], outcomes: [] }, ... }
            });
        })();
        return true; // 保持非同步 channel 開啟
    }
});