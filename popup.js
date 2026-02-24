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

const OBSIDIAN_HOST = "127.0.0.1:27124";

// ─── Global State ─────────────────────────────────
let scannedResults = [];   // all scanned tasks
let externalUrls = [];   // external reading links  (for NotebookLM)
let uopUrls = [];   // my.uopeople.edu links   (for download)
let unitDetails = {};   // { unitName: { topics:[], outcomes:[] } }
let courseName = "";
let obsidianApiKey = "";

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
function handleSaveKey() {
    obsidianApiKey = apiKeyInput.value.trim();
    chrome.storage.local.set({ obsidian_key: obsidianApiKey }, () => {
        setStatus("✅ API Key saved.");
    });
}

// ─────────────────────────────────────────────────
// 1. Deep Scan
// ─────────────────────────────────────────────────
async function handleScan() {
    if (!obsidianApiKey) {
        setStatus("❌ Please save your Obsidian API Key first.");
        return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    setStatus("🔍 Checking connection...");

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

            if (!response || response.action !== "final") {
                setStatus("❌ Scan timed out. Make sure the course page is fully loaded.");
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
            await uploadToObsidian(courseName, scannedResults, unitDetails, obsidianApiKey);
            setProgress(100);

            showStats();
            enableActionBtns();
            setStatus(
                `✅ Sync complete!\n` +
                `${scannedResults.length} tasks · ${externalUrls.length} external links · ` +
                `${uopUrls.length} UoPeople files.\n` +
                `Note includes links, summary table, and NotebookLM prompt.`
            );
        });
    });
}

// ─────────────────────────────────────────────────
// Categorise URLs from scan results
// ─────────────────────────────────────────────────
function categorizeUrls(results) {
    const external = new Set();
    const internal = new Set();

    for (const item of results) {
        // Parse markdown links from detail text
        if (item.detail) {
            for (const m of item.detail.matchAll(/\[.*?\]\((https?:\/\/[^)]+)\)/g)) {
                const url = m[1];
                if (isUoPeopleFile(url)) {
                    internal.add(url);
                } else if (!url.includes("my.uopeople.edu")) {
                    external.add(url);
                }
            }
        }

        // Reading module URL itself → internal (needs login)
        if (item.type === "Reading") {
            // The book module page itself is navigational; skip it for downloads.
            // Only add if it looks like a direct file.
            if (isUoPeopleFile(item.url)) internal.add(item.url);
        }
    }

    return { external: Array.from(external), internal: Array.from(internal) };
}

// Returns true for UoPeople URLs that are likely downloadable files
// (pluginfile.php = Moodle's file-serving endpoint, or has a file extension)
function isUoPeopleFile(url) {
    if (!url.includes("my.uopeople.edu")) return false;
    const fileExtensions = /\.(pdf|doc|docx|ppt|pptx|xls|xlsx|zip|mp4|mp3|png|jpg|jpeg|gif)(\?|$)/i;
    return url.includes("pluginfile.php") || fileExtensions.test(url);
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
        const filename = decodeURIComponent(url.split("/").pop().split("?")[0]) || `uop_file_${i + 1}`;

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
    const path = `https://${OBSIDIAN_HOST}/vault/UoPeople/${safeName}_Summary.md`;

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

// NotebookLM Prompt (English) — anchored to Topics & Learning Outcomes
function buildNotebookLMPrompt(course, results, details) {
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

    // Build per-unit data block, leading with Topics → Learning Outcomes → Tasks
    let weekInfo = "";
    for (const [unit, data] of Object.entries(unitMap)) {
        weekInfo += `\n=== ${unit} ===\n`;

        const meta = ud[unit] || {};
        const topics = meta.topics || [];
        const outcomes = meta.outcomes || [];

        // ① Topics (extracted from the course page section summary)
        if (topics.length > 0) {
            weekInfo += `\nTopics:\n`;
            topics.forEach(t => { weekInfo += `  - ${t}\n`; });
        } else {
            // Fallback: use reading material titles as topic hints
            const hints = data.readings.map(r => r.title).join("; ");
            if (hints) weekInfo += `\nReading Materials (no Topics extracted): ${hints}\n`;
        }

        // ② Learning Outcomes
        if (outcomes.length > 0) {
            weekInfo += `\nLearning Outcomes (students will be able to):\n`;
            outcomes.forEach(o => { weekInfo += `  - ${o}\n`; });
        }

        // ③ Discussion & Assignment context
        if (data.discussions.length > 0) {
            weekInfo += `\nDiscussion Prompt(s):\n`;
            data.discussions.forEach(d => { weekInfo += `  - ${d.title}\n`; });
        }
        if (data.assignments.length > 0) {
            weekInfo += `\nAssignment(s):\n`;
            data.assignments.forEach(a => { weekInfo += `  - ${a.title}\n`; });
        }
    }

    return `You are a professional online course instructional designer and teaching assistant for "${course}".

Using the sources added to this notebook AND the structured course data below, generate a complete narration script for an 8–12 minute teaching video.

## Weekly Course Data
${weekInfo.trim()}

---

## Output Format

Produce the full script in the sections below. Every explanation must be grounded in the Topics and Learning Outcomes listed above.

**🎬 Introduction (approx. 60 seconds)**
(Warm greeting + list this week's Topics + state the Learning Outcomes students will achieve)

**📚 Core Concept Explanations (approx. 4–5 minutes)**
(Explain each Topic clearly and at a university-student level.
For each Topic, explicitly connect it to the corresponding Learning Outcome.
Use real-world examples or analogies where helpful.)

**💬 Discussion Prompt Walkthrough (approx. 2–3 minutes)**
(Break down the discussion question(s). Offer a structured thinking framework.
Do NOT write the answer — give 2–3 angles students can explore, linking each to a Learning Outcome.)

**📝 Assignment Guidance (approx. 2 minutes)**
(Clarify requirements, flag common mistakes, and highlight grading criteria.)

**🎯 Closing & Reminders (approx. 60 seconds)**
(Confirm which Learning Outcomes students have now achieved + deadline reminders + encouragement)

---

**📊 Weekly PPT Slide Outline**
(One slide per Topic; title + 3 bullet points per slide. Include a title slide and a closing/summary slide.)

---

Write in clear, friendly English suitable for university students.`;
}

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
            md += `| ${item.unitTime} | ${item.type} | [${item.title}](${item.url}) | ${item.deadline} |\n`;
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

    // ── ⑤ NotebookLM Video Script Prompt ──
    md += `\n---\n\n## 🎬 NotebookLM Video Script Prompt\n\n`;
    md += `> **How to use:** Add the Reading sources (above) to your NotebookLM notebook, then paste this prompt into the chat to generate a teaching video script.\n\n`;
    md += "```\n";
    md += buildNotebookLMPrompt(course, results, unitDetails);
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
        const res = await fetch(
            `https://${OBSIDIAN_HOST}/vault/UoPeople/${safeName}_Summary.md`,
            {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "text/markdown",
                },
                body: md,
            }
        );
        if (!res.ok) setStatus(`❌ Obsidian push failed (HTTP ${res.status}). Check your API Key.`);
    } catch {
        setStatus("❌ Cannot connect to Obsidian. Make sure the Local REST API plugin is running.");
    }
}

// ─────────────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, ms));