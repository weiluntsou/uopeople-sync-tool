# UoPeople Sync

> A Chrome Extension that deep-scans UoPeople course pages and syncs structured notes to Obsidian, with built-in NotebookLM integration.

---

## Features

- **Deep Scan** — Scans all activities in a UoPeople course page (Readings, Discussions, Assignments) and extracts titles, deadlines, learning outcomes, and external resource links.
- **Obsidian Sync** — Automatically creates a structured Markdown note in your Obsidian vault via the [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin.
- **NotebookLM Integration** — Generates a ready-to-paste video script prompt for [Google NotebookLM](https://notebooklm.google.com/).
- **Copy Reading Links** — One-click copy of all external reading URLs to your clipboard, formatted for pasting directly into NotebookLM.
- **Bulk File Download** — Downloads all UoPeople internal files (PDFs, slides, etc.) using your active login session.

---

## Requirements

| Requirement     | Details                                                                                  |
| :-------------- | :--------------------------------------------------------------------------------------- |
| Browser         | Google Chrome (Manifest V3)                                                              |
| Target Site     | `https://my.uopeople.edu`                                                                |
| Obsidian Plugin | [Local REST API](https://obsidian.md/plugins?id=obsidian-local-rest-api) must be running |

---

## Installation (Developer Mode)

1. Clone or download this repository.
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** → select this project folder.
5. The extension icon will appear in your toolbar.

---

## Setup

1. Install and enable the **Obsidian Local REST API** plugin in Obsidian.
2. Copy the **API Key** from the plugin settings.
3. Click the UoPeople Sync extension icon.
4. Paste your API Key in the **Settings** section and click **💾 Save Key**.

---

## Usage

1. Navigate to a UoPeople course page (`https://my.uopeople.edu/course/view.php?id=...`).
2. Click the extension icon and press **🔍 Deep Scan Course & Sync to Obsidian**.
3. Wait 30–60 seconds while the extension scans all activities.
4. Once complete, your Obsidian vault will have a new note under `UoPeople/<CourseName>_Summary.md`.
5. Use the **📋 Copy Reading Links** button to copy external URLs for NotebookLM.
6. Use the **⬇️ Download UoP Files** button to bulk-download internal course files.

---

## Generated Obsidian Note Structure

Each synced note is saved to:

```
<Your Vault>/UoPeople/<CourseName>_Summary.md
```

The note is structured as follows. Each section is described in detail with an example below.

---

### Section Overview

| Section                                                               | Description                                                |
| :-------------------------------------------------------------------- | :--------------------------------------------------------- |
| [YAML Frontmatter](#-yaml-frontmatter)                                | Machine-readable metadata for the note                     |
| [📅 Course Schedule](#-course-schedule)                                | Full activity table with types, links, and deadlines       |
| [📊 Weekly Key Points Summary](#-weekly-key-points-summary)            | Per-unit roll-up of readings, discussions, and assignments |
| [📒 NotebookLM Source Links](#-notebooklm-source-links)                | External reading URLs ready to paste into NotebookLM       |
| [🔒 UoPeople Internal Files](#-uopeople-internal-files-login-required) | Login-required files (PDF, PPTX, etc.) for bulk download   |
| [🎬 NotebookLM Video Script Prompt](#-notebooklm-video-script-prompt)  | Auto-generated instructional design prompt per unit        |
| [📖 Material Details](#-material-details)                              | Full detail content for every scanned activity             |
| [📥 Downloaded UoPeople Files](#-downloaded-uopeople-files-optional)   | Appended after using the Download button *(optional)*      |

---

### 🔖 YAML Frontmatter

Added at the very top of the note. Obsidian reads these fields as note properties.

```yaml
---
course: "CS 1101 - Programming Fundamentals"
synced: "2026-02-26"
---
```

| Field    | Value                                                              |
| :------- | :----------------------------------------------------------------- |
| `course` | The course name extracted from the page `<h1>` or `document.title` |
| `synced` | The date the scan was run (ISO format `YYYY-MM-DD`)                |

---

### 📅 Course Schedule

A complete table of every scannable activity in the course. The `Resource` type (non-graded links) is excluded to keep the table clean.

```markdown
## 📅 Course Schedule

| Unit Period | Type       | Task                                           | Deadline                     |
| :---------- | :--------- | :--------------------------------------------- | :--------------------------- |
| Unit 1      | Reading    | [Learning Guide Unit 1](https://my.uopeople…)  | N/A                          |
| Unit 1      | Discussion | [Discussion Forum – Unit 1](https://my.uopeo…) | Sunday, 1 Mar 2026, 11:59 PM |
| Unit 1      | Assignment | [Programming Assignment 1](https://my.uopeo…)  | Sunday, 1 Mar 2026, 11:59 PM |
| Unit 2      | Reading    | [Learning Guide Unit 2](https://my.uopeople…)  | N/A                          |
| Unit 2      | Discussion | [Discussion Forum – Unit 2](https://my.uopeo…) | Sunday, 8 Mar 2026, 11:59 PM |
```

**Activity types:**

| Type         | Detected by URL pattern                            |
| :----------- | :------------------------------------------------- |
| `Reading`    | `/mod/book/`                                       |
| `Discussion` | `/mod/forum/`                                      |
| `Assignment` | `/mod/assign/`                                     |
| `Resource`   | All other `/mod/` types *(excluded from schedule)* |

---

### 📊 Weekly Key Points Summary

A compact per-unit roll-up table for a quick overview of the entire course load.

```markdown
## 📊 Weekly Key Points Summary

| Week / Unit | Reading Materials           | Discussion Topics                                 | Assignments                                 | Nearest Deadline              |
| :---------- | :-------------------------- | :------------------------------------------------ | :------------------------------------------ | :---------------------------- |
| Unit 1      | Learning Guide Unit 1       | [Discussion Forum – Unit 1](https://my.uopeople…) | [Programming Assignment 1](https://my.uop…) | Sunday, 1 Mar 2026, 11:59 PM  |
| Unit 2      | Learning Guide Unit 2       | [Discussion Forum – Unit 2](https://my.uopeople…) | [Written Assignment Unit 2](https://my.u…)  | Sunday, 8 Mar 2026, 11:59 PM  |
| Unit 3      | Learning Guide Unit 3, Quiz | —                                                 | [Written Assignment Unit 3](https://my.u…)  | Sunday, 15 Mar 2026, 11:59 PM |
```

- Reading titles are listed as plain text (no hyperlink) for readability.
- Discussion and Assignment titles are clickable Markdown links.
- `Nearest Deadline` shows the earliest deadline from that unit's discussions and assignments. Shows `N/A` if none detected.
- `—` is shown when a category has no items in that unit.

---

### 📒 NotebookLM Source Links

A plain-text code block containing all **external** reading URLs (YouTube, open-access articles, third-party websites, etc.). UoPeople internal URLs are intentionally excluded because they require login and cannot be added to NotebookLM as web sources.

```markdown
## 📒 NotebookLM Source Links

> **How to use:** Copy the URLs below → Go to [NotebookLM](https://notebooklm.google.com/) → Add Source → Website → paste each URL.
> *(UoPeople internal URLs are excluded — use the Download button in the extension instead.)*

​```
https://www.youtube.com/watch?v=zOjov-2OZ0E
https://www.khanacademy.org/computing/computer-science/algorithms
https://www.w3schools.com/python/python_intro.asp
https://ocw.mit.edu/courses/6-001/readings/
​```
```

> **Tip:** You can also click **📋 Copy Reading Links** in the extension popup to copy this list directly to your clipboard without opening the Obsidian note.

---

### 🔒 UoPeople Internal Files (Login Required)

A numbered table of all UoPeople-hosted files found during the scan (e.g. files served by `pluginfile.php`). These files require an active UoPeople session to download.

```markdown
## 🔒 UoPeople Internal Files (Login Required)

> These URLs require authentication. Use the **⬇️ Download UoP Files** button in the extension to bulk-download them.

| #    | URL                                                                  |
| :--- | :------------------------------------------------------------------- |
| 1    | [CS1101_Unit1_Slides.pdf](https://my.uopeople.edu/pluginfile.php/…)  |
| 2    | [CS1101_Reading_Guide.pdf](https://my.uopeople.edu/pluginfile.php/…) |
| 3    | [Unit1_Video_Transcript.docx](https://my.uopeople.edu/pluginfile.…)  |
```

File types detected: `.pdf`, `.doc`, `.docx`, `.ppt`, `.pptx`, `.xls`, `.xlsx`, `.zip`, `.mp4`, `.mp3`, `.png`, `.jpg`

---

### 🎬 NotebookLM Video Script Prompt

An auto-generated instructional design prompt block **for every unit in the course**. Paste this into a NotebookLM notebook (after adding the reading sources) to generate an 8–12 minute educational video script.

````markdown
## 🎬 NotebookLM Video Script Prompt

> **How to use:** Add the Reading sources (above) to your NotebookLM notebook, then paste this prompt into the chat to generate a teaching video script.

​```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 PROMPT FOR: Unit 1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Role: Professional Instructional Designer & Senior Teaching Assistant.

Task: Generate an 8–12 minute Educational Video Overview based on the
"CS 1101 - Programming Fundamentals" curriculum.

───────────────────────────────────────
Instructions for the Video Engine:
───────────────────────────────────────

Scope: Focus exclusively on the content for [Unit 1].

Narration Style: Use clear, academic, yet engaging English. Avoid overly
robotic phrasing. Use phrases like "Let's dive into...", "Consider this
analogy...", and "The takeaway here is...".

Structure & Visual Emphasis:

  🎬 Introduction (1 min):
     Start with a high-level real-world problem that motivates this week's content.
     Introduce the Weekly Topics and Learning Outcomes listed below.

  📚 Deep Dive (5–6 mins):
     For each topic ($Variables$, $Control Flow$, $Functions$), explain:
       1. The Mechanism — what it is and how it works
       2. The Impact — why it matters for system/real-world performance
     Use the provided sources to reference specific details, architectures, or algorithms.

  💬 Critical Thinking Section (2–3 mins):
     Address the Discussion Prompt below.
     Instead of giving direct answers, provide a Decision Matrix:
       "When evaluating [the topic], consider these 3 factors..."
     Help students build their own reasoning framework.

  📝 Practical Guidance (1–2 mins):
     Explicitly mention the Assignment Activity listed below.
     Walk through the technical requirements and highlight common student errors.

  🎯 Wrap-up (1 min):
     Synthesize the Learning Outcomes into a "Big Picture" summary.
     Remind students which outcomes they have now achieved.

Technical Constraints:
  - Ground every explanation in the uploaded source documents in this notebook.
  - If sources discuss specific code or algorithms, ensure the video highlights those details.
  - Maintain pacing that allows complex concepts to be absorbed — do not rush critical sections.
  - Use $technical terms$ in the video script wherever you reference core concepts.

───────────────────────────────────────
Input Data for this Video:
───────────────────────────────────────

Topics:
  - $Variables and Data Types$
  - $Control Flow (if/else, loops)$
  - $Functions and Scope$

Learning Outcomes (students will be able to):
  • Write and execute basic Python programs
  • Apply control flow structures to solve problems
  • Define and call functions with parameters

Discussion Prompt(s):
  • "Discussion Forum – Introduction to Programming"

Assignment Activity:
  • Programming Assignment 1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 PROMPT FOR: Unit 2
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
… (repeats for every unit)
​```
````

**How the prompt is populated:**

| Prompt Field                | Source                                                                                           |
| :-------------------------- | :----------------------------------------------------------------------------------------------- |
| Topics                      | Extracted from the **Learning Guide Overview** chapter (looks for a "Topics" heading)            |
| Learning Outcomes           | Extracted from the **Learning Guide Overview** chapter (looks for a "Learning Outcomes" heading) |
| Discussion Prompt(s)        | Titles of all `Discussion` type activities in that unit                                          |
| Assignment Activity         | Titles of all `Assignment` type activities in that unit                                          |
| Fallback (Topics not found) | Shows reading titles as a hint, e.g. `(derived from readings: Learning Guide Unit 1)`            |

---

### 📖 Material Details

A full per-activity breakdown appended after all summary sections. Each activity gets its own sub-heading with metadata and the extracted content.

**For Reading / Learning Guide activities:**

```markdown
## 📖 Material Details

### Learning Guide Unit 1
- **Type**: Reading
- **Unit**: Unit 1
- **Deadline**: N/A
- **URL**: https://my.uopeople.edu/mod/book/view.php?id=…

#### 📚 Reading Assignment List
- 📄 [Introduction to Python (W3Schools)](https://www.w3schools.com/python/)
- 🎥 [What is Programming? (Khan Academy)](https://www.youtube.com/watch?v=…)
- 📄 [MIT OpenCourseWare — Lecture Notes](https://ocw.mit.edu/…)
- 🎥 [Embedded Video](https://www.youtube.com/watch?v=…)

---
```

**For Discussion / Assignment activities:**

```markdown
### Discussion Forum – Unit 1
- **Type**: Discussion
- **Unit**: Unit 1
- **Deadline**: Sunday, 1 Mar 2026, 11:59 PM
- **URL**: https://my.uopeople.edu/mod/forum/view.php?id=…

> After watching the assigned videos and completing the readings for this
> unit, reflect on the following: How does understanding data types help
> you write more reliable programs? Provide an example from your own
> experience or the readings...

---

### Programming Assignment 1
- **Type**: Assignment
- **Unit**: Unit 1
- **Deadline**: Sunday, 1 Mar 2026, 11:59 PM
- **URL**: https://my.uopeople.edu/mod/assign/view.php?id=…

> Write a Python program that accepts user input and performs basic
> arithmetic operations. Your program must include: (1) at least one
> function, (2) input validation using if/else...

---
```

**Resource link icons in Reading List:**

| Icon | Meaning                                                   |
| :--- | :-------------------------------------------------------- |
| 📄    | Standard web link (article, PDF, webpage)                 |
| 🎥    | Video link (YouTube, Vimeo, Kaltura, Panopto, Loom, etc.) |

---

### 📥 Downloaded UoPeople Files *(optional)*

This section is **appended automatically** to the existing note after you click **⬇️ Download UoP Files** in the extension. It records what was downloaded and where it was saved.

```markdown
---

## 📥 Downloaded UoPeople Files

> Downloaded on 2026-02-26 07:32 UTC

| File                        | Local Path                                                                        |
| :-------------------------- | :-------------------------------------------------------------------------------- |
| CS1101_Unit1_Slides.pdf     | Downloads/UoPeople/CS 1101 - Programming Fundamentals/CS1101_Unit1_Slides.pdf     |
| CS1101_Reading_Guide.pdf    | Downloads/UoPeople/CS 1101 - Programming Fundamentals/CS1101_Reading_Guide.pdf    |
| Unit1_Video_Transcript.docx | Downloads/UoPeople/CS 1101 - Programming Fundamentals/Unit1_Video_Transcript.docx |
```

- Files are saved under `Downloads/UoPeople/<CourseName>/` in your system's default Downloads folder.
- If the Download button is clicked again, the old section is **replaced** (not duplicated) with the latest download record.

---

## Permissions

| Permission                          | Reason                                        |
| :---------------------------------- | :-------------------------------------------- |
| `activeTab`                         | Read the currently active UoPeople course tab |
| `scripting`                         | Inject content scripts to scan page content   |
| `storage`                           | Save your Obsidian API key locally            |
| `tabs`                              | Query the active tab URL                      |
| `clipboardWrite`                    | Copy reading links to clipboard               |
| `downloads`                         | Bulk-download UoPeople internal files         |
| `host_permissions: my.uopeople.edu` | Access course content on UoPeople's domain    |

---

## Privacy

- No data is transmitted to any third-party server.
- All processing is done locally in your browser.
- Your Obsidian API key is stored locally using `chrome.storage.local`.
- The extension only communicates with `my.uopeople.edu` (to fetch course content) and your local Obsidian instance (`127.0.0.1:27124`).

---

## License

MIT License — see [LICENSE](LICENSE) for details.
