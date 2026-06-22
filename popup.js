/**
 * popup.js  —  UoPeople Sync v3.2
 *
 * Features:
 * 1. Deep-scan UoPeople course pages and sync to Obsidian.
 *    The generated Obsidian note (all in English) includes:
 *       ① Course Schedule table
 *       ② Weekly Key Points Summary table   (per unit)
 *       ③ NotebookLM Source Links            (external URLs only, no my.uopeople.edu)
 *       ④ NotebookLM Video Script Prompt     (English, ready to paste)
 *       ⑤ UoPeople Internal Files list       (login-required; for the download button)
 *       ⑥ Full material details
 * 2. "Copy Reading Links" button  → clipboard with all external reading URLs.
 * 3. "Download UoP Files" button  → bulk-downloads UoPeople internal files
 *    using the user's active login session, then appends the filenames to Obsidian.
 */

let OBSIDIAN_HOST = "127.0.0.1:27124";

// ─── Global State ─────────────────────────────────
let scannedResults = [];   // all scanned tasks
let externalUrls = [];   // external reading links  (for NotebookLM)
let uopUrls = [];   // my.uopeople.edu links   (for download)
let unitDetails = {};   // { unitName: { topics:[], outcomes:[] } }
let courseName = "";
let obsidianApiKey = "";
let obsidianProtocol = "";  // auto-detected: "https" or "http"

// ─── Auto-detect Obsidian protocol ────────────────
async function detectObsidianProtocol(apiKey) {
    const endpoints = [
        { proto: "https", host: "127.0.0.1:27124" },
        { proto: "http", host: "127.0.0.1:27123" }
    ];

    for (const endpoint of endpoints) {
        try {
            const res = await fetch(`${endpoint.proto}://${endpoint.host}/`, {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: AbortSignal.timeout(3000),
            });
            if (res.ok || res.status === 401 || res.status === 403) {
                console.log(`✅ Obsidian detected on ${endpoint.proto}://${endpoint.host}`);
                obsidianProtocol = endpoint.proto;
                OBSIDIAN_HOST = endpoint.host;
                return endpoint.proto;
            }
        } catch (e) {
            console.log(`❌ ${endpoint.proto} failed:`, e.message);
        }
    }
    return "";
}

function getObsidianBaseUrl() {
    return `${obsidianProtocol || "https"}://${OBSIDIAN_HOST}`;
}

// ─── DOM refs ────────────────────────────────────
let statusEl, actionStatusEl, progressWrap, progressBar,
    statsRow, statTasks, statLinks, statFiles,
    scanBtn, copyBtn, downloadBtn, apiKeyInput, saveBtn;

// ─────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    statusEl = document.getElementById("status");
    actionStatusEl = document.getElementById("actionStatus");
    progressWrap = document.getElementById("progressWrap");
    progressBar = document.getElementById("progressBar");
    statsRow = document.getElementById("statsRow");
    statTasks = document.getElementById("statTasks");
    statLinks = document.getElementById("statLinks");
    statFiles = document.getElementById("statFiles");
    scanBtn = document.getElementById("scanBtn");
    copyBtn = document.getElementById("copyBtn");
    downloadBtn = document.getElementById("downloadBtn");
    apiKeyInput = document.getElementById("apiKeyInput");
    saveBtn = document.getElementById("saveBtn");

    chrome.storage.local.get(["obsidian_key"], (res) => {
        if (res.obsidian_key) {
            apiKeyInput.value = res.obsidian_key;
            obsidianApiKey = res.obsidian_key;
        }
    });

    saveBtn.onclick = handleSaveKey;
    scanBtn.onclick = handleScan;
    copyBtn.onclick = handleCopyLinks;
    downloadBtn.onclick = handleDownload;
});

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────
function setStatus(msg) { statusEl.textContent = msg; }
function setActionStatus(msg) {
    actionStatusEl.style.display = "block";
    actionStatusEl.textContent = msg;
}

function setProgress(pct) {
    progressWrap.style.display = "block";
    progressBar.style.width = `${pct}%`;
    if (pct >= 100) setTimeout(() => { progressWrap.style.display = "none"; }, 1500);
}

function showStats() {
    statsRow.style.display = "flex";
    statTasks.textContent = `${scannedResults.length} tasks`;
    statLinks.textContent = `${externalUrls.length} ext. links`;
    statFiles.textContent = `${uopUrls.length} UoP files`;
}

function enableActionBtns() {
    copyBtn.disabled = false;
    downloadBtn.disabled = false;
}

// ─────────────────────────────────────────────────
// Save API Key
// ─────────────────────────────────────────────────
async function handleSaveKey() {
    obsidianApiKey = apiKeyInput.value.trim();
    chrome.storage.local.set({ obsidian_key: obsidianApiKey });

    setStatus("🔍 API Key saved. Testing connection...");
    const proto = await detectObsidianProtocol(obsidianApiKey);
    if (proto) {
        setStatus(`✅ API Key saved. Connected via ${proto.toUpperCase()}.`);
    } else {
        setStatus(
            `❌ API Key saved, but cannot connect to Obsidian.\n` +
            `Make sure the Local REST API plugin is running in Obsidian.`
        );
    }
}

