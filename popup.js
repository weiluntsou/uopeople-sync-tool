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
// Helper to extract a clean slug for unit filenames
function getUnitSlug(unitName) {
    if (!unitName) return "Unit0";
    const m = unitName.match(/\bUnit\s*(\d+)\b/i);
    if (m) return `Unit${m[1]}`;
    if (/intro/i.test(unitName) || /introduction/i.test(unitName)) return "Intro";
    if (/final/i.test(unitName) || /exam/i.test(unitName)) return "Exam";
    const digitMatch = unitName.match(/\d+/);
    if (digitMatch) return `Unit${digitMatch[0]}`;
    return "Unit0";
}

// Helper to condense topics list into a summary string
function getCondensedTopicsSummary(cleanedTopicsList, readings) {
    let list = [];
    if (cleanedTopicsList && cleanedTopicsList.length > 0) {
        list = cleanedTopicsList.slice(0, 4).map(t => t.trim());
    } else if (readings && readings.length > 0) {
        list = readings.slice(0, 3).map(r => {
            return r.title
                .replace(/^(Reading Assignment|Reading|Chapter\s+\d+|Ch\.\s*\d+)\s*[:-]?\s*/i, "")
                .trim();
        });
    }
    
    if (list.length === 0) return "";
    
    const joined = list.join(", ");
    if (joined.length > 120) {
        return joined.substring(0, 117) + "...";
    }
    return joined;
}

// Helper to construct the content for the assignment draft note
function buildAssignmentContent(assignmentActivity) {
    let md = `# ${assignmentActivity.title}\n`;
    md += `📅 截止日：${assignmentActivity.deadline || "N/A"}\n`;
    md += `🔗 [前往作業頁面](${assignmentActivity.url || ""})\n\n`;
    md += `## 題目內容\n`;
    if (assignmentActivity.rubricText && assignmentActivity.rubricText.trim().length > 10) {
        md += `${assignmentActivity.rubricText.trim()}\n\n`;
    } else {
        md += `⚠️ 題目未自動擷取，請至上方連結複製題目後貼入此處。\n\n`;
    }
    md += `## 我的草稿\n\n\n\n`;
    md += `## 提交前自我審核\n`;
    md += `- [ ] 符合字數要求\n`;
    md += `- [ ] 已引用 APA 格式\n`;
    md += `- [ ] 已回應所有子問題\n`;
    md += `- [ ] 已檢查計算步驟（數學課適用）\n`;
    md += `- [ ] 已閱讀一遍確認無錯字\n`;
    return md;
}

