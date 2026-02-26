# Privacy Policy — UoPeople Sync Chrome Extension

**Last updated:** 2026-02-26

---

## Overview

UoPeople Sync ("the Extension") is a Chrome browser extension that helps University of the People students scan course pages, sync notes to Obsidian, and generate AI study prompts. This Privacy Policy explains what data the Extension accesses, how it is used, and how it is protected.

---

## Data Collection

**The Extension does not collect, store, or transmit any personal data to any remote server operated by the developer.**

The Extension operates entirely on your local machine.

---

## Data Accessed

To provide its features, the Extension accesses the following:

| Data                                | Purpose                                                    | Stored?                                                          |
| :---------------------------------- | :--------------------------------------------------------- | :--------------------------------------------------------------- |
| UoPeople course page content (HTML) | Scan course activities, deadlines, and resource links      | No — processed in memory only                                    |
| UoPeople session cookies            | Authenticate file download requests via `chrome.downloads` | No — cookies are never read directly; managed entirely by Chrome |
| Obsidian Local REST API Key         | Authenticate requests to the local Obsidian application    | Yes — stored locally in `chrome.storage.local` only              |

---

## Local Storage

The only data stored by the Extension is your **Obsidian Local REST API key**, which is saved using Chrome's built-in `chrome.storage.local` API. This data:

- **Never leaves your device.**
- Is accessible only to this Extension within your browser.
- Can be deleted at any time by removing the Extension or clearing its storage via `chrome://extensions/`.

---

## Network Requests

The Extension makes network requests **only** to:

1. **`https://my.uopeople.edu/*`** — to fetch course page content for scanning. These requests use your existing authenticated browser session (cookies managed by Chrome). No credentials are extracted or stored by the Extension.
2. **`https://127.0.0.1:27124`** (localhost) — to push generated Markdown notes to your local Obsidian application. This communication never leaves your device.

No data is sent to any third-party analytics, advertising, or tracking services.

---

## Permissions Justification

| Permission                                   | Justification                                                                         |
| :------------------------------------------- | :------------------------------------------------------------------------------------ |
| `activeTab`                                  | Required to read the content of the currently active UoPeople course tab.             |
| `scripting`                                  | Required to inject the content script that scans course page DOM.                     |
| `storage`                                    | Required to save your Obsidian API key locally between sessions.                      |
| `tabs`                                       | Required to query the URL of the active tab to confirm it is a UoPeople page.         |
| `clipboardWrite`                             | Required to copy reading links to your clipboard when you click "Copy Reading Links". |
| `downloads`                                  | Required to trigger bulk file downloads of UoPeople internal files.                   |
| Host permission: `https://my.uopeople.edu/*` | Required to fetch individual course activity pages for deep scanning.                 |

---

## Children's Privacy

This Extension is not directed at children under the age of 13. We do not knowingly collect any information from children.

---

## Changes to This Policy

If we update this Privacy Policy, the updated version will be posted at this URL with a revised "Last updated" date.

---

## Contact

If you have questions about this Privacy Policy, please open an issue on the GitHub repository associated with this Extension.
