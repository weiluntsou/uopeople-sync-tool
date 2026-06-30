const fs = require('fs');

try {
    let content = fs.readFileSync('popup.js', 'utf8');
    
    const searchString = `    // ── Parallel existence check ──
    setStatus("🔍 檢查 Obsidian 中的現有檔案...");
    const existenceResults = await Promise.allSettled(
        pendingFiles.map(f =>
            fetch(\`\${getObsidianBaseUrl()}/vault/UoPeople/\${encodeURIComponent(f.baseFilename)}\`, {
                method: "GET",
                headers: { Authorization: \`Bearer \${apiKey}\` },
                signal: AbortSignal.timeout(4000),
            }).then(r => ({ filename: f.baseFilename, exists: r.ok }))
            .catch(() => ({ filename: f.baseFilename, exists: false }))
        )
    );`;

    const replacementString = `    // ── Sequential existence check (prevents Chrome connection queue timeout) ──
    setStatus("🔍 檢查 Obsidian 中的現有檔案...");
    const existenceResults = [];
    for (const f of pendingFiles) {
        try {
            const res = await fetch(\`\${getObsidianBaseUrl()}/vault/UoPeople/\${encodeURIComponent(f.baseFilename)}\`, {
                method: "GET",
                headers: { Authorization: \`Bearer \${apiKey}\` }
            });
            existenceResults.push({ filename: f.baseFilename, exists: res.ok });
        } catch (e) {
            existenceResults.push({ filename: f.baseFilename, exists: false });
        }
    }`;

    if (content.includes(searchString)) {
        content = content.replace(searchString, replacementString);
        fs.writeFileSync('popup.js', content, 'utf8');
        console.log("Fixed existence check timeout successfully.");
    } else {
        console.log("Could not find the existence check block to replace.");
        process.exit(1);
    }
} catch (e) {
    console.error("Error:", e);
}
