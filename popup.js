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
                        filename: `UoPeople/${courseName.replace(/[/\\?%*:|"<>]/g, "-")}/${filename}`,
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
            `Downloads/UoPeople/${courseName}/\n\n` +
            `📝 Obsidian note updated with downloaded file list.`
        );
    } else {
        setActionStatus(`✅ Downloaded ${successCount}/${uopUrls.length} file(s).`);
    }
}

// Append downloaded file list to the existing Obsidian note
async function appendDownloadedFilesToNote(course, filenames, apiKey) {
    const safeName = course.replace(/[/\\?%*:|"<>]/g, "-").trim();
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

// Generate a clean Obsidian-safe note name for wiki-links
function obsidianNoteName(course, title) {
    const safeCourse = course.replace(/[/\\?%*:|"<>]/g, "-").trim();
    const safeTitle = title.replace(/[/\\?%*:|"<>]/g, "-").replace(/\[|\]/g, "").trim();
    return `${safeCourse} - ${safeTitle}`;
}

// Weekly summary table (English)
function buildWeeklySummaryTable(results) {
    const unitMap = {};
    for (const item of results) {
        const unit = item.unitTime || "General";
        if (!unitMap[unit]) unitMap[unit] = { readings: [], discussions: [], assignments: [] };
        if (item.type === "Reading") unitMap[unit].readings.push(item);
        else if (item.type === "Discussion") unitMap[unit].discussions.push(item);
        else if (item.type === "Assignment") unitMap[unit].assignments.push(item);
    }

    let table = `| Week / Unit | Reading Materials | Discussion Topics | Assignments | Nearest Deadline |\n`;
    table += `| :--- | :--- | :--- | :--- | :--- |\n`;

    for (const [unit, data] of Object.entries(unitMap)) {
        const readingStr = data.readings.length > 0 ? data.readings.map(r => r.title).join(", ") : "—";
        const discussStr = data.discussions.length > 0 ? data.discussions.map(d => `[${d.title}](${d.url})`).join("<br>") : "—";
        const assignStr = data.assignments.length > 0 ? data.assignments.map(a => `[${a.title}](${a.url})`).join("<br>") : "—";
        const deadlines = [...data.discussions, ...data.assignments].map(i => i.deadline).filter(d => d && d !== "N/A");
        const deadline = deadlines.length > 0 ? deadlines[0] : "N/A";
        table += `| ${unit} | ${readingStr} | ${discussStr} | ${assignStr} | ${deadline} |\n`;
    }

    return table;
}

// Deep-Learning Study Prompt — Universal template per unit
function buildDeepLearningPrompt(course, results, details) {
    const ud = details || {};

    // Group tasks by unit
    const unitMap = {};
    for (const item of results) {
        const unit = item.unitTime || "General";
        if (!unitMap[unit]) unitMap[unit] = { readings: [], discussions: [], assignments: [] };
        if (item.type === "Reading") unitMap[unit].readings.push(item);
        else if (item.type === "Discussion") unitMap[unit].discussions.push(item);
        else if (item.type === "Assignment") unitMap[unit].assignments.push(item);
    }

    // Build one prompt block per unit
    const blocks = [];

    for (const [unit, data] of Object.entries(unitMap)) {
        const meta = ud[unit] || {};
        const topics = meta.topics || [];
        const outcomes = meta.outcomes || [];

        // Topics block
        let topicsBlock = "";
        if (topics.length > 0) {
            topicsBlock = topics.map(t => `  - ${t}`).join("\n");
        } else {
            const hints = data.readings.map(r => r.title).join(", ");
            topicsBlock = hints ? `  (derived from readings: ${hints})` : "  (not extracted — check Learning Guide Overview)";
        }

        // Learning Outcomes block
        let outcomesBlock = outcomes.length > 0
            ? outcomes.map(o => `  • ${o}`).join("\n")
            : "  (not extracted — check Learning Guide Overview)";

        // Discussion Prompts block
        let discussBlock = data.discussions.length > 0
            ? data.discussions.map(d => `  • "${d.title}"`).join("\n")
            : "  (none this unit)";

        // Assignments block
        let assignBlock = data.assignments.length > 0
            ? data.assignments.map(a => `  • ${a.title}`).join("\n")
            : "  (none this unit)";

        blocks.push(
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
     - Uncover at least 2 major debates, conflicting schools of thought, or historical/methodological tensions inherent in this week's content (e.g., Paradigm A vs. Paradigm B, or empirical limitations of a certain model). Explain the evidence, rationale, and fatal flaws of each side.

  📝 3. Assignment Scaffolding & Systematic Workflow Guide
     - Analyze the specific [Assignment Activity] and [Learning Outcomes] provided below.
     - Without giving direct answers or violating academic integrity, construct a comprehensive "Logical Execution Blueprint" for this assignment.
     - Step-by-Step Breakdown: Walk through the logical phases a student must execute to complete the task successfully.
     - Cognitive Traps & Common Blindspots: Explicitly warn the student about common intellectual errors, logical fallacies, or procedural mistakes students make in this exact assignment.
     - Self-Verification Strategy: Provide a concrete method for the student to rigorously test or evaluate their own work before submission to ensure it aligns with grading rubric expectations.

  🎯 4. Knowledge Projectization & Systemic Integration
     - Synthesize this week's granular knowledge into a "Big Picture" conceptual map.
     - Provide actionable instructions on how to modularize and index these core insights into a Personal Knowledge Management (PKM) system (like Obsidian), turning temporary class topics into a lifelong reusable intellectual asset.

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
${assignBlock}`
        );
    }

    return blocks.join("\n\n\n");
}

// ─────────────────────────────────────────────────




// ─────────────────────────────────────────────────


// Upload full note to Obsidian
// ─────────────────────────────────────────────────
async function uploadToObsidian(course, results, unitDetails, apiKey) {
    const dateStr = new Date().toISOString().split("T")[0];
    const safeName = course.replace(/[/\\?%*:|"<>]/g, "-").trim();

    let md = `---\ncourse: "${course}"\nsynced: "${dateStr}"\n---\n\n`;
    md += `# ${course}\n\n`;

    // ── ① Course Schedule ──
    md += `## 📅 Course Schedule\n\n`;
    md += `| Unit Period | Type | Task | Deadline |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    results.forEach((item) => {
        if (item.type !== "Resource") {
            const noteName = obsidianNoteName(course, item.title);
            md += `| ${item.unitTime} | ${item.type} | [[${noteName}]] | ${item.deadline} |\n`;
        }
    });

    // ── ② Weekly Key Points Summary ──
    md += `\n---\n\n## 📊 Weekly Key Points Summary\n\n`;
    md += buildWeeklySummaryTable(results);

    // ── ③ NotebookLM Source Links (external URLs only) ──
    md += `\n---\n\n## 📒 NotebookLM Source Links\n\n`;
    md += `> **How to use:** Copy the URLs below → Go to [NotebookLM](https://notebooklm.google.com/) → Add Source → Website → paste each URL.\n`;
    md += `> *(UoPeople internal URLs are excluded — use the Download button in the extension instead.)*\n\n`;

    if (externalUrls.length > 0) {
        md += "```\n";
        externalUrls.forEach((url) => { md += `${url}\n`; });
        md += "```\n";
    } else {
        md += "_No external reading links found for this course._\n";
    }

    // ── ④ UoPeople Internal Files (for download reference) ──
    md += `\n---\n\n## 🔒 UoPeople Internal Files (Login Required)\n\n`;
    md += `> These URLs require authentication. Use the **⬇️ Download UoP Files** button in the extension to bulk-download them.\n\n`;

    if (uopUrls.length > 0) {
        md += `| # | URL |\n| :--- | :--- |\n`;
        uopUrls.forEach((url, i) => {
            const name = decodeURIComponent(url.split("/").pop().split("?")[0]);
            md += `| ${i + 1} | [${name}](${url}) |\n`;
        });
    } else {
        md += "_No UoPeople internal files detected._\n";
    }

    // ── ⑤ Deep-Learning Study Prompt ──
    md += `\n---\n\n## 🎓 Deep-Learning Study Prompt\n\n`;
    md += `> **How to use:** Add the Reading sources (above) to your NotebookLM notebook, then paste the prompt for the relevant unit into the chat to generate an exhaustive deep-dive study guide.\n\n`;
    md += "```\n";
    md += buildDeepLearningPrompt(course, results, unitDetails);
    md += "\n```\n";


    // ── ⑥ Full Material Details ──
    md += `\n---\n\n## 📖 Material Details\n\n`;
    results.forEach((item) => {
        md += `### ${item.title}\n`;
        md += `- **Type**: ${item.type}\n`;
        md += `- **Unit**: ${item.unitTime}\n`;
        md += `- **Deadline**: ${item.deadline}\n`;
        md += `- **URL**: ${item.url}\n\n`;
        if (item.detail) md += `${item.detail}\n`;
        md += `\n---\n`;
    });

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