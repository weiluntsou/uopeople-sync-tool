const fs = require('fs');
let content = fs.readFileSync('popup.js', 'utf8');

// Also add debug to the existence check
const searchStr = `    // ── Sequential existence check (prevents Chrome connection queue timeout) ──
    setStatus("🔍 檢查 Obsidian 中的現有檔案...");`;

const replaceStr = `    // ── Sequential existence check (prevents Chrome connection queue timeout) ──
    setStatus("🔍 檢查 Obsidian 中的現有檔案...");
    console.log("🔍 Checking", pendingFiles.length, "files for existence. baseUrl:", getObsidianBaseUrl());`;

if (content.includes(searchStr)) {
    content = content.replace(searchStr, replaceStr);
    fs.writeFileSync('popup.js', content, 'utf8');
    console.log("Added debug logs to existence check.");
} else {
    console.log("Could not find existence check to inject logs.");
}
