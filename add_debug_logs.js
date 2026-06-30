const fs = require('fs');
let content = fs.readFileSync('popup.js', 'utf8');

// Add verbose debug logging to the PUT loop
const searchStr = `    // Sequential PUT requests to Obsidian
    setStatus("📤 上傳到 Obsidian...");
    let successCount = 0;
    let failMessages = [];
    for (const file of filesToUpload) {
        const url = \`\${getObsidianBaseUrl()}/vault/UoPeople/\${encodeURIComponent(file.filename)}\`;
        console.log(\`📤 Uploading to Obsidian: \${url}\`);`;

const replaceStr = `    // Sequential PUT requests to Obsidian
    setStatus("📤 上傳到 Obsidian...");
    let successCount = 0;
    let failMessages = [];
    console.log("📋 Total files to upload:", filesToUpload.length);
    console.log("📋 Files:", filesToUpload.map(f => f.filename));
    console.log("📋 Obsidian base URL:", getObsidianBaseUrl());
    for (const file of filesToUpload) {
        const url = \`\${getObsidianBaseUrl()}/vault/UoPeople/\${encodeURIComponent(file.filename)}\`;
        console.log(\`📤 Uploading to Obsidian: \${url}\`);`;

if (content.includes(searchStr)) {
    content = content.replace(searchStr, replaceStr);
    fs.writeFileSync('popup.js', content, 'utf8');
    console.log("Added debug logs to upload loop.");
} else {
    console.log("Could not find PUT loop to inject logs.");
}
