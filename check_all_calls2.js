const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

// More targeted: find camelCase function calls only
const calls = [...content.matchAll(/\b([a-z][a-zA-Z]{3,})\s*\(/g)].map(m => m[1]);
const defs = [...content.matchAll(/function ([a-zA-Z]+)\s*\(/g)].map(m => m[1]);

const defNames = new Set(defs);

const realBuiltins = new Set([
    'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent',
    'isNaN', 'isFinite', 'toString', 'toISOString', 'toUpperCase', 'toLowerCase',
    'padStart', 'startsWith', 'endsWith', 'trimStart', 'trimEnd', 'charCodeAt',
    'charAt', 'repeat', 'matchAll', 'trim', 'slice', 'splice', 'push', 'includes',
    'indexOf', 'replace', 'split', 'join', 'map', 'filter', 'forEach', 'find',
    'some', 'every', 'reduce', 'flat', 'flatMap', 'entries', 'keys', 'values',
    'resolve', 'reject', 'catch', 'then', 'finally', 'allSettled',
    'createElement', 'getElementById', 'querySelector', 'querySelectorAll',
    'appendChild', 'removeChild', 'getAttribute', 'setAttribute',
    'contains', 'toggle', 'sendMessage', 'substring',
    'writeText', 'getFullYear', 'getMonth', 'getDate', 'getHours',
    'getMinutes', 'getSeconds', 'isArray', 'fromEntries',
    'getOwnPropertyNames', 'addEventListener', 'removeEventListener',
]);

const callNames = new Set(calls);
const missing = [];
for (const name of callNames) {
    if (!defNames.has(name) && !realBuiltins.has(name)) {
        missing.push(name);
    }
}

console.log("Missing camelCase functions:");
missing.sort().forEach(m => console.log(' -', m));