// ─────────────────────────────────────────────────
// 1. Deep Scan
// ─────────────────────────────────────────────────
async function handleScan() {
    if (!obsidianApiKey) {
        setStatus("❌ Please save your Obsidian API Key first.");
        return;
    }

    // Auto-detect protocol if not yet detected
    if (!obsidianProtocol) {
        setStatus("🔍 Detecting Obsidian connection...");
        const proto = await detectObsidianProtocol(obsidianApiKey);
        if (!proto) {
            setStatus(
                `❌ Cannot connect to Obsidian at ${OBSIDIAN_HOST}.\n` +
                `Make sure the Local REST API plugin is enabled and Obsidian is running.`
            );
            return;
        }
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    setStatus("🔍 Checking content script...");

    chrome.tabs.sendMessage(tab.id, { action: "ping" }, (res) => {
        if (chrome.runtime.lastError || !res) {
            setStatus("❌ Content script not found.\nPlease refresh the UoPeople course page first.");
            return;
        }

        setStatus("⏳ Deep scanning — this may take 30–60 seconds...");
        scanBtn.disabled = true;
        setProgress(5);

        chrome.tabs.sendMessage(tab.id, { action: "scanPage" }, async (response) => {
            scanBtn.disabled = false;

            if (!response) {
                setStatus("❌ Scan timed out. Make sure the course page is fully loaded.");
                return;
            }
            if (response.action === "error") {
                setStatus(`❌ Scan failed: ${response.message}`);
                return;
            }
            if (response.action !== "final") {
                setStatus("❌ Unexpected scan response. Please try again.");
                return;
            }

            scannedResults = response.results || [];
            courseName = response.courseName || "Course";
            unitDetails = response.unitDetails || {};
            setProgress(70);

            // Separate external links vs UoPeople internal files
            const { external, internal } = categorizeUrls(scannedResults);
            externalUrls = external;
            uopUrls = internal;

            setStatus("📤 Syncing to Obsidian...");
            const uploadOk = await uploadToObsidian(courseName, scannedResults, unitDetails, obsidianApiKey);
            setProgress(100);

            showStats();
            enableActionBtns();

            if (uploadOk) {
                setStatus(
                    `✅ Sync complete!\n` +
                    `${scannedResults.length} tasks · ${externalUrls.length} external links · ` +
                    `${uopUrls.length} UoPeople files.\n` +
                    `Note includes links, summary table, and NotebookLM prompt.`
                );
            }
            // If uploadOk is false, uploadToObsidian already set the error status.
        });
    });
}

// ─────────────────────────────────────────────────
// Categorise URLs from scan results
// ─────────────────────────────────────────────────
function categorizeUrls(results) {
    const external = new Set();
    const internal = new Set();
    const nameMap = {};

    for (const item of results) {
        // Parse ALL markdown links from detail text (handles emoji like 🎥 📄 in label)
        if (item.detail) {
            for (const m of item.detail.matchAll(/\[([\s\S]*?)\]\((https?:\/\/[^)]+)\)/g)) {
                const label = m[1].replace(/^[🎥📄]\s*/, "").trim();
                const url = m[2];

                const noiseKeywords = [
                    "UoPeople APA Tutorials",
                    "Learning Resource Center",
                    "Guidelines for Giving Meaningful Replies",
                    "LIRN",
                    "Tips for Searching LIRN"
                ];

                const isNoise = noiseKeywords.some(noise =>
                    label.toLowerCase().includes(noise.toLowerCase()) ||
                    url.toLowerCase().includes(noise.toLowerCase())
                );
                if (isNoise) continue;

                if (isUoPeopleFile(url)) {
                    internal.add(url);
                    if (label && label.length < 100 && !label.includes("\n")) {
                        nameMap[url] = label;
                    }
                } else if (!url.includes("my.uopeople.edu") && !url.includes("learn.uopeople.edu")) {
                    external.add(url);   // includes YouTube, Vimeo, Kaltura, etc.
                }
            }
        }

        // Reading module URL itself → internal only if it's a downloadable file
        const readingFileUrl = item.downloadUrl || item.url;
        if (item.type === "Reading" && isUoPeopleFile(readingFileUrl)) {
            internal.add(readingFileUrl);
            nameMap[readingFileUrl] = item.title;
        }
    }

    window.downloadNames = nameMap;
    return { external: Array.from(external), internal: Array.from(internal) };
}