// Helper to construct the study guide content for a unit
function buildStudyGuideContent(course, unit, data, unitDetails, suffix) {
    const courseCode = getCourseCode(course).replace(/[/\\?%*:|"<>]/g, "-").trim();
    const unitSlug = getUnitSlug(unit);
    const meta = (unitDetails || {})[unit] || {};
    const topics = meta.topics || [];
    const outcomes = meta.outcomes || [];
    
    const cleanedTopicsList = cleanTopics(topics);
    const cleanedOutcomesList = cleanLearningOutcomes(outcomes);
    const topicsSummary = getCondensedTopicsSummary(cleanedTopicsList, data.readings);
    const subjectTitle = topicsSummary ? `${unit} (${topicsSummary})` : unit;
    
    // Find the earliest deadline in this unit
    const allDeadlines = [...data.readings, ...data.discussions, ...data.assignments]
        .map(i => i.deadline)
        .filter(d => d && d !== "N/A");
    const deadlineStr = allDeadlines.length > 0 ? allDeadlines[0] : "N/A";
    
    let md = `# ${unit}\n`;
    md += `> 📅 **Deadline:** ${deadlineStr} | ⏳ 狀態：未開始\n\n`;
    md += `🏠 [[${courseCode}_Homepage${suffix}]] — 回到課程首頁\n\n`;
    
    // ── Action Checklist ──
    md += `### 🔗 本週核心行動清單\n`;
    // Readings
    if (data.readings.length > 0) {
        data.readings.forEach(r => {
            const link = r.url ? `[${r.title}](${r.url})` : r.title;
            md += `* [ ] 📖 ${link} — 本週必讀，完成後才能做作業\n`;
        });
    } else {
        md += `* [ ] ~~📖 無閱讀作業本週~~\n`;
    }
    // Discussions
    if (data.discussions.length > 0) {
        data.discussions.forEach(d => {
            const wikiName = obsidianNoteName(course, d.title);
            const dl = (d.deadline && d.deadline !== "N/A") ? ` — 📅 ${d.deadline}` : "";
            md += `* [ ] 💬 [[${wikiName}]]${dl}\n`;
        });
    } else {
        md += `* [ ] ~~💬 無討論作業本週~~\n`;
    }
    // Assignments (incl. graded quiz)
    if (data.assignments.length > 0) {
        data.assignments.forEach(a => {
            const isQuiz = a.title.toLowerCase().includes("quiz");
            const isAssignmentActivity = a.title.includes("Assignment Activity");
            let wikiName;
            if (isAssignmentActivity) {
                wikiName = `${courseCode}_${unitSlug}_Assignment${suffix}`;
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
    // Self-quiz (from resources)
    const selfQuizItems = data.resources.filter(r => r.title.toLowerCase().includes("self-quiz") || r.title.toLowerCase().includes("self quiz"));
    selfQuizItems.forEach(sq => {
        const link = sq.url ? `[${sq.title}](${sq.url})` : sq.title;
        md += `* [ ] 🧪 ${link} — 自我測驗（不計分）\n`;
    });
    md += `\n`;

    // ── Rhythm Guide ──
    const isExamUnit = unit.toLowerCase().includes("unit 9") ||
        /\bunit\s*9\b/i.test(unit) ||
        unit.toLowerCase().includes("final exam");
    const hasDiscussion = data.discussions.length > 0;
    const hasAssignment = data.assignments.length > 0;
    const hasGradedQuiz = data.assignments.some(a => a.title.toLowerCase().includes("quiz"));
    const hasSelfQuiz = selfQuizItems.length > 0;

    md += `> 💡 **本週學習節奏建議（48hr 攻略）**\n`;
    if (isExamUnit) {
        md += `> 🏁 **考前衝刺模式**\n`;
        md += `> D1 上午：回顧全課程心智模型地圖 → D1 下午：跑 🎧 考試版 Audio Prompt 整理高頻考點\n`;
        md += `> D2 上午：用 🤖 考試版 Chat Prompt 跑模擬題自測 → D2 下午：確認監考設備，最後過一遍錯題清單\n\n`;
    } else if (hasDiscussion && hasAssignment) {
        md += `> 1. **D1 上午｜建立心智模型** — 先跑 🎧 Audio Prompt，邊聽邊在 Obsidian 畫出核心框架。\n`;
        md += `> 2. **D1 下午｜挖掘認知深度** — 跑 🤖 Chat Prompt 前兩段，把「爭議地圖」存入筆記。\n`;
        md += `> 3. **D2 上午｜撰寫討論帖** — 參考 Discussion Prompt，完成初稿並回覆同學至少 1 則。\n`;
        md += `> 4. **D2 下午｜執行作業** — 貼入 Chat Prompt 第四段，依藍圖完成並用自我審核清單把關後提交。\n\n`;
    } else if (hasAssignment && !hasDiscussion) {
        md += `> 1. **D1 上午｜建立心智模型** — 先跑 🎧 Audio Prompt，建立本週核心框架。\n`;
        md += `> 2. **D1 下午｜目標對齊** — 跑 🤖 Chat Prompt 前三段，對每條 Learning Outcome 自問自答。\n`;
        md += `> 3. **D2 整天｜作業衝刺** — 貼入 Chat Prompt 第四段，依藍圖完成並自我審核後提交。\n\n`;
    } else if (hasDiscussion && !hasAssignment) {
        md += `> 1. **D1 上午｜建立心智模型** — 先跑 🎧 Audio Prompt，理解本週核心概念。\n`;
        md += `> 2. **D1 下午｜草稿討論帖** — 依 Discussion Prompt 撰寫初稿，確認論點完整。\n`;
        md += `> 3. **D2 上午｜潤稿發文** — 修改語氣與引用格式，發文後回覆至少 1 位同學。\n\n`;
    } else if (hasGradedQuiz) {
        md += `> 1. **D1｜讀材 + 建立框架** — 閱讀教材，跑 🎧 Audio Prompt 整理重點概念。\n`;
        md += `> 2. **D2 上午｜模擬練習** — 用 🤖 Chat Prompt 跑練習題，找出自己的弱點。\n`;
        md += `> 3. **D2 下午｜正式作答** — 確認時間、環境後進行 Graded Quiz。\n\n`;
    } else if (hasSelfQuiz) {
        md += `> 1. **D1｜讀材吸收** — 閱讀本週教材，邊讀邊記重點。\n`;
        md += `> 2. **D2｜自我測驗驗收** — 完成 Self-Quiz，對錯題加強複習，整理到 Obsidian PKM。\n\n`;
    } else {
        md += `> 輕量週：D1 閱讀材料吸收 → D2 整理 PKM 筆記，建立跨單元連結。\n\n`;
    }

    // ── Audio Prompt Callout ──
    md += `> [!🎧]- 點擊展開：生成 Podcast 的 Audio Prompt (供聆聽吸收)\n`;
    md += `> Copy the following prompt into NotebookLM's Audio Overview generation box:\n`;
    md += `> \n`;
    const cleanedCourse = getCleanedCourseName(course);
    if (isExamUnit) {
        md += `> Generate a comprehensive FINAL EXAM REVIEW podcast for: ${subjectTitle}\n`;
        md += `> \n`;
        if (topicsSummary) {
            md += `> Focus on synthesizing these key course concepts: ${topicsSummary}\n`;
            md += `> \n`;
        }
        md += `> You are two expert hosts doing a "Before the Exam" intensive review session.\n`;
        md += `> Your conversation must cover:\n`;
        md += `> \n`;
        md += `> PART 1 — The Big Picture Map\n`;
        md += `>   "Draw the conceptual map of the ENTIRE course in 5 minutes.\n`;
        md += `>    What are the 5-7 pillars that every exam question will touch?\n`;
        md += `>    How do these pillars connect to each other?"\n`;
        md += `> \n`;
        md += `> PART 2 — High-Yield Trap Detector\n`;
        md += `>   "What are the TOP 5 topics where students lose the most points?\n`;
        md += `>    For each: explain the concept clearly, then explain the typical mistake\n`;
        md += `>    and how to avoid it."\n`;
        md += `> \n`;
        md += `> PART 3 — Speed Round Q&A\n`;
        md += `>   "Fire 10 rapid-fire questions that could appear on the final exam.\n`;
        md += `>    After each, give a crisp model answer in 2-3 sentences."\n`;
        md += `> \n`;
        md += `> Rules:\n`;
        md += `> - Focus on synthesis and cross-topic connections, not isolated details.\n`;
        md += `> - Highlight which topics carry the most weight.\n`;
        md += `> - End with a motivational 30-second closing statement.\n\n`;
    } else {
        md += `> Generate an in-depth, engaging podcast episode for: ${subjectTitle}\n`;
        md += `> \n`;
        if (topicsSummary) {
            md += `> The hosts must focus their discussion on these core topics: ${topicsSummary}\n`;
            md += `> \n`;
        }
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
    }

    // ── Prepare Prompt Blocks ──
    let topicsBlock = "";
    if (cleanedTopicsList.length > 0) {
        topicsBlock = cleanedTopicsList.map(t => `  - ${t}`).join("\n");
    } else {
        const hints = data.readings.map(r => r.title).join(", ");
        topicsBlock = hints ? `  (derived from readings: ${hints})` : "  (not extracted — check Learning Guide Overview)";
    }

    let outcomesBlock = cleanedOutcomesList.length > 0
        ? cleanedOutcomesList.map(o => `  • ${o}`).join("\n")
        : "  (not extracted — check Learning Guide Overview)";

    // Discussion
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

    // Assignment
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

    // Chat Prompt Url
    let assignmentUrlForPrompt = "";
    if (assignmentActivity && assignmentActivity.url) {
        assignmentUrlForPrompt = assignmentActivity.url;
    } else {
        const discussionWithDeadline = data.discussions.find(d => d.deadline && d.deadline !== "N/A");
        if (discussionWithDeadline) {
            assignmentUrlForPrompt = `Discussion 頁面：${discussionWithDeadline.url || ""}（截止 ${discussionWithDeadline.deadline}）`;
        }
    }

    let chatPrompt = "";
    chatPrompt += `📋 使用前請先完成（2 分鐘準備）\n`;
    chatPrompt += `───────────────────────────────────────\n`;
    if (isExamUnit) {
        chatPrompt += `✅ Step 1：確認你已完成所有單元的 Self-Quiz 與 Discussion 回覆\n`;
        chatPrompt += `✅ Step 2：打開本課程所有 Unit 的 Obsidian 筆記作為參考\n`;
        chatPrompt += `✅ Step 3：把下方整段 Prompt 複製貼入 AI 工具\n`;
        chatPrompt += `✅ Step 4：取得 AI 回應後，貼入 Obsidian 的\n`;
        chatPrompt += `           [[${courseCode}_${unitSlug}_StudyGuide${suffix}]] 筆記\n`;
        chatPrompt += `           的「🧠 AI 學習指南輸出」區塊\n`;
    } else {
        chatPrompt += `✅ Step 1：確認你已閱讀本週 Learning Guide（不需全讀，掃 outline 即可）\n`;
        chatPrompt += `✅ Step 2：確認作業說明頁已開啟\n`;
        chatPrompt += `✅ Step 3：把下方整段 Prompt 複製貼入 AI 工具\n`;
        chatPrompt += `✅ Step 4：取得 AI 回應後，貼入 Obsidian 的\n`;
        chatPrompt += `           [[${courseCode}_${unitSlug}_StudyGuide${suffix}]] 筆記\n`;
        chatPrompt += `           的「🧠 AI 學習指南輸出」區塊\n`;
        chatPrompt += `⚠️  若 Assignment 欄位為空：先到作業頁面複製題目，手動補在 [Assignment Details] 處\n`;
        chatPrompt += `\n`;
        chatPrompt += `作業頁面 URL：${assignmentUrlForPrompt || "(本週無作業)"}\n`;
    }
    chatPrompt += `───────────────────────────────────────\n`;
    chatPrompt += `\n`;

    if (isExamUnit) {
        chatPrompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        chatPrompt += `📌 FINAL EXAM PREP PROMPT FOR: ${unit}\n`;
        chatPrompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        chatPrompt += `\n`;
        chatPrompt += `You are an elite exam coach for "${cleanedCourse}". Generate a comprehensive Final Exam Preparation Package:\n`;
        chatPrompt += `\n`;
        chatPrompt += `  🗺️ 1. Course-Wide Knowledge Map\n`;
        chatPrompt += `     - Synthesize ALL units into one conceptual framework.\n`;
        chatPrompt += `     - Identify the top 5-7 cross-cutting themes connecting different units.\n`;
        chatPrompt += `     - For each theme: which units contribute? What's the exam-ready definition?\n`;
        chatPrompt += `\n`;
        chatPrompt += `  🎯 2. High-Yield Topic Analysis\n`;
        chatPrompt += `     - Identify the 5 topics MOST LIKELY to appear on the final exam.\n`;
        chatPrompt += `     - For each: core concept, common student misconception, model answer framework.\n`;
        chatPrompt += `\n`;
        chatPrompt += `  📝 3. Practice Question Set\n`;
        chatPrompt += `     - Generate 5 practice exam questions at varying difficulty levels.\n`;
        chatPrompt += `     - For each: provide a scoring rubric and a model outline answer.\n`;
        chatPrompt += `\n`;
        chatPrompt += `  ✅ 4. Final Checklist\n`;
        chatPrompt += `     - Create a 10-point pre-exam checklist the student should verify before submitting.\n`;
        chatPrompt += `\n`;
        chatPrompt += `───────────────────────────────────────\n`;
        chatPrompt += `Course: ${cleanedCourse}\n`;
    } else {
        chatPrompt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
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
        chatPrompt += `     - 為每條 outcome生成：\n`;
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
        chatPrompt += `         作業頁面 URL：${assignmentUrlForPrompt}」\n`;
        chatPrompt += `\n`;
        chatPrompt += `───────────────────────────────────────\n`;
        chatPrompt += `Input Data for this Unit:\n`;
        chatPrompt += `───────────────────────────────────────\n`;
        chatPrompt += `Course Name: ${cleanedCourse}\n`;
        chatPrompt += `Topics: \n${topicsBlock}\n`;
        chatPrompt += `Learning Outcomes: \n${outcomesBlock}\n`;
        chatPrompt += `Assignment Details & Rubrics: \n${assignBlock}\n`;
        chatPrompt += `Discussion Prompts: \n${discussBlock}`;
    }

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

    // Links for this unit
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

    // ── Blank interactive user sections ──
    md += `## 🧠 AI 學習指南輸出\n`;
    md += `> 使用說明：將 🤖 Chat Prompt 的 AI 回應貼在此處\n\n`;
    md += `[空白，等待貼入 AI 回應]\n\n`;
    md += `## ✍️ 作業草稿區\n`;
    md += `> 使用說明：在此撰寫作業，完成後複製到 LMS 提交\n\n`;
    md += `[空白，等待撰寫]\n\n`;
    md += `## 📌 本週重點摘要（課後回顧用）\n`;
    md += `> 使用說明：完成本週後，用自己的話寫下 3 個最重要的收穫\n\n`;
    md += `[空白，等待填寫]\n`;

    return md;
}

// Main upload to Obsidian orchestrator
async function uploadToObsidian(course, results, unitDetails, apiKey) {
    const dateStr = new Date().toISOString().split("T")[0];
    const courseCode = getCourseCode(course).replace(/[/\\?%*:|"<>]/g, "-").trim();

    // Check if Homepage already exists in Vault
    let suffix = "";
    try {
        const checkUrl = `${getObsidianBaseUrl()}/vault/UoPeople/${encodeURIComponent(courseCode)}_Homepage.md`;
        const checkRes = await fetch(checkUrl, {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (checkRes.ok) {
            const overwrite = confirm(`偵測到此課程已存在 Homepage。是否覆蓋現有檔案？\n\n- 點擊「確定」：覆蓋所有現有檔案（覆蓋舊資料）。\n- 點擊「取消」：另存新檔（在檔名加上時間戳記，不影響舊檔案）。`);
            if (!overwrite) {
                const d = new Date();
                const timestamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
                suffix = `_${timestamp}`;
            }
        }
    } catch (e) {
        console.log("Homepage connection/existence check failed (will try uploading anyway):", e);
    }

    // ── Build Homepage MD ──
    let homepageMd = `---\ncourse: "${course}"\nsynced: "${dateStr}"\n---\n\n`;
    homepageMd += `# ${course}\n\n`;
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
                    taskCell = `[[${courseCode}_${unitSlug}_Assignment${suffix}]]`;
                } else {
                    const noteName = obsidianNoteName(course, item.title);
                    taskCell = `[[${noteName}]]`;
                }
            }
            const anchor = getHeaderAnchor(item.unitTime);
            homepageMd += `| [${item.unitTime}](#${anchor}) | ${item.type} | ${taskCell} | ${item.deadline} |\n`;
        }
    });

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
        const unitSlug = getUnitSlug(unit);
        
        // Find the earliest deadline in this unit
        const allDeadlines = [...data.discussions, ...data.assignments]
            .map(i => i.deadline)
            .filter(d => d && d !== "N/A");
        const deadlineStr = allDeadlines.length > 0 ? allDeadlines[0] : "N/A";

        homepageMd += `\n---\n\n## 📘 ${unit}\n`;
        homepageMd += `> 📅 **Deadline:** ${deadlineStr} | ⏳ 狀態：未開始\n\n`;

        homepageMd += `### 🔗 本週核心行動清單\n`;
        // Readings
        if (data.readings.length > 0) {
            data.readings.forEach(r => {
                const link = r.url ? `[${r.title}](${r.url})` : r.title;
                homepageMd += `* [ ] 📖 ${link} — 本週必讀，完成後才能做作業\n`;
            });
        } else {
            homepageMd += `* [ ] ~~📖 無閱讀作業本週~~\n`;
        }
        // Discussions
        if (data.discussions.length > 0) {
            data.discussions.forEach(d => {
                const wikiName = obsidianNoteName(course, d.title);
                const dl = (d.deadline && d.deadline !== "N/A") ? ` — 📅 ${d.deadline}` : "";
                homepageMd += `* [ ] 💬 [[${wikiName}]]${dl}\n`;
            });
        } else {
            homepageMd += `* [ ] ~~💬 無討論作業本週~~\n`;
        }
        // Assignments (incl. graded quiz)
        if (data.assignments.length > 0) {
            data.assignments.forEach(a => {
                const isQuiz = a.title.toLowerCase().includes("quiz");
                const isAssignmentActivity = a.title.includes("Assignment Activity");
                let wikiName;
                if (isAssignmentActivity) {
                    wikiName = `${courseCode}_${unitSlug}_Assignment${suffix}`;
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
        // Self-quiz (from resources)
        const selfQuizItems = data.resources.filter(r => r.title.toLowerCase().includes("self-quiz") || r.title.toLowerCase().includes("self quiz"));
        selfQuizItems.forEach(sq => {
            const link = sq.url ? `[${sq.title}](${sq.url})` : sq.title;
            homepageMd += `* [ ] 🧪 ${link} — 自我測驗（不計分）\n`;
        });
        homepageMd += `\n`;
        homepageMd += `📋 [[${courseCode}_${unitSlug}_StudyGuide${suffix}]] — 本週學習指南\n`;
    }

    // ── Build full file list to upload ──
    const filesToUpload = [];
    const homepageFileName = `${courseCode}_Homepage${suffix}.md`;
    currentHomepageFilename = homepageFileName;
    filesToUpload.push({ filename: homepageFileName, content: homepageMd });

    for (const [unit, data] of Object.entries(unitMap)) {
        const unitSlug = getUnitSlug(unit);
        
        const studyGuideFileName = `${courseCode}_${unitSlug}_StudyGuide${suffix}.md`;
        const studyGuideContent = buildStudyGuideContent(course, unit, data, unitDetails, suffix);
        filesToUpload.push({ filename: studyGuideFileName, content: studyGuideContent });
        
        const assignmentActivity = data.assignments.find(a => a.title.includes("Assignment Activity"));
        if (assignmentActivity) {
            const assignmentFileName = `${courseCode}_${unitSlug}_Assignment${suffix}.md`;
            const assignmentContent = buildAssignmentContent(assignmentActivity);
            filesToUpload.push({ filename: assignmentFileName, content: assignmentContent });
        }
    }

    // Sequential PUT requests to Obsidian
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