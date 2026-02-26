# Chrome Web Store — Submission Checklist

> Complete this checklist in order before submitting to the Chrome Web Store.
> Reference: https://developer.chrome.com/docs/webstore/publish/

---

## Phase 1 — Developer Account

- [ ] Register a [Chrome Web Store Developer account](https://chrome.google.com/webstore/devconsole)
- [ ] Pay the one-time $5 USD registration fee
- [ ] Verify your email address

---

## Phase 2 — Manifest Verification

Open `manifest.json` and confirm the following:

- [ ] `"manifest_version": 3` ✅ (already correct)
- [ ] `"name"` ≤ 45 characters
  - Current: `"UoPeople Sync v3.2"` ✅
- [ ] `"version"` follows `MAJOR.MINOR` or `MAJOR.MINOR.PATCH` format
  - Current: `"3.2"` ✅
- [ ] `"description"` field added (≤ 132 characters, shown in store)
  - ⬜ **Action required** — add `"description"` to `manifest.json`
- [ ] `"icons"` object defined with 16, 48, and 128 px variants
  - ⬜ **Action required** — create and add icons (see Phase 3)
- [ ] All declared permissions are the **minimum necessary**
  - Current permissions reviewed: `activeTab`, `scripting`, `storage`, `tabs`, `clipboardWrite`, `downloads` ✅
- [ ] `"homepage_url"` added (optional but recommended)
- [ ] No remote code execution (no `eval`, no remote JS)
  - ⬜ Verify `popup.js` and `content.js` contain no `eval()` calls

---

## Phase 3 — Required Assets

### Extension Icons

Create three PNG icons with a transparent or solid background:

| Size       | Filename            | Used For                                 |
| :--------- | :------------------ | :--------------------------------------- |
| 128×128 px | `icons/icon128.png` | Chrome Web Store listing, install dialog |
| 48×48 px   | `icons/icon48.png`  | Extensions management page               |
| 16×16 px   | `icons/icon16.png`  | Browser toolbar favicon                  |

Add to `manifest.json`:
```json
"icons": {
  "16":  "icons/icon16.png",
  "48":  "icons/icon48.png",
  "128": "icons/icon128.png"
},
"action": {
  "default_popup": "popup.html",
  "default_icon": {
    "16":  "icons/icon16.png",
    "48":  "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### Store Screenshots

Minimum 1, up to 5 screenshots. Dimensions: **1280×800** or **640×400** (PNG or JPEG).

| #    | Required Subject                                  |
| :--- | :------------------------------------------------ |
| 1    | Extension popup after a successful scan           |
| 2    | Generated Obsidian note — Course Schedule table   |
| 3    | Generated Obsidian note — Weekly Key Points table |
| 4    | NotebookLM Video Script Prompt section            |
| 5    | (Optional) NotebookLM with pasted sources         |

### Promotional Images (Optional)

| Size        | Purpose                                  |
| :---------- | :--------------------------------------- |
| 440×280 px  | Small promotional tile                   |
| 920×680 px  | Large promotional tile                   |
| 1400×560 px | Marquee banner (for featured extensions) |

---

## Phase 4 — manifest.json Additions Required

Add the following fields before packaging:

```json
{
  "manifest_version": 3,
  "name": "UoPeople Sync",
  "version": "3.2",
  "description": "Auto-scan UoPeople courses, sync structured notes to Obsidian, and generate NotebookLM prompts in one click.",
  "icons": {
    "16":  "icons/icon16.png",
    "48":  "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16":  "icons/icon16.png",
      "48":  "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "permissions": [
    "activeTab",
    "scripting",
    "storage",
    "tabs",
    "clipboardWrite",
    "downloads"
  ],
  "host_permissions": [
    "https://my.uopeople.edu/*"
  ],
  "content_scripts": [
    {
      "matches": ["https://my.uopeople.edu/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

---

## Phase 5 — Package the Extension

```bash
# From the project root — create the ZIP (exclude hidden files and the store/ folder)
zip -r uopeople-sync-v3.2.zip . \
  --exclude "*.git*" \
  --exclude "store/*" \
  --exclude "*.DS_Store" \
  --exclude "*.md" \
  --exclude "node_modules/*"
```

> ⚠️ Do NOT include `store/` folder, `.git/`, `README.md`, or any dev-only files in the ZIP.

The ZIP must contain:
```
manifest.json
popup.html
popup.js
content.js
icons/
  icon16.png
  icon48.png
  icon128.png
```

---

## Phase 6 — Chrome Web Store Developer Console

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Click **New Item** → Upload your `.zip`
3. Fill in the **Store Listing** tab:
   - [ ] Extension name (from `store/store_listing.md`)
   - [ ] Summary (≤ 132 characters)
   - [ ] Detailed description
   - [ ] Category: **Productivity**
   - [ ] Language: **English**
   - [ ] Upload screenshots (min 1, max 5)
   - [ ] Upload promotional tile (optional)
4. Fill in the **Privacy Practices** tab:
   - [ ] Privacy policy URL (host `store/privacy_policy.md` publicly, e.g. on GitHub Pages)
   - [ ] Single purpose description: *"Scans UoPeople course pages and syncs structured study notes to a local Obsidian vault."*
   - [ ] Justify each permission (see table in Phase 2)
   - [ ] Confirm: data is **not sold** and **not used for personalization**
5. Set **Distribution**:
   - [ ] Visibility: **Public** (or Unlisted for private/beta)
   - [ ] Countries: All regions (or restrict as needed)
6. Click **Submit for Review**

---

## Phase 7 — Post-Submission

- Review typically takes **1–3 business days** for new extensions.
- Check your developer console for approval or rejection notes.
- If rejected, read the stated reason and update accordingly.
- After approval, your extension will be live at:
  `https://chromewebstore.google.com/detail/<extension-id>`

---

## Common Rejection Reasons to Avoid

| Risk                         | Prevention                                             |
| :--------------------------- | :----------------------------------------------------- |
| Overly broad permissions     | ✅ All permissions are scoped to `my.uopeople.edu` only |
| Missing privacy policy       | ✅ See `store/privacy_policy.md`                        |
| Remote code loading          | ✅ No remote scripts — all JS is bundled locally        |
| Misleading store description | ✅ Description matches actual functionality             |
| Missing icon                 | ⬜ **Action required** — add icons before submission    |
| `eval()` usage               | ⬜ Verify no `eval()` in source files                   |