// Returns true for UoPeople URLs that are likely downloadable files
// (pluginfile.php = Moodle's file-serving endpoint, or has a file extension)
// Note: YouTube/Vimeo/Kaltura hosted on external domains are NOT UoPeople files.
function isUoPeopleFile(url) {
    if (!url.includes("my.uopeople.edu") && !url.includes("learn.uopeople.edu")) return false;
    const fileExtensions = /\.(pdf|doc|docx|ppt|pptx|xls|xlsx|zip|mp4|mp3|png|jpg|jpeg|gif)(\?|$)/i;
    return url.includes("pluginfile.php") || url.includes("/content/enforced/") || url.includes("/content/topics/") || fileExtensions.test(url);
}

// ─────────────────────────────────────────────────
// 2. Copy external reading links to clipboard
// ─────────────────────────────────────────────────
function handleCopyLinks() {
    if (externalUrls.length === 0) {
        setActionStatus("⚠️ No external reading links found. Scan a course first.");
        return;
    }
    navigator.clipboard.writeText(externalUrls.join("\n")).then(() => {
        setActionStatus(
            `✅ Copied ${externalUrls.length} reading links to clipboard!\n` +
            `Paste into NotebookLM → Add Source → Website.`
        );
    }).catch(() => {
        setActionStatus("❌ Copy failed. Please copy the links manually from the Obsidian note.");
    });
}

