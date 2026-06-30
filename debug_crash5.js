const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const startIdx = content.indexOf('function buildAssignmentContent');
const endIdx = content.indexOf('function buildCourseSummaryContent');
console.log(content.substring(startIdx, endIdx));
