const fs = require('fs');

let content = fs.readFileSync('popup.js', 'utf8');

const mockEnv = `
const document = {
    getElementById: () => ({
        innerHTML: '',
        onclick: () => {},
        classList: { add: () => {}, remove: () => {} },
        querySelectorAll: () => []
    }),
    createElement: () => ({ classList: {add:()=>{}, remove:()=>{}}, appendChild: () => {}, dataset: {} })
};
const setStatus = console.log;
const setProgress = console.log;
let fetchCount = 0;
const fetch = async (url) => {
    fetchCount++;
    return { ok: true, status: 200, text: async () => "" };
};
function alert(m) { console.log("ALERT:", m); }
`;

content = mockEnv + "\n" + content;

content += `
(async () => {
    try {
        const mockCourse = "CS 3305-01";
        const mockResults = [
            { type: "Reading", title: "Read Chapter 1", url: "http://example.com", unitTime: "Unit 1", detail: "Read" },
            { type: "Assignment", title: "Assignment Activity 1", url: "http://example.com", unitTime: "Unit 1", detail: "Do it", rubricText: "Rubric" }
        ];
        const mockDetails = {
            "Unit 1": { topics: ["Topic 1"], outcomes: ["Outcome 1"] }
        };
        await uploadToObsidian(mockCourse, mockResults, mockDetails, "testkey");
        console.log("Mock execution finished successfully. Fetch calls:", fetchCount);
    } catch(e) {
        console.error("MOCK EXECUTION ERROR:", e);
    }
})();
`;

fs.writeFileSync('popup_mock.js', content, 'utf8');
