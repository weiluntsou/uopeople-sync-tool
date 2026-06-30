const fs = require('fs');

try {
    let content = fs.readFileSync('popup.js', 'utf8');
    
    const searchString = `    const existingFilenames = new Set(
        existenceResults
            .filter(r => r.status === 'fulfilled' && r.value.exists)
            .map(r => r.value.filename)
    );`;

    const replacementString = `    const existingFilenames = new Set(
        existenceResults
            .filter(r => r.exists)
            .map(r => r.filename)
    );`;

    if (content.includes(searchString)) {
        content = content.replace(searchString, replacementString);
        fs.writeFileSync('popup.js', content, 'utf8');
        console.log("Fixed existenceResults filter successfully.");
    } else {
        console.log("Could not find the existingFilenames block to replace.");
        process.exit(1);
    }
} catch (e) {
    console.error("Error:", e);
}
