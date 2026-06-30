const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

// Find all function calls that look like user-defined functions
const calls = content.match(/\b([a-z][a-zA-Z]+)\s*\(/g) || [];
const defs = content.match(/function ([a-zA-Z]+)\s*\(/g) || [];

const defNames = new Set(defs.map(d => d.replace('function ', '').replace(/\s*\(.*/, '')));

const builtins = new Set([
    'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent',
    'isNaN', 'isFinite', 'String', 'Number', 'Boolean', 'Array', 'Object',
    'Map', 'Set', 'Promise', 'console', 'Math', 'Date', 'JSON', 'RegExp',
    'Error', 'alert', 'confirm', 'prompt', 'toString', 'join', 'map', 'filter',
    'forEach', 'find', 'some', 'every', 'includes', 'indexOf', 'replace',
    'split', 'trim', 'slice', 'splice', 'push', 'pop', 'shift', 'unshift',
    'concat', 'sort', 'reverse', 'reduce', 'flat', 'flatMap', 'entries',
    'keys', 'values', 'has', 'get', 'set', 'delete', 'add', 'clear',
    'matchAll', 'match', 'test', 'exec', 'substring', 'toISOString',
    'toUpperCase', 'toLowerCase', 'padStart', 'startsWith', 'endsWith',
    'trimStart', 'trimEnd', 'charCodeAt', 'charAt', 'repeat', 'length',
    'resolve', 'reject', 'catch', 'then', 'finally', 'all', 'allSettled',
    'race', 'any', 'from', 'of', 'assign', 'create', 'freeze', 'keys',
    'values', 'entries', 'fromEntries', 'getOwnPropertyNames',
    'addEventListener', 'removeEventListener', 'dispatchEvent',
    'getElementById', 'querySelector', 'querySelectorAll', 'createElement',
    'appendChild', 'removeChild', 'insertBefore', 'getAttribute', 'setAttribute',
    'hasAttribute', 'classList', 'textContent', 'innerHTML', 'style',
    'appendChild', 'contains', 'toggle', 'add', 'remove',
    'log', 'error', 'warn', 'info', 'debug', 'table', 'group', 'groupEnd',
    'get', 'set', 'sendMessage', 'query', 'timeout',
    'AbortSignal', 'async', 'await', 'ok', 'text', 'json', 'blob', 'formData',
    'storage', 'local', 'sync', 'tabs', 'runtime', 'action',
    'called', 'categorizeUrls'
]);

const callNames = new Set(calls.map(c => c.replace(/\s*\(.*/, '').trim()));

const missing = [];
for (const name of callNames) {
    if (!defNames.has(name) && !builtins.has(name) && name.length > 3) {
        missing.push(name);
    }
}

console.log("Potentially missing functions called but not defined:");
missing.sort().forEach(m => console.log(' -', m));
