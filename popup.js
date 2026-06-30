/**
 * popup.js  —  UoPeople Sync v4.0
 *
 * v4.0 Changes:
 * - Per-file conflict resolution modal (choose which files to overwrite)
 * - Prompts moved to CourseSummary note (Audio, Chat, Feynman prompts)
 * - StudyGuide simplified to user-editable sections only
 * - Assignment Micro-segmentation (Micro-task breakdown)
 * - Bilingual term annotation in study prompts
 *
 * Features:
 * 1. Deep-scan UoPeople course pages and sync to Obsidian.
 *    The generated Obsidian notes include:
 *       ① {Code}_Homepage.md          — Course dashboard & weekly checklist
 *       ② {Code}_CourseSummary.md     — All Prompts (Audio / Chat / Feynman)
 *       ③ {Code}_{Unit}_StudyGuide.md — User-editable: AI output, notes, drafts
 *       ④ {Code}_{Unit}_Assignment.md — Micro-segmented assignment workspace
 * 2. "Copy Reading Links" button  → clipboard with all external reading URLs.
 * 3. "Download UoP Files" button  → bulk-downloads UoPeople internal files.
 */

let OBSIDIAN_HOST = "127.0.0.1:27124";

// ─── Global State ─────────────────────────────────
let scannedResults = [];   // all scanned tasks
let externalUrls = [];   // external reading links  (for NotebookLM)
let uopUrls = [];   // my.uopeople.edu links   (for download)
let unitDetails = {};   // { unitName: { topics:[], outcomes:[] } }
let courseName = "";
let currentHomepageFilename = "";
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
    const courseCode = getCourseCode(course).replace(/[/\\?%*:|"<>]/g, "-").trim();
    const filename = currentHomepageFilename || `${courseCode}_Homepage.md`;
    const path = `${getObsidianBaseUrl()}/vault/UoPeople/${encodeURIComponent(filename)}`;
    const cleanedCourse = getCleanedCourseName(course);
    const safeName = cleanedCourse.replace(/[/\\?%*:|"<>]/g, "-").trim();

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
// Obsidian strips emoji from headings when building anchors, so we must NOT include emoji in the anchor.
// Rule: lowercase, keep only alphanumeric + spaces + hyphens, replace spaces with hyphens.
function getHeaderAnchor(unitName) {
    return unitName.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")   // strip emoji & special chars
        .trim()
        .replace(/\s+/g, "-");
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
        /^read chapter/i,
        /^is to start class/i,
        /^perhaps someone/i,
        /^you only need/i,
        /^we're excited/i,
        /^remember,/i,
        /^conceptual self-quiz/i,
        /^hands-on (discussion|assignment)/i,
        /^\(ulos\)/i,
        /^never hesitate/i,
        /^revisit the/i,
        /^get ready to/i,
        /^such tools are/i,
        /^as you study/i,
        /^each topic in/i,
        /^will be assessed/i,
        /^your (understanding|achievement)/i,
        /^assessment (of|and)/i,
        /^by mastering/i,
        /^upon completing/i,
        /^super data science/i,
        /^diez, d\./i,
        /^the (video|section|source) (explains|discusses|advises)/i
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
        /\.?\s+[A-Z][a-z]+,\s+[A-Z]\./,
        /^in [A-Z]/i,                    // "In this unit...", "In addition..."
        /^select computer science/i      // platform nav noise
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
     - Provide actionable insights on how these concepts integrate.
     - Identify 2 cross-disciplinary applications (e.g. how does this concept apply to Business, Tech, or Society?).

───────────────────────────────────────
Input Data for this Unit:
───────────────────────────────────────
Course Name: ${getCleanedCourseName(course)}
Topics:
${topicsBlock}
Learning Outcomes:
${outcomesBlock}
Assignment Details & Rubrics:
${assignBlock}
Discussion Prompts:
${discussBlock}`;
}

// Helper to construct the content for the assignment draft note (v4.1 — Clean workspace)
function buildAssignmentContent(assignmentActivity, course) {
    const rubricText = assignmentActivity.rubricText || "";

    let md = `# ${assignmentActivity.title}\n`;
    md += `📅 截止日 **(Deadline)**：${assignmentActivity.deadline || "N/A"}\n`;
    md += `🔗 [前往作業頁面 (Assignment Page)](${assignmentActivity.url || ""})\n\n`;

    md += `## 📋 題目內容 (Assignment Prompt)\n`;
    if (rubricText.trim().length > 10) {
        md += `${rubricText.trim()}\n\n`;
    } else {
        md += `⚠️ 題目未自動擷取 (Not auto-extracted)，請至上方連結複製題目後貼入此處。\n\n`;
    }

    md += `## ✍️ 我的草稿 (Draft)\n\n\n\n`;

    md += `## 提交前自我審核 **(Pre-submission Checklist)**\n`;
    md += `- [ ] 符合字數要求 **(Word count requirement met)**\n`;
    md += `- [ ] 已引用 APA 格式 **(APA citations included)**\n`;
    md += `- [ ] 已回應所有子問題 **(All sub-questions / parts addressed)**\n`;
    md += `- [ ] 已閱讀一遍確認無錯字 **(Proofread for typos and grammar)**\n`;

    return md;
}

// Helper to construct the study guide content for a unit (v4.0 — user-editable only)
// Prompts (Audio, Chat, Feynman) have been moved to CourseSummary note.
function buildStudyGuideContent(course, unit, data, unitDetails, linkSuffix) {
    const courseCode = getCourseCode(course).replace(/[/\\?%*:|"<>]/g, "-").trim();
    const unitSlug = getUnitSlug(unit);
    const meta = (unitDetails || {})[unit] || {};
    const topics = meta.topics || [];
    const outcomes = meta.outcomes || [];

    const cleanedTopicsList = cleanTopics(topics);
    const topicsSummary = getCondensedTopicsSummary(cleanedTopicsList, data.readings);

    // Find the earliest deadline in this unit
    const allDeadlines = [...data.readings, ...data.discussions, ...data.assignments]
        .map(i => i.deadline)
        .filter(d => d && d !== "N/A");
    const deadlineStr = allDeadlines.length > 0 ? allDeadlines[0] : "N/A";

    const isExamUnit = unit.toLowerCase().includes("unit 9") ||
        /\bunit\s*9\b/i.test(unit) ||
        unit.toLowerCase().includes("final exam");

    let md = `# ${unit}\n`;
    md += `> 📅 **Deadline:** ${deadlineStr} | ⏳ 狀態：未開始\n\n`;
    md += `🏠 [[${courseCode}_Homepage${linkSuffix}]] | 📋 [[${courseCode}_CourseSummary${linkSuffix}|提示詞庫]] — 本週 Prompts 在 CourseSummary\n\n`;

    // ── Action Checklist ──
    md += `### 🔗 本週核心行動清單 (Action Checklist)\n`;
    if (data.readings.length > 0) {
        data.readings.forEach(r => {
            const link = r.url ? `[${r.title}](${r.url})` : r.title;
            md += `* [ ] 📖 ${link} — 本週必讀，完成後才能做作業\n`;
        });
    } else {
        md += `* [ ] ~~📖 無閱讀作業本週~~\n`;
    }
    if (data.discussions.length > 0) {
        data.discussions.forEach(d => {
            const wikiName = obsidianNoteName(course, d.title);
            const dl = (d.deadline && d.deadline !== "N/A") ? ` — 📅 ${d.deadline}` : "";
            md += `* [ ] 💬 [[${wikiName}]]${dl}\n`;
        });
    } else {
        md += `* [ ] ~~💬 無討論作業本週~~\n`;
    }
    if (data.assignments.length > 0) {
        data.assignments.forEach(a => {
            const isQuiz = a.title.toLowerCase().includes("quiz");
            const isAssignmentActivity = a.title.includes("Assignment Activity");
            let wikiName;
            if (isAssignmentActivity) {
                wikiName = `${courseCode}_${unitSlug}_Assignment${linkSuffix}`;
            } else {
                wikiName = obsidianNoteName(course, a.title);
            }
            const dl = (a.deadline && a.deadline !== "N/A") ? ` — 📅 ${a.deadline}` : "";
            const icon = isQuiz ? "🧪" : "✍️";
            md += `* [ ] ${icon} [[${wikiName}]]${dl}\n`;
        });
    } else {
        md += `* [ ] ~~✍️ 無作業本週~~\n`;
    }
    const selfQuizItems = data.resources.filter(r => r.title.toLowerCase().includes("self-quiz") || r.title.toLowerCase().includes("self quiz"));
    selfQuizItems.forEach(sq => {
        const link = sq.url ? `[${sq.title}](${sq.url})` : sq.title;
        md += `* [ ] 🧪 ${link} — 自我測驗 (Self-Quiz)（不計分）\n`;
    });
    md += `\n`;

    // ── Rhythm Guide ──
    const hasDiscussion = data.discussions.length > 0;
    const hasAssignment = data.assignments.length > 0;
    const hasGradedQuiz = data.assignments.some(a => a.title.toLowerCase().includes("quiz"));
    const hasSelfQuiz = selfQuizItems.length > 0;

    md += `> 💡 **本週學習節奏建議（48hr 攻略）**\n`;
    if (isExamUnit) {
        md += `> 🏁 **考前衝刺模式 (Exam Sprint Mode)**\n`;
        md += `> D1 上午：回顧全課程心智模型地圖 → D1 下午：跑 🎧 Audio Prompt（見 CourseSummary）整理高頻考點\n`;
        md += `> D2 上午：用 🤖 Chat Prompt 跑模擬題自測 → D2 下午：確認監考設備，最後過一遍錯題清單\n\n`;
    } else if (hasDiscussion && hasAssignment) {
        md += `> 1. **D1 上午｜建立心智模型 (Mental Model)** — 先跑 🎧 Audio Prompt，邊聽邊在 Obsidian 畫出核心框架。\n`;
        md += `> 2. **D1 下午｜深度理解 + 費曼檢核 (Feynman Check)** — 跑 🤖 Chat Prompt 取得學習指南，貼入下方「AI 輸出」區，並根據 AI 的引導逐步完成費曼檢核與初稿。\n`;
        md += `> 3. **D2 上午｜撰寫討論帖 (Discussion Post)** — 參考 Discussion Prompt，完成初稿並回覆同學至少 1 則。\n`;
        md += `> 4. **D2 下午｜執行作業 (Assignment)** — 打開作業筆記，依微型拆解 (Micro-segmentation) 清單逐步完成，用 Checklist 把關後提交。\n\n`;
    } else if (hasAssignment && !hasDiscussion) {
        md += `> 1. **D1 上午｜建立心智模型 (Mental Model)** — 先跑 🎧 Audio Prompt，建立本週核心框架。\n`;
        md += `> 2. **D1 下午｜深度理解 + 費曼檢核 (Feynman Check)** — 跑 🤖 Chat Prompt 取得學習指南，貼入下方「AI 輸出」區，並跟隨 AI 的逐步費曼檢核 (Feynman Check) 指引，找出盲點 (blind spots) 加強閱讀。\n`;
        md += `> 3. **D2 整天｜作業衝刺 (Assignment Sprint)** — 打開作業筆記，依微型拆解 (Micro-segmentation) 清單逐步完成，自我審核後提交。\n\n`;
    } else if (hasDiscussion && !hasAssignment) {
        md += `> 1. **D1 上午｜建立心智模型 (Mental Model)** — 先跑 🎧 Audio Prompt，理解本週核心概念。\n`;
        md += `> 2. **D1 下午｜深度理解 + 費曼檢核 (Feynman Check)** — 跑 🤖 Chat Prompt 取得學習指南，貼入下方「AI 輸出」區，並根據 AI 的引導逐步完成費曼檢核與初稿。\n`;
        md += `> 3. **D2 上午｜潤稿發文 (Post & Reply)** — 修改語氣與引用格式 (citation format)，發文後回覆至少 1 位同學。\n\n`;
    } else if (hasGradedQuiz) {
        md += `> 1. **D1｜讀材 + 建立框架** — 閱讀教材，跑 🎧 Audio Prompt 整理重點概念。\n`;
        md += `> 2. **D2 上午｜模擬練習 (Practice)** — 用 🤖 Chat Prompt 跑練習題，找出自己的弱點 (weak points)。\n`;
        md += `> 3. **D2 下午｜正式作答 (Graded Quiz)** — 確認時間、環境後進行 Graded Quiz。\n\n`;
    } else if (hasSelfQuiz) {
        md += `> 1. **D1｜讀材吸收** — 閱讀本週教材，邊讀邊記重點。\n`;
        md += `> 2. **D2｜自我測驗 (Self-Quiz) 驗收** — 完成 Self-Quiz，對錯題加強複習，整理到 Obsidian PKM。\n\n`;
    } else {
        md += `> 輕量週：D1 閱讀材料吸收 → D2 整理 PKM 筆記，建立跨單元連結 (cross-unit connections)。\n\n`;
    }

    // ── Prompt guide link ──
    md += `> [!INFO] 本週 Prompts 已移至 CourseSummary\n`;
    md += `> 請前往 [[${courseCode}_CourseSummary${linkSuffix}]] 查看本週的：\n`;
    md += `> - 🎧 Podcast Audio Prompt（貼入 NotebookLM 生成 Podcast）\n`;
    md += `> - 🤖 Chat Prompt（貼入 AI 生成破關攻略）\n`;
    md += `> - 🔬 逐步費曼檢核（已整合至 Chat Prompt 輸出中）\n\n`;

    // ── Scraped Data Dump (foldable) ──
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
                if (item.detail.trimStart().startsWith('%PDF')) {
                    scrapedContentData += `[PDF 檔案，請點擊以下連結直接開啟]\nURL: ${item.url}\n`;
                } else {
                    const detailText = item.detail.replace(/\n{3,}/g, "\n\n");
                    scrapedContentData += detailText + "\n";
                }
            }
            if (item.rubricText && item.rubricText.length > 5) {
                scrapedContentData += "\n--- Rubric & Instructions ---\n" + item.rubricText + "\n";
            }
        });
    } else {
        scrapedContentData += `_No scraped content available for this unit._\n`;
    }

    let requiredLinksData = "";
    const unitLinks = [];
    for (const item of allItems) {
        if (item.detail) {
            for (const m of item.detail.matchAll(/\[([\s\S]*?)\]\((https?:\/\/[^)]+)\)/g)) {
                const label = m[1].replace(/^[🎥📄]\s*/, "").trim();
                const linkUrl = m[2];
                if (!linkUrl.includes("my.uopeople.edu") && !linkUrl.includes("learn.uopeople.edu")) {
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
    md += calloutLines(requiredLinksData.trim()) + "\n\n";

    // ── User-editable sections (never auto-overwritten by default) ──
    md += `---\n\n`;
    md += `## 🧠 AI 學習指南與逐步費曼檢核 (AI Study Guide & Feynman Output)\n`;
    md += `> 使用說明：將 🤖 Chat Prompt 的 AI 回應貼在此處。模型會在此引導你逐步進行費曼檢核，並在看筆記和寫作業的過程中，協同寫出費曼回饋。\n\n`;
    md += `[空白，等待貼入 AI 回應與進行費曼互動]\n\n`;

    md += `---\n\n`;

    md += `## ✍️ 作業草稿區 (Assignment Draft)\n`;
    md += `> 使用說明：在此撰寫作業，完成後複製到 LMS 提交\n\n`;
    md += `[空白，等待撰寫]\n\n`;
    md += `## 📌 本週重點摘要（課後回顧用）\n`;
    md += `> 使用說明：完成本週後，用自己的話寫下 3 個最重要的收穫\n\n`;
    md += `[空白，等待填寫]\n`;

    return md;
}


// ─────────────────────────────────────────────────
// buildCourseSummaryContent
// 生成 CourseSummary 筆記，包含所有 Unit 的 Prompt：
//   - 🎧 Audio Prompt (Podcast)
//   - 🤖 Chat Prompt (破關攻略)
//   - 🔬 費曼四段 Prompt
// ─────────────────────────────────────────────────
function buildCourseSummaryContent(course, unitMap, unitDetails, linkSuffix) {
    const dateStr = new Date().toISOString().split("T")[0];
    const courseCode = getCourseCode(course).replace(/[/\\?%*:|"<>]/g, "-").trim();
    const cleanedCourse = getCleanedCourseName(course);

    let md = `---\ncourse: "${course}"\nsynced: "${dateStr}"\n---\n\n`;
    md += `# 📋 ${cleanedCourse} — 提示詞庫 (Prompt Library)\n\n`;
    md += `> 🏠 [[${courseCode}_Homepage${linkSuffix}|回到課程首頁]]\n`;
    md += `> 此筆記由程式自動生成，包含各週的學習提示詞。\n`;
    md += `> 使用者的學習記錄請在各週的 StudyGuide 筆記中編輯。\n\n`;
    md += `---\n\n`;

    for (const [unit, data] of Object.entries(unitMap)) {
        const unitSlug = getUnitSlug(unit);
        const meta = (unitDetails || {})[unit] || {};
        const topics = meta.topics || [];
        const outcomes = meta.outcomes || [];

        const cleanedTopicsList = cleanTopics(topics);
        const cleanedOutcomesList = cleanLearningOutcomes(outcomes);
        const reflectionQuestions = meta.reflectionQuestions || [];
        const topicsSummary = getCondensedTopicsSummary(cleanedTopicsList, data.readings);
        const subjectTitle = topicsSummary ? `${unit} (${topicsSummary})` : unit;
        const cleanedTopicsForPrompt = cleanedTopicsList.slice(0, 3).join("、");
        const firstTopicForPrompt = cleanedTopicsList.length > 0 ? cleanedTopicsList[0] : "[← 使用者手動選一條]";

        const isExamUnit = unit.toLowerCase().includes("unit 9") ||
            /\bunit\s*9\b/i.test(unit) ||
            unit.toLowerCase().includes("final exam");

        const assessmentPatterns = [
            /\bself[- ]?quiz\b/i, /\bassignment\s+activity\b/i, /\bwhere\s+you\s+will\b/i,
            /\bthat\s+will\s+help\s+(you\s+)?to\b/i, /\byou\s+will\s+(take|complete|submit|write|do|conduct)\b/i,
            /\bgraded\s+quiz\b/i, /\blearning\s+journal\b/i, /\bportfolio\s+activity\b/i,
            /\bdiscussion\s+(assignment|forum|post)\b/i,
        ];
        const trueULOs = cleanedOutcomesList.filter(o => !assessmentPatterns.some(p => p.test(o)));
        const assessmentContext = cleanedOutcomesList.filter(o => assessmentPatterns.some(p => p.test(o)));

        md += `## 📘 ${unit}\n`;
        md += `> 📋 學習指南：[[${courseCode}_${unitSlug}_StudyGuide${linkSuffix}]]\n\n`;

        // ── 1. Audio Prompt ──
        const hasOverviewData = cleanedTopicsList.length > 0 || cleanedOutcomesList.length > 0;
        let audioPart = "";
        if (!hasOverviewData) {
            audioPart += `> ⚠️ **警告 (Warning)：未成功取得 Unit Overview 的 Topics 及 Learning Outcomes。**\n`;
            audioPart += `> 產出的 Podcast 將缺乏本週核心學習重點，聽的價值大幅降低。\n`;
            audioPart += `> 請先確認 Learning Guide 頁面是否正確載入後重新擷取。\n`;
            audioPart += `> \n`;
        }
        audioPart += `> Copy the following prompt into NotebookLM's Audio Overview generation box:\n> \n`;

        if (isExamUnit) {
            audioPart += `> You are an expert AI tasked with generating a comprehensive FINAL EXAM\n`;
            audioPart += `> REVIEW podcast for: ${subjectTitle}\n> \n`;
            audioPart += `> ### COURSE CONTEXT\n`;
            if (topicsSummary) { audioPart += `> Focus on synthesizing these key course concepts: ${topicsSummary}\n> \n`; }
            if (trueULOs.length > 0) {
                audioPart += `> **Learning Outcomes (cross-reference checkpoints):**\n`;
                audioPart += `> Make sure the review covers ALL of them:\n`;
                trueULOs.forEach((o, i) => { audioPart += `> ${i + 1}. ${o}\n`; });
                audioPart += `> \n`;
            }
            audioPart += `> ### HOST PERSONAS\n`;
            audioPart += `> You are two expert hosts doing a "Before the Exam" intensive review session.\n`;
            audioPart += `> - Host A (The Practitioner): Focuses on real-world application and "why this matters."\n`;
            audioPart += `> - Host B (The Academic): Focuses on theory, logic, and catching technical nuances.\n> \n`;
            audioPart += `> ### EPISODE STRUCTURE\n> \n`;
            audioPart += `> **PART 1 — The Big Picture Map**: Draw the conceptual map of the ENTIRE course. What are the 5-7 pillars?\n> \n`;
            audioPart += `> **PART 2 — High-Yield Trap Detector**: Top 5 topics where students lose the most points.\n> \n`;
            audioPart += `> **PART 3 — Speed Round Q&A**: 10 rapid-fire exam questions with crisp model answers.\n> \n`;
            audioPart += `> ### STRICT RULES\n`;
            audioPart += `> - Focus on synthesis and cross-topic connections, not isolated details.\n`;
            audioPart += `> - Never read URLs, code syntax, or raw citations aloud.\n`;
            audioPart += `> - End with a motivational 30-second closing statement.\n`;
        } else {
            audioPart += `> You are an expert AI tasked with generating an in-depth, engaging\n`;
            audioPart += `> educational podcast episode based on a specific course unit.\n> \n`;
            audioPart += `> ### COURSE CONTEXT (${subjectTitle})\n`;
            if (cleanedTopicsList.length > 0) {
                audioPart += `> **Core Topics:**\n`;
                cleanedTopicsList.forEach((t, i) => { audioPart += `> ${i + 1}. ${t}\n`; });
                audioPart += `> \n`;
            }
            if (trueULOs.length > 0) {
                audioPart += `> **Official Learning Outcomes (ULOs) — THESE ARE YOUR NORTH STAR:**\n`;
                trueULOs.forEach((o, i) => { audioPart += `> ${i + 1}. ${o}\n`; });
                audioPart += `> \n`;
            }
            if (assessmentContext.length > 0) {
                audioPart += `> **Student Assessments (For context only):**\n`;
                assessmentContext.forEach(a => { audioPart += `> - ${a}\n`; });
                audioPart += `> \n`;
            }
            if (reflectionQuestions.length > 0) {
                audioPart += `> **Key Reflection Questions to explore:**\n`;
                reflectionQuestions.forEach(q => { audioPart += `> - ${q}\n`; });
                audioPart += `> \n`;
            }
            audioPart += `> ### HOST PERSONAS\n`;
            audioPart += `> - Host A (The Practitioner): Senior professional, focuses on real-world application.\n`;
            audioPart += `> - Host B (The Academic): Sharp researcher, focuses on theory and technical nuances.\n> \n`;
            audioPart += `> ### CRITICAL LENGTH & DEPTH RULES\n`;
            audioPart += `> 1. EXPAND THE DIALOGUE: For EVERY Learning Outcome, generate at least 8-10 dialogue turns.\n`;
            audioPart += `> 2. NO RUSHING: If Host A explains, Host B MUST ask a clarifying question before moving on.\n`;
            audioPart += `> 3. DETAILED EXAMPLES: Build mini-scenarios with context and step-by-step thought process.\n> \n`;
            audioPart += `> ### EPISODE STRUCTURE\n> \n`;
            audioPart += `> **PART 1 — Learning Outcome Deep-Dive (學習目標逐條解析)**: Go through EACH ULO one by one.\n> \n`;
            audioPart += `> **PART 2 — Connecting the Dots & Mental Models (概念串聯)**: Show how all outcomes connect.\n> \n`;
            audioPart += `> **PART 3 — Exam-Ready Stress Test (考試級理解力檢核)**: Tricky conceptual questions per ULO.\n> \n`;
            audioPart += `> **OUTRO — 60-Second Summary**: "After listening, you should now be able to..." restate each ULO.\n> \n`;
            audioPart += `> ### STRICT RULES\n`;
            audioPart += `> - Never read URLs, code syntax, or raw citations aloud.\n`;
            audioPart += `> - Keep the dialogue dynamic — use interruptions, agreements, and analogies.\n`;
            audioPart += `> - Focus purely on teaching the concepts.\n`;
        }
        md += `> [!🎧]- 點擊展開：生成 Podcast 的 Audio Prompt (供聆聽吸收)\n`;
        md += audioPart + "\n\n";

        // ── 2. Chat Prompt (破關攻略) ──
        // Build topics/outcomes/assign blocks (same logic as before)
        let topicsBlock = cleanedTopicsList.length > 0
            ? cleanedTopicsList.map(t => `  - ${t}`).join("\n")
            : `  (derived from readings: ${data.readings.map(r => r.title).join(", ") || "check Learning Guide"})`;
        let outcomesBlock = cleanedOutcomesList.length > 0
            ? cleanedOutcomesList.map(o => `  • ${o}`).join("\n")
            : "  (not extracted — check Learning Guide Overview)";

        let discussBlock = "";
        if (data.discussions.length > 0) {
            discussBlock = data.discussions.map(d => {
                const promptText = d.discussionPrompt || d.detail || d.title;
                return `  • ${d.title}\n    ${promptText.replace(/\n{3,}/g, "\n\n")}`;
            }).join("\n");
        }
        if (meta.extractedDiscussionPrompt) {
            discussBlock = (discussBlock ? discussBlock + "\n\n" : "") + `  [Extracted Prompts from Guide]:\n    ${meta.extractedDiscussionPrompt.trim().replace(/\n/g, "\n    ")}`;
        }
        if (!discussBlock) discussBlock = "  (none this unit)";

        let assignBlock = "";
        const assignmentActivity = data.assignments.find(a => a.title.includes("Assignment Activity"));
        if (assignmentActivity) {
            if (assignmentActivity.rubricText && assignmentActivity.rubricText.trim().length > 100) {
                assignBlock = assignmentActivity.rubricText.trim();
            } else {
                assignBlock = `⚠️ NOTE: Assignment questions were not automatically extracted.\nPlease paste the assignment instructions here before continuing.\nAssignment page URL: ${assignmentActivity.url || "(no URL)"}`;
            }
        } else if (data.assignments.length > 0) {
            assignBlock = data.assignments.map(a => {
                const instrText = a.assignmentInstructions || a.detail || a.title;
                return `  • ${a.title}\n    ${instrText.replace(/\n{3,}/g, "\n\n")}`;
            }).join("\n");
            if (meta.extractedAssignmentInstructions) {
                assignBlock += `\n\n  [Extracted Instructions from Guide]:\n    ${meta.extractedAssignmentInstructions.trim().replace(/\n/g, "\n    ")}`;
            }
            if (!assignBlock) assignBlock = "  (none this unit)";
        } else {
            assignBlock = "  (none this unit)";
        }

        let assignmentUrlForPrompt = "";
        if (assignmentActivity && assignmentActivity.url) {
            assignmentUrlForPrompt = assignmentActivity.url;
        } else {
            const discussionWithDeadline = data.discussions.find(d => d.deadline && d.deadline !== "N/A");
            if (discussionWithDeadline) {
                assignmentUrlForPrompt = `Discussion 頁面：${discussionWithDeadline.url || ""}（截止 ${discussionWithDeadline.deadline}）`;
            }
        }

        let chatPrompt = `📋 使用前請先完成（2 分鐘準備）\n`;
        chatPrompt += `───────────────────────────────────────\n`;
        if (isExamUnit) {
            chatPrompt += `✅ Step 1：確認你已完成所有單元的 Self-Quiz 與 Discussion 回覆\n`;
            chatPrompt += `✅ Step 2：打開本課程所有 Unit 的 Obsidian 筆記作為參考\n`;
            chatPrompt += `✅ Step 3：把下方整段 Prompt 複製貼入 AI 工具\n`;
            chatPrompt += `✅ Step 4：取得 AI 回應後，貼入 Obsidian 的\n`;
            chatPrompt += `           [[${courseCode}_${unitSlug}_StudyGuide${linkSuffix}]] 的「🧠 AI 學習指南輸出」區塊\n`;
            chatPrompt += `───────────────────────────────────────\n\n`;
            chatPrompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            chatPrompt += `📌 FINAL EXAM PREP PROMPT FOR: ${unit}\n`;
            chatPrompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            chatPrompt += `You are an elite exam coach for "${cleanedCourse}". Generate a comprehensive Final Exam Preparation Package:\n\n`;
            chatPrompt += `  🗺️ 1. Course-Wide Knowledge Map\n     - Synthesize ALL units into one conceptual framework (概念框架).\n     - Identify the top 5-7 cross-cutting themes (跨單元主題) connecting different units.\n\n`;
            chatPrompt += `  🎯 2. High-Yield Topic Analysis (高頻考點分析)\n     - Identify the 5 topics MOST LIKELY to appear on the final exam.\n     - For each: core concept (核心概念), common student misconception (常見誤解), model answer framework.\n\n`;
            chatPrompt += `  📝 3. Practice Question Set (練習題組)\n     - Generate 5 practice exam questions at varying difficulty levels.\n     - For each: provide a scoring rubric (評分標準) and a model outline answer.\n\n`;
            chatPrompt += `  ✅ 4. Final Checklist (考前清單)\n     - Create a 10-point pre-exam checklist the student should verify before submitting.\n\n`;
            chatPrompt += `───────────────────────────────────────\n`;
            chatPrompt += `Course: ${cleanedCourse}\n`;
        } else {
            chatPrompt += `✅ Step 1：確認你已閱讀本週 Learning Guide（不需全讀，掃 outline 即可）\n`;
            chatPrompt += `✅ Step 2：確認作業說明頁 (Assignment Page) 已開啟\n`;
            chatPrompt += `✅ Step 3：把下方整段 Prompt 複製貼入 AI 工具\n`;
            chatPrompt += `✅ Step 4：取得 AI 回應後，貼入 Obsidian 的\n`;
            chatPrompt += `           [[${courseCode}_${unitSlug}_StudyGuide${linkSuffix}]] 的「🧠 AI 學習指南輸出」區塊\n`;
            chatPrompt += `⚠️  若 Assignment 欄位為空：先到作業頁面複製題目，手動補在 [Assignment Details] 處\n\n`;
            chatPrompt += `作業頁面 URL：${assignmentUrlForPrompt || "(本週無作業)"}\n`;
            chatPrompt += `───────────────────────────────────────\n\n`;
            chatPrompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            chatPrompt += `📌 UNIVERSAL CHAT PROMPT FOR ASSIGNMENT & GOALS: ${unit}\n`;
            chatPrompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            chatPrompt += `Task: You are an elite professor teaching "${cleanedCourse}". Generate an EXHAUSTIVE, step-by-step Study & Assignment Guide based on the provided materials.\n\n`;
            chatPrompt += `───────────────────────────────────────\n`;
            chatPrompt += `Dynamic Role Adaptation (自適應學科引擎):\n`;
            chatPrompt += `───────────────────────────────────────\n`;
            chatPrompt += `Analyze the "${cleanedCourse}" and the topics. Auto-adjust your pedagogical approach:\n`;
            chatPrompt += `- IF Computer Science/Programming: Focus on System Architecture (系統架構), logic flow (邏輯流程), pseudocode (偽代碼), edge cases (邊界案例), and debugging strategies (除錯策略).\n`;
            chatPrompt += `- IF Math/Statistics: Focus on formulas (公式), assumptions (假設), hypothesis testing (假設檢定), and step-by-step calculation logic (逐步計算邏輯) (without giving final answers).\n`;
            chatPrompt += `- IF Humanities/Social Sciences: Focus on theoretical frameworks (理論框架), historical context (歷史背景), debate mapping (論點地圖), and thesis statement formulation (論點構建).\n\n`;
            chatPrompt += `Structure Requirements (結構需求):\n`;
            chatPrompt += `───────────────────────────────────────\n\n`;
            chatPrompt += `  🗺️ 1. Expert Mental Model Map（專家心智模型）\n`;
            chatPrompt += `     - 列出本週主題中，業界專家公認最重要的 3 個核心思考框架 (core frameworks)。\n`;
            chatPrompt += `     - 用「第一性原理 (First Principles)」解釋每個框架：它解決什麼問題 (problem)？\n`;
            chatPrompt += `       沒有它的話，初學者 (beginners) 會在哪裡卡住？\n`;
            chatPrompt += `     - 將這 3 個框架整理成一張可存入 Obsidian 的概念地圖結構\n`;
            chatPrompt += `       （用縮排的 bullet 呈現節點 (nodes) 與連結關係 (connections)）。\n\n`;
            chatPrompt += `  ⚔️ 2. The Battlefield — Cognitive Depth（認知深度：學科爭議地圖）\n`;
            chatPrompt += `     - 找出本週內容中，專家之間存在根本分歧 (fundamental disagreement) 的 2 個核心議題。\n`;
            chatPrompt += `     - 對每個議題：說明正反兩方的論點 (arguments) 與證據 (evidence)，\n`;
            chatPrompt += `       以及各自的「致命缺陷 (fatal flaw)」是什麼。\n`;
            chatPrompt += `     - 明確標示哪些是「已成定論 (established)」，哪些是「仍在爭議中 (debated)」。\n\n`;
            chatPrompt += `  🎯 3. Outcome Mastery Checklist（學習目標達成檢核）\n`;
            chatPrompt += `     - 逐條對照下方提供的 [Learning Outcomes (學習目標)]。\n`;
            chatPrompt += `     - 為每條 outcome 生成：\n`;
            chatPrompt += `       a) 一個可以當場自測的「主動回憶問題 (active recall question)」\n`;
            chatPrompt += `       b) 「達標的具體證明 (mastery evidence)」：我能做到什麼，才算真的會了？\n`;
            chatPrompt += `       c) 「最常見的錯誤認知 (common misconception)」。\n\n`;
            chatPrompt += `  📝 4. Assignment Execution Blueprint（作業執行藍圖）\n`;
            chatPrompt += `     - 將本週作業視為一個「小專案 (mini-project)」來規劃：\n`;
            chatPrompt += `       a) 專案目標 (project goal)：用一句話說清楚這份作業要證明什麼能力。\n`;
            chatPrompt += `       b) 執行階段拆解 (execution phases)：列出完成作業的邏輯步驟\n`;
            chatPrompt += `          （CS 類：file structure + logic flow；人文類：論點架構 + 段落邏輯）。\n`;
            chatPrompt += `       c) 地雷清單 (pitfall list)：列出 3 個這份作業最常見的扣分陷阱 (common mistakes)。\n`;
            chatPrompt += `       d) 提交前自我審核 (pre-submission self-check)：給我 5 個 yes/no 問題，\n`;
            chatPrompt += `          全部回答「是」才能送出。\n`;
            chatPrompt += `     - ⚠️ FAIL-SAFE：若 [Assignment Details] 為空或只有連結，\n`;
            chatPrompt += `       不要假設題目內容。改為輸出：\n`;
            chatPrompt += `       「請將作業題目 (assignment prompt) 貼於此處，我將為你生成對應的執行藍圖。\n`;
            chatPrompt += `         作業頁面 URL：${assignmentUrlForPrompt}」\n\n`;
            chatPrompt += `  🚀 5. Interactive Feynman Coach（費曼引導互動區）\n`;
            chatPrompt += `     - 在學習指南的最後，請你拋出一個「概念核心提問 (Core Concept Question)」給學生。\n`;
            chatPrompt += `     - 告訴學生：「請用 3-5 句話回覆你對本週核心概念的理解。收到後，我將指出你的盲點 (blind spots)，並提供 2 個日常生活類比 (everyday analogies) 幫助你鎖定記憶。」\n`;
            chatPrompt += `     - ⚠️ 請不要一次給出所有答案，必須引導學生親自回覆來完成費曼檢核。\n\n`;
            chatPrompt += `───────────────────────────────────────\n`;
            chatPrompt += `Input Data for this Unit:\n`;
            chatPrompt += `───────────────────────────────────────\n`;
            chatPrompt += `Course Name: ${cleanedCourse}\n`;
            chatPrompt += `Topics:\n${topicsBlock}\n`;
            chatPrompt += `Learning Outcomes:\n${outcomesBlock}\n`;
            chatPrompt += `Assignment Details & Rubrics:\n${assignBlock}\n`;
            chatPrompt += `Discussion Prompts:\n${discussBlock}`;
        }

        md += `> [!🤖]- 點擊展開：生成作業破關攻略的 Chat Prompt (供實作檢核)\n`;
        md += calloutLines(chatPrompt) + "\n\n";

        md += `---\n\n`;
    }

    return md;
}

// Main upload to Obsidian orchestrator

async function uploadToObsidian(course, results, unitDetails, apiKey) {
    const dateStr = new Date().toISOString().split("T")[0];
    const courseCode = getCourseCode(course).replace(/[/\\?%*:|"<>]/g, "-").trim();

    // ── Build unit map ──
    const unitMap = {};
    for (const item of results) {
        const unit = item.unitTime || "General";
        if (!unitMap[unit]) unitMap[unit] = { readings: [], discussions: [], assignments: [], resources: [] };
        if (item.type === "Reading") unitMap[unit].readings.push(item);
        else if (item.type === "Discussion") unitMap[unit].discussions.push(item);
        else if (item.type === "Assignment") unitMap[unit].assignments.push(item);
        else unitMap[unit].resources.push(item);
    }

    // ── Build full file list to prepare ──
    // We collect all filenames first so we can batch-check existence and show modal
    const pendingFiles = [];

    // Homepage
    pendingFiles.push({ baseFilename: `${courseCode}_Homepage.md`, type: 'homepage' });

    // CourseSummary (contains all Prompts — Audio, Chat, Feynman)
    pendingFiles.push({ baseFilename: `${courseCode}_CourseSummary.md`, type: 'summary' });

    for (const [unit] of Object.entries(unitMap)) {
        const unitSlug = getUnitSlug(unit);
        pendingFiles.push({ baseFilename: `${courseCode}_${unitSlug}_StudyGuide.md`, type: 'studyguide' });
        const assignmentActivity = unitMap[unit].assignments.find(a => a.title.includes("Assignment Activity"));
        if (assignmentActivity) {
            pendingFiles.push({ baseFilename: `${courseCode}_${unitSlug}_Assignment.md`, type: 'assignment' });
        }
    }

    // ── Parallel existence check ──
    setStatus("🔍 檢查 Obsidian 中的現有檔案...");
    const existenceResults = await Promise.allSettled(
        pendingFiles.map(f =>
            fetch(`${getObsidianBaseUrl()}/vault/UoPeople/${encodeURIComponent(f.baseFilename)}`, {
                method: "GET",
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: AbortSignal.timeout(4000),
            }).then(r => ({ filename: f.baseFilename, exists: r.ok }))
            .catch(() => ({ filename: f.baseFilename, exists: false }))
        )
    );

    const existingFilenames = new Set(
        existenceResults
            .filter(r => r.status === 'fulfilled' && r.value.exists)
            .map(r => r.value.filename)
    );

    const conflictFiles = pendingFiles
        .filter(f => existingFilenames.has(f.baseFilename))
        .map(f => ({ filename: f.baseFilename }));

    // ── Show conflict modal if any files already exist ──
    let fileDecisions = new Map(); // filename -> 'overwrite' | 'timestamp'
    if (conflictFiles.length > 0) {
        setStatus(`⚠️ 發現 ${conflictFiles.length} 個重複檔案，請選擇處理方式...`);
        fileDecisions = await showFileConflictModal(conflictFiles);
    }

    // ── Generate timestamp suffix once (for any file that needs it) ──
    const d = new Date();
    const globalTimestamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

    // Helper: resolve actual filename with optional timestamp suffix
    function resolveFilename(baseFilename) {
        if (!existingFilenames.has(baseFilename)) return baseFilename; // new file, no conflict
        const decision = fileDecisions.get(baseFilename) || 'timestamp';
        if (decision === 'overwrite') return baseFilename;
        // Insert timestamp before .md
        return baseFilename.replace(/\.md$/, `_${globalTimestamp}.md`);
    }

    // ── Determine suffix for wiki-link consistency ──
    // We use homepage's decision to set the global link suffix (for cross-note links)
    const homepageBase = `${courseCode}_Homepage.md`;
    const homepageDecision = fileDecisions.get(homepageBase) || 'overwrite';
    const linkSuffix = (existingFilenames.has(homepageBase) && homepageDecision === 'timestamp')
        ? `_${globalTimestamp}` : "";

    // ── Build Homepage MD ──
    let homepageMd = `---\ncourse: "${course}"\nsynced: "${dateStr}"\n---\n\n`;
    homepageMd += `# ${course}\n\n`;
    homepageMd += `> 🗂️ 本課程筆記 | [[${courseCode}_CourseSummary${linkSuffix}|📋 提示詞庫 CourseSummary]]\n\n`;
    homepageMd += `## 📅 Quick Dashboard\n\n`;
    homepageMd += `| Unit Period | Type | Task | Deadline |\n`;
    homepageMd += `| :--- | :--- | :--- | :--- |\n`;

    results.forEach((item) => {
        if (item.type !== "Resource") {
            const hasDeadline = item.deadline && item.deadline !== "N/A";
            let taskCell = item.title;
            const unitSlug = getUnitSlug(item.unitTime);
            if (hasDeadline) {
                if (item.type === "Assignment" && item.title.includes("Assignment Activity")) {
                    const baseAssignName = `${courseCode}_${unitSlug}_Assignment.md`;
                    const resolvedAssign = resolveFilename(baseAssignName).replace(/\.md$/, "");
                    taskCell = `[[${resolvedAssign}]]`;
                } else {
                    const noteName = obsidianNoteName(course, item.title);
                    taskCell = `[[${noteName}]]`;
                }
            }
            const anchor = getHeaderAnchor(item.unitTime);
            homepageMd += `| [${item.unitTime}](#${anchor}) | ${item.type} | ${taskCell} | ${item.deadline} |\n`;
        }
    });

    for (const [unit, data] of Object.entries(unitMap)) {
        const unitSlug = getUnitSlug(unit);

        // Find the earliest deadline in this unit
        const allDeadlines = [...data.discussions, ...data.assignments]
            .map(i => i.deadline)
            .filter(d => d && d !== "N/A");
        const deadlineStr = allDeadlines.length > 0 ? allDeadlines[0] : "N/A";

        homepageMd += `\n---\n\n## 📘 ${unit}\n`;
        homepageMd += `> 📅 **Deadline:** ${deadlineStr} | ⏳ 狀態：未開始\n\n`;

        homepageMd += `### 🔗 本週核心行動清單\n`;
        if (data.readings.length > 0) {
            data.readings.forEach(r => {
                const link = r.url ? `[${r.title}](${r.url})` : r.title;
                homepageMd += `* [ ] 📖 ${link} — 本週必讀，完成後才能做作業\n`;
            });
        } else {
            homepageMd += `* [ ] ~~📖 無閱讀作業本週~~\n`;
        }
        if (data.discussions.length > 0) {
            data.discussions.forEach(d => {
                const wikiName = obsidianNoteName(course, d.title);
                const dl = (d.deadline && d.deadline !== "N/A") ? ` — 📅 ${d.deadline}` : "";
                homepageMd += `* [ ] 💬 [[${wikiName}]]${dl}\n`;
            });
        } else {
            homepageMd += `* [ ] ~~💬 無討論作業本週~~\n`;
        }
        if (data.assignments.length > 0) {
            data.assignments.forEach(a => {
                const isQuiz = a.title.toLowerCase().includes("quiz");
                const isAssignmentActivity = a.title.includes("Assignment Activity");
                let wikiName;
                if (isAssignmentActivity) {
                    const baseAssignName = `${courseCode}_${unitSlug}_Assignment.md`;
                    wikiName = resolveFilename(baseAssignName).replace(/\.md$/, "");
                } else {
                    wikiName = obsidianNoteName(course, a.title);
                }
                const dl = (a.deadline && a.deadline !== "N/A") ? ` — 📅 ${a.deadline}` : "";
                const icon = isQuiz ? "🧪" : "✍️";
                homepageMd += `* [ ] ${icon} [[${wikiName}]]${dl}\n`;
            });
        } else {
            homepageMd += `* [ ] ~~✍️ 無作業本週~~\n`;
        }
        const selfQuizItems = data.resources.filter(r => r.title.toLowerCase().includes("self-quiz") || r.title.toLowerCase().includes("self quiz"));
        selfQuizItems.forEach(sq => {
            const link = sq.url ? `[${sq.title}](${sq.url})` : sq.title;
            homepageMd += `* [ ] 🧪 ${link} — 自我測驗 (Self-Quiz)（不計分）\n`;
        });
        homepageMd += `\n`;
        const baseStudyGuideName = `${courseCode}_${unitSlug}_StudyGuide.md`;
        const resolvedStudyGuide = resolveFilename(baseStudyGuideName).replace(/\.md$/, "");
        homepageMd += `📋 [[${resolvedStudyGuide}]] — 本週學習指南\n`;
    }

    // ── Build full file list to upload ──
    const filesToUpload = [];

    // Homepage
    const homepageFileName = resolveFilename(`${courseCode}_Homepage.md`);
    currentHomepageFilename = homepageFileName;
    filesToUpload.push({ filename: homepageFileName, content: homepageMd });

    // CourseSummary (contains all Prompts: Audio + Chat + Feynman per unit)
    const summaryBase = `${courseCode}_CourseSummary.md`;
    const summaryFileName = resolveFilename(summaryBase);
    const summaryContent = buildCourseSummaryContent(course, unitMap, unitDetails, linkSuffix);
    filesToUpload.push({ filename: summaryFileName, content: summaryContent });

    // StudyGuide & Assignment per unit
    for (const [unit, data] of Object.entries(unitMap)) {
        const unitSlug = getUnitSlug(unit);

        const studyGuideBase = `${courseCode}_${unitSlug}_StudyGuide.md`;
        const studyGuideFileName = resolveFilename(studyGuideBase);
        const studyGuideContent = buildStudyGuideContent(course, unit, data, unitDetails, linkSuffix);
        filesToUpload.push({ filename: studyGuideFileName, content: studyGuideContent });

        const assignmentActivity = data.assignments.find(a => a.title.includes("Assignment Activity"));
        if (assignmentActivity) {
            const assignBase = `${courseCode}_${unitSlug}_Assignment.md`;
            const assignmentFileName = resolveFilename(assignBase);
            const assignmentContent = buildAssignmentContent(assignmentActivity, course);
            filesToUpload.push({ filename: assignmentFileName, content: assignmentContent });
        }
    }

    // Sequential PUT requests to Obsidian
    setStatus("📤 上傳到 Obsidian...");
    let successCount = 0;
    let failMessages = [];
    for (const file of filesToUpload) {
        const url = `${getObsidianBaseUrl()}/vault/UoPeople/${encodeURIComponent(file.filename)}`;
        console.log(`📤 Uploading to Obsidian: ${url}`);
        try {
            const res = await fetch(url, {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "text/markdown",
                },
                body: file.content,
            });
            if (res.ok) {
                successCount++;
            } else {
                const body = await res.text().catch(() => "");
                failMessages.push(`${file.filename} (HTTP ${res.status}: ${body.substring(0, 50)})`);
            }
        } catch (err) {
            failMessages.push(`${file.filename} (Error: ${err.message})`);
        }
    }

    if (failMessages.length > 0) {
        setStatus(
            `❌ Failed to sync some files to Obsidian:\n` +
            failMessages.join("\n") +
            `\nCheck your API Key, network, and vault configuration.`
        );
        return false;
    }
    console.log("✅ All notes uploaded successfully.");
    return true;
}


// ─────────────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────
// showFileConflictModal
// 顯示逐檔勾選覆蓋的 modal
// conflictFiles: Array of { filename, type }  type: 'existing' | 'new'
// Returns Promise<Map<filename, 'overwrite' | 'timestamp'>>
// ─────────────────────────────────────────────────
function showFileConflictModal(conflictFiles) {
    return new Promise((resolve) => {
        const modal = document.getElementById('conflictModal');
        const fileList = document.getElementById('conflictFileList');
        const confirmBtn = document.getElementById('modalConfirmBtn');
        const selectAllBtn = document.getElementById('modalSelectAllBtn');

        // Build file list
        fileList.innerHTML = '';
        conflictFiles.forEach(({ filename, label }) => {
            const item = document.createElement('div');
            item.className = 'file-item';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.id = `cb_${filename}`;
            cb.dataset.filename = filename;
            // Default: check homepage & summary; leave StudyGuide & Assignment unchecked
            const isUserData = filename.includes('StudyGuide') || filename.includes('Assignment');
            cb.checked = !isUserData;

            const lbl = document.createElement('label');
            lbl.htmlFor = `cb_${filename}`;
            lbl.innerHTML =
                `<span class="file-name">${filename}</span><br>` +
                `<span class="file-status">⚠️ 已存在 — ${isUserData ? '預設保留（使用者資料）' : '預設覆蓋'}</span>`;

            item.appendChild(cb);
            item.appendChild(lbl);
            fileList.appendChild(item);
        });

        // Toggle all
        let allSelected = false;
        selectAllBtn.onclick = () => {
            allSelected = !allSelected;
            fileList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.checked = allSelected;
            });
            selectAllBtn.textContent = allSelected ? '☐ 全部取消' : '☑ 全選';
        };

        // Confirm handler
        confirmBtn.onclick = () => {
            const result = new Map();
            fileList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                result.set(cb.dataset.filename, cb.checked ? 'overwrite' : 'timestamp');
            });
            modal.classList.remove('active');
            resolve(result);
        };

        modal.classList.add('active');
    });
}