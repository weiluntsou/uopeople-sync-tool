const fs = require('fs');
let content = fs.readFileSync('popup.js', 'utf8');

// Wrap the entire async callback body with try/catch
const searchStr = `        chrome.tabs.sendMessage(tab.id, { action: "scanPage" }, async (response) => {
            scanBtn.disabled = false;

            if (!response) {
                setStatus("❌ Scan timed out. Make sure the course page is fully loaded.");
                return;
            }
            if (response.action === "error") {
                setStatus(\`❌ Scan failed: \${response.message}\`);
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
                    \`✅ Sync complete!\\n\` +
                    \`\${scannedResults.length} tasks · \${externalUrls.length} external links · \` +
                    \`\${uopUrls.length} UoPeople files.\\n\` +
                    \`Note includes links, summary table, and NotebookLM prompt.\`
                );
            }
            // If uploadOk is false, uploadToObsidian already set the error status.
        });`;

const replaceStr = `        chrome.tabs.sendMessage(tab.id, { action: "scanPage" }, async (response) => {
            scanBtn.disabled = false;
            try {
                if (!response) {
                    setStatus("❌ Scan timed out. Make sure the course page is fully loaded.");
                    return;
                }
                if (response.action === "error") {
                    setStatus(\`❌ Scan failed: \${response.message}\`);
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
                console.log("🚀 Starting uploadToObsidian...");
                const uploadOk = await uploadToObsidian(courseName, scannedResults, unitDetails, obsidianApiKey);
                console.log("✅ uploadToObsidian returned:", uploadOk);
                setProgress(100);

                showStats();
                enableActionBtns();

                if (uploadOk) {
                    setStatus(
                        \`✅ Sync complete!\\n\` +
                        \`\${scannedResults.length} tasks · \${externalUrls.length} external links · \` +
                        \`\${uopUrls.length} UoPeople files.\\n\` +
                        \`Note includes links, summary table, and NotebookLM prompt.\`
                    );
                }
                // If uploadOk is false, uploadToObsidian already set the error status.
            } catch (err) {
                console.error("💥 CRITICAL ERROR in scan callback:", err);
                setStatus(\`❌ Critical error: \${err.message}\\nSee DevTools console for details.\`);
                scanBtn.disabled = false;
            }
        });`;

if (content.includes(searchStr)) {
    content = content.replace(searchStr, replaceStr);
    fs.writeFileSync('popup.js', content, 'utf8');
    console.log("✅ Wrapped scanPage callback with try/catch.");
} else {
    console.log("❌ Could not find scanPage callback to wrap.");
}