// ─────────────────────────────────────────────────
// 3. Bulk-download UoPeople internal files
// ─────────────────────────────────────────────────
async function handleDownload() {
    if (uopUrls.length === 0) {
        setActionStatus("⚠️ No downloadable UoPeople files found.\nMake sure you scanned a course that has embedded files.");
        return;
    }

    const cleanedCourse = getCleanedCourseName(courseName);
    const safeCourseName = cleanedCourse.replace(/[/\\?%*:|"<>]/g, "-").trim();

    downloadBtn.disabled = true;
    setActionStatus(`⬇️ Starting download of ${uopUrls.length} file(s)...`);

    const downloadedNames = [];
    let successCount = 0;

    for (let i = 0; i < uopUrls.length; i++) {
        const url = uopUrls[i];
        let filename = window.downloadNames?.[url] || decodeURIComponent(url.split("/").pop().split("?")[0]) || `uop_file_${i + 1}`;
        
        // Sanitize and ensure proper file naming
        if (filename === "file" || !filename.includes(".")) {
            if (window.downloadNames?.[url]) {
                filename = window.downloadNames[url];
            } else {
                filename = `uop_file_${i + 1}.html`;
            }
        }
        
        filename = filename.replace(/[/\\?%*:|"<>]/g, "-").trim();

        try {
            // chrome.downloads.download uses the browser's active cookies → works for authenticated content
            await new Promise((resolve, reject) => {
                chrome.downloads.download(
                    {
                        url,
                        filename: `UoPeople/${safeCourseName}/${filename}`,
                        conflictAction: "uniquify",
                        saveAs: false,
                    },
                    (downloadId) => {
                        if (chrome.runtime.lastError || downloadId === undefined) {
                            reject(chrome.runtime.lastError?.message || "Unknown error");
                        } else {
                            downloadedNames.push(filename);
                            successCount++;
                            resolve(downloadId);
                        }
                    }
                );
            });

            setActionStatus(
                `⬇️ Downloading (${i + 1}/${uopUrls.length})...\n${filename}`
            );

            // Small delay to avoid overwhelming the server
            await delay(400);
        } catch (err) {
            console.warn(`Download failed for ${url}:`, err);
        }
    }

    downloadBtn.disabled = false;

    // Append downloaded file list to Obsidian note
    if (successCount > 0 && obsidianApiKey) {
        await appendDownloadedFilesToNote(courseName, downloadedNames, obsidianApiKey);
        setActionStatus(
            `✅ Downloaded ${successCount}/${uopUrls.length} file(s) to:\n` +
            `Downloads/UoPeople/${safeCourseName}/\n\n` +
            `📝 Obsidian note updated with downloaded file list.`
        );
    } else {
        setActionStatus(`✅ Downloaded ${successCount}/${uopUrls.length} file(s).`);
    }
}

// Append downloaded file list to the existing Obsidian note
async function appendDownloadedFilesToNote(course, filenames, apiKey) {
    const cleanedCourse = getCleanedCourseName(course);
    const safeName = cleanedCourse.replace(/[/\\?%*:|"<>]/g, "-").trim();
    const path = `${getObsidianBaseUrl()}/vault/UoPeople/${safeName}_Summary.md`;

    try {
        // Read existing content
        const getRes = await fetch(path, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        let existing = getRes.ok ? await getRes.text() : "";

        // Build the downloaded files section
        const dateStr = new Date().toISOString().replace("T", " ").substring(0, 16) + " UTC";
        let appendBlock = `\n\n---\n\n## 📥 Downloaded UoPeople Files\n\n`;
        appendBlock += `> Downloaded on ${dateStr}\n\n`;
        appendBlock += `| File | Local Path |\n| :--- | :--- |\n`;
        filenames.forEach((f) => {
            appendBlock += `| ${f} | Downloads/UoPeople/${safeName}/${f} |\n`;
        });

        // Check if a downloaded section already exists and replace it
        const marker = "## 📥 Downloaded UoPeople Files";
        if (existing.includes(marker)) {
            existing = existing.substring(0, existing.indexOf(marker)).trimEnd();
        }

        const updated = existing + appendBlock;

        await fetch(path, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "text/markdown",
            },
            body: updated,
        });
    } catch (e) {
        console.warn("Could not update Obsidian note with download list:", e);
    }
}

// ─────────────────────────────────────────────────
// Note generation helpers
// ─────────────────────────────────────────────────

// Clean common prefixes (like "Homepage - ") from the course title
function getCleanedCourseName(course) {
    if (!course) return "Course";
    return course
        .replace(/^(Homepage|Course Home|Home|Course Homepage)\s*-\s*/i, "")
        .trim();
}

// Extract only the course code prefix (e.g. "CS 3305-01" from "Course Home - CS 3305-01 - AY2026-T5")
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

// Generate a clean Obsidian-safe note name for wiki-links
function obsidianNoteName(course, title) {
    const courseCode = getCourseCode(course);
    const safeCourse = courseCode.replace(/[/\\?%*:|"<>]/g, "-").trim();
    const safeTitle = title.replace(/[/\\?%*:|"<>]/g, "-").replace(/\[|\]/g, "").trim();
    return `${safeCourse}_${safeTitle}`;
}

// Generate a clean Markdown heading anchor link (compatible with Obsidian / standard markdown)
function getHeaderAnchor(unitName) {
    const clean = unitName.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
    return `📘-${clean}`;
}

// Prefix every line with "> " for Obsidian callout body
function calloutLines(text) {
    return text.split("\n").map(l => `> ${l}`).join("\n");
}

// 過濾 Learning Outcomes 雜訊
function cleanLearningOutcomes(outcomes) {
    if (!outcomes || !Array.isArray(outcomes)) return [];
    const patterns = [
        /^section \d+\.\d+/i,
        /^read \(optional\)/i,
        /^\. [A-Z][a-z]+,/,
        /banner image/i,
        /freepik/i,
        /licensed under/i,
        /^by the e/i,
        /^as needed/i,
        /^callout$/i,
        /^to access lirn/i,
        /log in to the/i,
        /^select computer science/i,
        /^search using/i,
        /^view the online/i,
        /^read chapter/i
    ];
    return outcomes.filter(o => {
        const trimmed = o.trim();
        if (trimmed.length < 20) return false;
        return !patterns.some(pattern => pattern.test(trimmed));
    });
}

// 過濾 Topics 雜訊
function cleanTopics(topics) {
    if (!topics || !Array.isArray(topics)) return [];
    const patterns = [
        /^by the/i,
        /^as needed/i,
        /^callout/i,
        /^to access/i,
        /^log in/i,
        /^select /i,
        /^search using/i,
        /^view the/i,
        /^read chapter/i,
        /^section \d+\.\d+/i,
        /\.?\s+[A-Z][a-z]+,\s+[A-Z]\./
    ];
    return topics.filter(t => {
        const trimmed = t.trim();
        if (trimmed.length < 10 || trimmed.length > 200) return false;
        return !patterns.some(pattern => pattern.test(trimmed));
    });
}

// Build the Universal Deep-Learning Prompt for a single unit (returns raw string, NOT prefixed)
function buildUnitPrompt(course, unit, topicsBlock, outcomesBlock, discussBlock, assignBlock) {
    return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 UNIVERSAL DEEP-LEARNING PROMPT FOR: ${unit}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Role: Elite Academic Mentor, Instructional Designer & Subject Matter Expert in the field of ${course}.

Task: Generate an EXHAUSTIVE, UNTRUNCATED Deep-Dive Educational Guide and Script based on the curriculum materials provided. The absolute goal is to maximize cognitive depth, uncover foundational arguments, and provide a rigorous step-by-step logical scaffolding to help students successfully execute this week's assignment.

───────────────────────────────────────
Core Directive for Text Generation (Length & Depth Maximize):
───────────────────────────────────────
- DO NOT summarize, compress, or use high-level platitudes.
- Expand on EVERY sub-topic with maximum granular detail. Write as much as the system limits allow.
- If a concept involves processes, steps, or multi-sided arguments, exhaustively write out each one.

───────────────────────────────────────
Structure & Content Requirements:
───────────────────────────────────────

  🎓 1. Expert Paradigm & Core Thinking Frameworks
     - Identify the TOP 3 expert thinking frameworks, methodologies, or foundational paradigms used by professionals in this specific discipline to analyze this week's topics.
     - Explain the "First Principles" of these frameworks. How do they allow an expert to instantly categorize and understand chaotic data or problems in this field?

  📚 2. Cognitive Depth & Academic/Methodological Controversies
     - For the weekly topics listed below, analyze them through the lens of "Core Mechanisms" and "Theoretical Boundaries".
     - Uncover at least 2 major debates, conflicting schools of thought, or historical/methodological tensions inherent in this week's content (e.g., Paradigm A vs. Paradigm B). Explain the evidence, rationale, and fatal flaws of each side.

  📝 3. Assignment Scaffolding & Systematic Workflow Guide
     - Analyze the specific [Assignment Activity] and [Learning Outcomes] provided below.
     - Without giving direct answers or violating academic integrity, construct a comprehensive "Logical Execution Blueprint" for this assignment.
     - Step-by-Step Breakdown: Walk through the logical phases a student must execute to complete the task successfully.
     - Cognitive Traps & Common Blindspots: Explicitly warn the student about common intellectual errors, logical fallacies, or procedural mistakes students make in this exact assignment.
     - Self-Verification Strategy: Provide a concrete method for the student to rigorously test or evaluate their own work before submission.

  🎯 4. Knowledge Projectization & Systemic Integration
     - Synthesize this week's granular knowledge into a "Big Picture" conceptual map.
     - Provide actionable instructions on how to modularize and index these core insights into a Personal Knowledge Management (PKM) system (like Obsidian).

───────────────────────────────────────
Input Data for this Unit:
───────────────────────────────────────

Course Context:
  - Course Name: ${course}

Weekly Topics:
${topicsBlock}

Learning Outcomes:
${outcomesBlock}

Discussion Prompt(s):
${discussBlock}

Assignment Activity:
${assignBlock}`;
}

// Upload full note to Obsidian (Unit-Centric Architecture)
// ─────────────────────────────────────────────────
async function uploadToObsidian(course, results, unitDetails, apiKey) {
    const dateStr = new Date().toISOString().split("T")[0];
    const cleanedCourse = getCleanedCourseName(course);
    const safeName = cleanedCourse.replace(/[/\\?%*:|"<>]/g, "-").trim();

    let md = `---\ncourse: "${course}"\nsynced: "${dateStr}"\n---\n\n`;
    md += `# ${course}\n\n`;

    // ── ① Quick Dashboard ──
    md += `## 📅 Quick Dashboard\n\n`;
    md += `| Unit Period | Type | Task | Deadline |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    results.forEach((item) => {
        if (item.type !== "Resource") {
            const hasDeadline = item.deadline && item.deadline !== "N/A";
            const noteName = obsidianNoteName(course, item.title);
            const taskCell = hasDeadline ? `[[${noteName}]]` : item.title;
            const anchor = getHeaderAnchor(item.unitTime);
            md += `| [${item.unitTime}](#${anchor}) | ${item.type} | ${taskCell} | ${item.deadline} |\n`;
        }
    });

    // ── ② Per-Unit Self-Contained Sections ──
    const unitMap = {};
    for (const item of results) {
        const unit = item.unitTime || "General";
        if (!unitMap[unit]) unitMap[unit] = { readings: [], discussions: [], assignments: [], resources: [] };
        if (item.type === "Reading") unitMap[unit].readings.push(item);
        else if (item.type === "Discussion") unitMap[unit].discussions.push(item);
        else if (item.type === "Assignment") unitMap[unit].assignments.push(item);
        else unitMap[unit].resources.push(item);
    }

    for (const [unit, data] of Object.entries(unitMap)) {
        const meta = (unitDetails || {})[unit] || {};
        const topics = meta.topics || [];
        const outcomes = meta.outcomes || [];

        // Find the earliest deadline in this unit
        const allDeadlines = [...data.discussions, ...data.assignments]
            .map(i => i.deadline)
            .filter(d => d && d !== "N/A");
        const deadlineStr = allDeadlines.length > 0 ? allDeadlines[0] : "N/A";

        md += `\n---\n\n## 📘 ${unit}\n`;
        md += `> 📅 **Deadline:** ${deadlineStr} | ⏳ 狀態：未開始\n\n`;

        // ── Action Checklist ──
        md += `### 🔗 本週核心行動清單\n`;
        md += `* [ ] **Reading**: 閱讀本週教材\n`;
        md += `* [ ] **Discussion**: 參與討論區互動\n`;
        md += `* [ ] **Assignment**: 完成本週指定作業\n\n`;

        // ── Learning Rhythm Guide ──
        const isExamUnit = unit.toLowerCase().includes("unit 9") || unit.includes("9") || unit.toLowerCase().includes("final exam");
        if (isExamUnit) {
            md += `> 💡 **本週學習節奏建議（48hr 攻略）**\n`;
            md += `> D1：回顧所有單元心智模型 → D2：跑模擬題自測 → 提交前確認監考設備\n\n`;
        } else {
            md += `> 💡 **本週學習節奏建議（48hr 攻略）**\n`;
            md += `> 1. **D1 上午｜建立心智模型** — 先跑 🎧 Audio Prompt，邊聽邊在 Obsidian 畫出 3 個核心框架的節點關係。\n`;
            md += `> 2. **D1 下午｜挖掘認知深度** — 跑 🤖 Chat Prompt 的前兩段，把「爭議地圖」記錄在同一份筆記裡。\n`;
            md += `> 3. **D2 上午｜目標對齊** — 用 Chat Prompt 的第三段跑學習目標檢核，對每條 outcome 自問自答一次。\n`;
            md += `> 4. **D2 下午｜作業執行** — 把作業題目貼入 Chat Prompt 第四段，依執行藍圖完成並用自我審核清單把關後提交。\n\n`;
        }

        // ── Foldable Audio Prompt Callout ──
        md += `> [!🎧]- 點擊展開：生成 Podcast 的 Audio Prompt (供聆聽吸收)\n`;
        md += `> Copy the following prompt into NotebookLM's Audio Overview generation box:\n`;
        md += `> \n`;
        md += `> Generate an in-depth, engaging podcast episode for: ${unit}\n`;
        md += `> \n`;
        md += `> You are two expert hosts — one is a senior practitioner in the field,\n`;
        md += `> the other is a sharp academic researcher. Your conversation must cover:\n`;
        md += `> \n`;
        md += `> PART 1 — Mental Model Sprint (心智模型建立)\n`;
        md += `>   "What are the TOP 3-5 thinking frameworks that experts in this field\n`;
        md += `>    universally agree on? Explain each one as if teaching a smart\n`;
        md += `>    newcomer — no jargon without explanation."\n`;
        md += `> \n`;
        md += `> PART 2 — The Battlefield (認知深度挖掘)\n`;
        md += `>   "Where do the experts fundamentally disagree? Pick the 2-3 most\n`;
        md += `>    important unsettled debates in this topic. Present both sides with\n`;
        md += `>    their evidence and the fatal flaw of each."\n`;
        md += `> \n`;
        md += `> PART 3 — Real-World Deployment (實戰應用)\n`;
        md += `>   "If a developer/student had to USE this knowledge tomorrow on a\n`;
        md += `>    real project, what would be the single most important thing to\n`;
        md += `>    get right? What's the classic beginner trap?"\n`;
        md += `> \n`;
        md += `> Rules:\n`;
        md += `> - Never read URLs, code syntax, or raw citations aloud.\n`;
        md += `> - Focus on architectural thinking and trade-offs, not trivia.\n`;
        md += `> - End with one "cliffhanger" question that connects to next week's topic.\n\n`;

        // ── Prepare Prompt Blocks ──
        const cleanedTopicsList = cleanTopics(topics);
        let topicsBlock = "";
        if (cleanedTopicsList.length > 0) {
            topicsBlock = cleanedTopicsList.map(t => `  - ${t}`).join("\n");
        } else {
            const hints = data.readings.map(r => r.title).join(", ");
            topicsBlock = hints ? `  (derived from readings: ${hints})` : "  (not extracted — check Learning Guide Overview)";
        }

        const cleanedOutcomesList = cleanLearningOutcomes(outcomes);
        let outcomesBlock = cleanedOutcomesList.length > 0
            ? cleanedOutcomesList.map(o => `  • ${o}`).join("\n")
            : "  (not extracted — check Learning Guide Overview)";

        // Discussion: use actual scraped prompt text, NOT just the title
        let discussBlock = "";
        if (data.discussions.length > 0) {
            discussBlock = data.discussions.map(d => {
                const promptText = d.discussionPrompt || d.detail || d.title;
                const cleaned = promptText.replace(/\n{3,}/g, "\n\n");
                return `  • ${d.title}\n    ${cleaned}`;
            }).join("\n");
        }
        if (meta.extractedDiscussionPrompt) {
            discussBlock = (discussBlock ? discussBlock + "\n\n" : "") + `  [Extracted Prompts from Guide]:\n    ${meta.extractedDiscussionPrompt.trim().replace(/\n/g, "\n    ")}`;
        }
        if (!discussBlock) {
            discussBlock = "  (none this unit)";
        }

        // Assignment: check if there's an Assignment Activity with rubricText > 100
        let assignBlock = "";
        const assignmentActivity = data.assignments.find(a => a.title.includes("Assignment Activity"));
        if (assignmentActivity) {
            if (assignmentActivity.rubricText && assignmentActivity.rubricText.trim().length > 100) {
                assignBlock = assignmentActivity.rubricText.trim();
            } else {
                assignBlock = `⚠️ NOTE: Assignment questions were not automatically extracted.\nPlease paste the assignment instructions here before continuing.\nAssignment page URL: ${assignmentActivity.url || "(no URL)"}`;
            }
        } else {
            if (data.assignments.length > 0) {
                assignBlock = data.assignments.map(a => {
                    const instrText = a.assignmentInstructions || a.detail || a.title;
                    const cleaned = instrText.replace(/\n{3,}/g, "\n\n");
                    return `  • ${a.title}\n    ${cleaned}`;
                }).join("\n");
            }
            if (meta.extractedAssignmentInstructions) {
                assignBlock = (assignBlock ? assignBlock + "\n\n" : "") + `  [Extracted Instructions from Guide]:\n    ${meta.extractedAssignmentInstructions.trim().replace(/\n/g, "\n    ")}`;
            }
            if (!assignBlock) {
                assignBlock = "  (none this unit)";
            }
        }

        // ── Foldable Chat Prompt Callout ──
        let chatPrompt = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        chatPrompt += `📌 UNIVERSAL CHAT PROMPT FOR ASSIGNMENT & GOALS: ${unit}\n`;
        chatPrompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        chatPrompt += `\n`;
        chatPrompt += `Task: You are an elite professor teaching "${cleanedCourse}". Generate an EXHAUSTIVE, step-by-step Study & Assignment Guide based on the provided materials.\n`;
        chatPrompt += `\n`;
        chatPrompt += `───────────────────────────────────────\n`;
        chatPrompt += `Dynamic Role Adaptation (自適應學科引擎):\n`;
        chatPrompt += `───────────────────────────────────────\n`;
        chatPrompt += `Analyze the "${cleanedCourse}" and the topics. Auto-adjust your pedagogical approach:\n`;
        chatPrompt += `- IF Computer Science/Programming: Focus on System Architecture, logic flow, pseudocode, edge cases, and debugging strategies.\n`;
        chatPrompt += `- IF Math/Statistics: Focus on formulas, assumptions, hypothesis testing, and step-by-step calculation logic (without giving final answers).\n`;
        chatPrompt += `- IF Humanities/Social Sciences: Focus on theoretical frameworks, historical context, debate mapping, and thesis statement formulation.\n`;
        chatPrompt += `\n`;
        chatPrompt += `Structure Requirements:\n`;
        chatPrompt += `───────────────────────────────────────\n`;
        chatPrompt += `\n`;
        chatPrompt += `  🗺️ 1. Expert Mental Model Map（專家心智模型）\n`;
        chatPrompt += `     - 列出本週主題中，業界專家公認最重要的 3 個核心思考框架。\n`;
        chatPrompt += `     - 用「第一性原理」解釋每個框架：它解決什麼問題？\n`;
        chatPrompt += `       沒有它的話，初學者會在哪裡卡住？\n`;
        chatPrompt += `     - 將這 3 個框架整理成一張可存入 Obsidian 的概念地圖結構\n`;
        chatPrompt += `       （用縮排的 bullet 呈現節點與連結關係）。\n`;
        chatPrompt += `\n`;
        chatPrompt += `  ⚔️ 2. The Battlefield — Cognitive Depth（認知深度：學科爭議地圖）\n`;
        chatPrompt += `     - 找出本週內容中，專家之間存在根本分歧的 2 個核心議題。\n`;
        chatPrompt += `     - 對每個議題：說明正反兩方的論點與證據，\n`;
        chatPrompt += `       以及各自的「致命缺陷」是什麼。\n`;
        chatPrompt += `     - 明確標示哪些是「已成定論」，哪些是「仍在爭議中」。\n`;
        chatPrompt += `\n`;
        chatPrompt += `  🎯 3. Outcome Mastery Checklist（學習目標達成檢核）\n`;
        chatPrompt += `     - 逐條對照下方提供的 [Learning Outcomes]。\n`;
        chatPrompt += `     - 為每條 outcome 生成：\n`;
        chatPrompt += `       a) 一個可以當場自測的「主動回憶問題」\n`;
        chatPrompt += `       b) 「達標的具體證明」：我能做到什麼，才算真的會了？\n`;
        chatPrompt += `       c) 「最常見的錯誤認知」：學生以為自己懂但其實沒懂的地方。\n`;
        chatPrompt += `\n`;
        chatPrompt += `  📝 4. Assignment Execution Blueprint（作業專案執行藍圖）\n`;
        chatPrompt += `     - 將本週作業視為一個「軟體開發小專案」來規劃：\n`;
        chatPrompt += `       a) 專案目標：用一句話說清楚這份作業要證明什麼能力。\n`;
        chatPrompt += `       b) 執行階段拆解：列出完成作業的邏輯步驟\n`;
        chatPrompt += `          （CS 類：file structure + logic flow；\n`;
        chatPrompt += `           人文類：論點架構 + 段落邏輯）。\n`;
        chatPrompt += `       c) 地雷清單：列出 3 個這份作業最常見的扣分陷阱。\n`;
        chatPrompt += `       d) 提交前自我審核：給我 5 個 yes/no 問題，\n`;
        chatPrompt += `          全部回答「是」才能送出。\n`;
        chatPrompt += `     - ⚠️ FAIL-SAFE：若 [Assignment Details] 為空或只有連結，\n`;
        chatPrompt += `       不要假設題目內容。改為輸出：\n`;
        chatPrompt += `       「請將作業題目貼於此處，我將為你生成對應的執行藍圖。\n`;
        const assignmentUrlVal = assignmentActivity ? (assignmentActivity.url || "") : "";
        chatPrompt += `         作業頁面 URL：${assignmentUrlVal}」\n`;
        chatPrompt += `\n`;
        chatPrompt += `───────────────────────────────────────\n`;
        chatPrompt += `Input Data for this Unit:\n`;
        chatPrompt += `───────────────────────────────────────\n`;
        chatPrompt += `Course Name: ${cleanedCourse}\n`;
        chatPrompt += `Topics: \n${topicsBlock}\n`;
        chatPrompt += `Learning Outcomes: \n${outcomesBlock}\n`;
        chatPrompt += `Assignment Details & Rubrics: \n${assignBlock}\n`;
        chatPrompt += `Discussion Prompts: \n${discussBlock}`;

        md += `> [!🤖]- 點擊展開：生成作業破關攻略的 Chat Prompt (供實作檢核)\n`;
        md += `> Copy the following prompt into NotebookLM's Text Chat box:\n`;
        md += `> \n`;
        md += calloutLines(chatPrompt) + "\n\n";

        // ── Foldable Scraped Content Callout ──
        let scrapedContentData = "";
        const allItems = [...data.readings, ...data.discussions, ...data.assignments, ...data.resources];
        if (allItems.length > 0) {
            allItems.forEach((item, idx) => {
                if (idx > 0) scrapedContentData += "\n";
                scrapedContentData += `**${item.type}: ${item.title}**\n`;
                scrapedContentData += `- URL: ${item.url}\n`;
                if (item.deadline && item.deadline !== "N/A") {
                    scrapedContentData += `- Deadline: ${item.deadline}\n`;
                }
                if (item.detail && item.detail.length > 5) {
                    const detailText = item.detail.replace(/\n{3,}/g, "\n\n");
                    scrapedContentData += detailText + "\n";
                }
                if (item.rubricText && item.rubricText.length > 5) {
                    scrapedContentData += "\n--- Rubric & Instructions ---\n" + item.rubricText + "\n";
                }
            });
        } else {
            scrapedContentData += `_No scraped content available for this unit._\n`;
        }

        // Links for this unit
        let requiredLinksData = "";
        const unitLinks = [];
        for (const item of allItems) {
            if (item.detail) {
                for (const m of item.detail.matchAll(/\[([\s\S]*?)\]\((https?:\/\/[^)]+)\)/g)) {
                    const label = m[1].replace(/^[🎥📄]\s*/, "").trim();
                    const linkUrl = m[2];
                    if (!linkUrl.includes("my.uopeople.edu") && !linkUrl.includes("learn.uopeople.edu")) {
                        // Check for duplicates
                        if (!unitLinks.some(ul => ul.url === linkUrl)) {
                            unitLinks.push({ label, url: linkUrl });
                        }
                    }
                }
            }
        }
        if (unitLinks.length > 0) {
            unitLinks.forEach((link, idx) => {
                if (idx > 0) requiredLinksData += "\n";
                requiredLinksData += `- [${link.label}](${link.url})`;
            });
        } else {
            requiredLinksData += `_No external links found for this unit._`;
        }

        md += `> [!📝]- 點擊展開：本週教材與作業原始文本 (Scraped Data Dump)\n`;
        md += `> ### 📖 Scraped Text & Details\n`;
        md += calloutLines(scrapedContentData.trim()) + "\n";
        md += `> \n`;
        md += `> ### 🔗 Required Links\n`;
        md += calloutLines(requiredLinksData.trim()) + "\n";
    }

    // ── Upload to Obsidian ──
    try {
        const url = `${getObsidianBaseUrl()}/vault/UoPeople/${encodeURIComponent(safeName)}_Summary.md`;
        console.log(`📤 Uploading to Obsidian: ${url}`);
        const res = await fetch(url, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "text/markdown",
            },
            body: md,
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            setStatus(
                `❌ Obsidian push failed (HTTP ${res.status}).\n` +
                `URL: ${url}\n` +
                `Response: ${body.substring(0, 100) || "(empty)"}\n` +
                `Check your API Key and that the vault folder "UoPeople" exists.`
            );
            return false;
        }
        console.log("✅ Note uploaded successfully.");
        return true;
    } catch (err) {
        setStatus(
            `❌ Cannot connect to Obsidian.\n` +
            `Protocol: ${obsidianProtocol || "unknown"}\n` +
            `Error: ${err.message}\n` +
            `Make sure the Local REST API plugin is running.`
        );
        return false;
    }
}

// ─────────────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, ms));