# easy-clip — Chrome Extension

## What it does
A Chrome extension that saves the main article text of any web page as a
Markdown (.md) file to the Downloads folder, triggered by a keyboard shortcut.
Primary use case: clipping news articles for research.

## Core requirements
- Trigger: Alt+S keyboard shortcut (user-remappable via chrome://extensions/shortcuts)
- Extraction: article body text only — using Mozilla's Readability.js library
- HTML → Markdown conversion: using Turndown library
- Output format: .md file with YAML frontmatter metadata
- Filename: `YYYY-MM-DD - <sanitised page title> (<domain>).md`
- Save location: default Downloads folder (Chrome downloads API)
- Feedback: browser notification confirming the filename saved

## Output file format

Each saved file starts with YAML frontmatter, followed by the article body:

```
---
title: How the Fed's interest rate decision affects you
url: https://www.bbc.com/news/business-12345
date: 2026-04-01
---

The Federal Reserve announced on Wednesday...
(rest of article in Markdown)
```

## Filename sanitisation
Page titles must have illegal filename characters removed or replaced before
saving: `/ \ : * ? " < > |` should be stripped or replaced with `-`.

## Tech stack
- Vanilla JavaScript (no frameworks)
- Chrome Extensions Manifest V3
- Libraries: Readability.js, Turndown

## Manifest V3 permissions required
- `activeTab` — read the current tab's content
- `scripting` — inject content scripts into the page
- `downloads` — save the .md file to disk
- `notifications` — show save confirmation to user
- `host_permissions`: `<all_urls>` — needed to run scripts on any site

## Extension structure (planned)
- `manifest.json` — extension config and permissions
- `background.js` — service worker; handles shortcut, triggers extraction, saves file, shows notification
- `content.js` — injected into the page; runs Readability.js and returns article content
- `libs/Readability.js` — Mozilla's article extraction library
- `libs/Turndown.js` — HTML to Markdown conversion library

## Implementation findings (from researching existing extensions)

Sources reviewed:
- MarkDownload: https://github.com/deathau/markdownload (MV2, gold standard, stale)
- LLMFeeder: https://github.com/jatinkrmalik/LLMFeeder (MV3, clean architecture, clipboard only)
- MarkSnip: https://github.com/DhruvParikh1/markdownload-extension-updated (MV3 port of MarkDownload, offscreen docs)
- Obsidian Web Clipper: https://github.com/obsidianmd/obsidian-clipper (MV3, TypeScript, uses Defuddle not Readability)

### Critical MV3 gotcha: no Blob URLs in service workers
`URL.createObjectURL()` does not work reliably in MV3 service workers.
Fix: encode Markdown as base64 and pass a `data:` URI to `chrome.downloads.download()`:
```javascript
const dataUri = 'data:text/markdown;charset=utf-8;base64,' + btoa(unescape(encodeURIComponent(markdown)));
chrome.downloads.download({ url: dataUri, filename: 'article.md' });
```

### Always clone the DOM before passing to Readability
Readability mutates (destroys) the DOM. Always clone first:
```javascript
const clone = document.implementation.createHTMLDocument('Article');
clone.documentElement.innerHTML = document.documentElement.innerHTML;
const article = new Readability(clone).parse();
```

### Inject a `<base>` tag before serializing HTML
Without this, relative URLs (images, links) break when the HTML string leaves the page context:
```javascript
const base = document.createElement('base');
base.href = document.location.href;
document.head.prepend(base);
```

### Strip hidden elements before Readability
Readability doesn't always remove hidden DOM elements (tooltips, modals, accessibility labels).
Pre-pass: remove elements where `display: none`, `visibility: hidden`, or no layout box.

### Use Turndown with GFM plugin
The GFM (GitHub Flavored Markdown) plugin adds proper table support:
```javascript
turndownService.use(turndownPluginGfm.gfm);
```

### Turndown fence collision
If article code blocks contain triple backticks, switch fence character to `~~~` to avoid broken Markdown.

### Libraries to also download
- `turndown-plugin-gfm.js` alongside `Turndown.js`

## Known limitations
- JavaScript-rendered pages (SPAs) may produce incomplete output
- Paywalled content will only capture what is visible without a subscription
- Alt+S may conflict with shortcuts on some sites (Gmail, Google Docs, Notion)

## Deferred features
- Popup preview of Markdown before saving

## User context
- First Chrome extension — explain all concepts clearly during build
- Personal use only, no Chrome Web Store publishing required
