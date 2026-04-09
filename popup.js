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
let obsidianProtocol = "";  // auto-detected: "https" or "http"

// ─── Auto-detect Obsidian protocol ────────────────
async function detectObsidianProtocol(apiKey) {
    for (const proto of ["https", "http"]) {
        try {
            const res = await fetch(`${proto}://${OBSIDIAN_HOST}/`, {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: AbortSignal.timeout(3000),
            });
            if (res.ok || res.status === 401 || res.status === 403) {
                console.log(`✅ Obsidian detected on ${proto}`);
                obsidianProtocol = proto;
                return proto;
            }
        } catch (e) {
            console.log(`❌ ${proto} failed:`, e.message);
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

    for (const item of results) {
        // Parse ALL markdown links from detail text (handles emoji like 🎥 📄 in label)
        if (item.detail) {
            for (const m of item.detail.matchAll(/\[[\s\S]*?\]\((https?:\/\/[^)]+)\)/g)) {
                const url = m[1];
                if (isUoPeopleFile(url)) {
                    internal.add(url);
                } else if (!url.includes("my.uopeople.edu")) {
                    external.add(url);   // includes YouTube, Vimeo, Kaltura, etc.
                }
            }
        }

        // Reading module URL itself → internal only if it's a downloadable file
        if (item.type === "Reading" && isUoPeopleFile(item.url)) {
            internal.add(item.url);
        }
    }

    return { external: Array.from(external), internal: Array.from(internal) };
}

// Returns true for UoPeople URLs that are likely downloadable files
// (pluginfile.php = Moodle's file-serving endpoint, or has a file extension)
// Note: YouTube/Vimeo/Kaltura hosted on external domains are NOT UoPeople files.
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

// NotebookLM Prompt — Professional Instructional Design format
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

    // Build one prompt block per unit
    const blocks = [];

    for (const [unit, data] of Object.entries(unitMap)) {
        const meta = ud[unit] || {};
        const topics = meta.topics || [];
        const outcomes = meta.outcomes || [];

        // Topics block
        let topicsBlock = "";
        if (topics.length > 0) {
            topicsBlock = topics.map(t => `  - $${t}$`).join("\n");
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

        // Key technical terms from topics (for $term$ emphasis)
        const keyTerms = topics.slice(0, 4).map(t => `$${t.split(/[(),:]/)[0].trim()}$`).join(", ") || "$key concept$";

        blocks.push(
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 PROMPT FOR: ${unit}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Role: Professional Instructional Designer & Senior Teaching Assistant.

Task: Generate an 8–12 minute Educational Video Overview based on the "${course}" curriculum.

───────────────────────────────────────
Instructions for the Video Engine:
───────────────────────────────────────

Scope: Focus exclusively on the content for [${unit}].

Narration Style: Use clear, academic, yet engaging English. Avoid overly robotic phrasing.
Use phrases like "Let's dive into...", "Consider this analogy...", and "The takeaway here is...".

Structure & Visual Emphasis:

  🎬 Introduction (1 min):
     Start with a high-level real-world problem that motivates this week's content.
     Introduce the Weekly Topics and Learning Outcomes listed below.

  📚 Deep Dive (5–6 mins):
     For each topic (${keyTerms}), explain:
       1. The Mechanism — what it is and how it works
       2. The Impact — why it matters for system/real-world performance
     Use the provided sources to reference specific details, architectures, or algorithms.

  💬 Critical Thinking Section (2–3 mins):
     Address the Discussion Prompt below.
     Instead of giving direct answers, provide a Decision Matrix:
       "When evaluating [the topic], consider these 3 factors..."
     Help students build their own reasoning framework.

  📝 Practical Guidance (1–2 mins):
     Explicitly mention the Assignment Activity listed below.
     Walk through the technical requirements and highlight common student errors.

  🎯 Wrap-up (1 min):
     Synthesize the Learning Outcomes into a "Big Picture" summary.
     Remind students which outcomes they have now achieved.

Technical Constraints:
  - Ground every explanation in the uploaded source documents in this notebook.
  - If sources discuss specific code or algorithms, ensure the video highlights those details.
  - Maintain pacing that allows complex concepts to be absorbed — do not rush critical sections.
  - Use $technical terms$ in the video script wherever you reference core concepts.

───────────────────────────────────────
Input Data for this Video:
───────────────────────────────────────

Topics:
${topicsBlock}

Learning Outcomes (students will be able to):
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