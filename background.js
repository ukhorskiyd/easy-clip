// background.js — service worker
// Listens for Alt+S, extracts the article, converts to Markdown, saves the file.
// Note: Turndown runs inside the PAGE (not here) because service workers have no `document`.

// --- Helpers ---

function sanitiseFilename(name) {
  return name
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function toDataUri(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:text/markdown;charset=utf-8;base64,' + btoa(binary);
}

function buildFrontmatter(title, url, date) {
  const safeTitle = title.replace(/"/g, '\\"');
  return `---\ntitle: "${safeTitle}"\nurl: "${url}"\ndate: ${date}\n---\n\n`;
}

// This function runs INSIDE the page where document, Readability, and TurndownService are all available
function extractAndConvert() {
  // Step 1: Clone the document first — never mutate the live page
  const clone = document.implementation.createHTMLDocument('Article');
  clone.documentElement.innerHTML = document.documentElement.innerHTML;

  // Step 2: Inject a <base> tag into the clone so relative URLs resolve correctly
  if (!clone.querySelector('base')) {
    const base = clone.createElement('base');
    base.href = document.location.href;
    clone.head.prepend(base);
  }

  // Step 3: Strip obviously hidden elements from the clone
  clone.querySelectorAll(
    '[style*="display:none"], [style*="display: none"], [hidden], [aria-hidden="true"]'
  ).forEach(el => el.remove());

  // Step 4: Extract article with Readability
  const article = new Readability(clone).parse();
  if (!article) return { error: 'Could not extract article from this page.' };

  let content = article.content || '';
  if (!content.trim()) return { error: 'Readability found the article but extracted no content.' };

  // Remove the first <h1> from the content — it's usually the article title,
  // which we already capture in the YAML frontmatter, so it would be redundant
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = content;
  const firstH1 = tempDiv.querySelector('h1');
  if (firstH1) firstH1.remove();
  content = tempDiv.innerHTML;

  // Step 5: Convert HTML → Markdown with Turndown (must run here, in the page, where `document` exists)
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced'
  });
  turndownService.use(turndownPluginGfm.gfm);
  const markdown = turndownService.turndown(content);

  return {
    title: article.title || document.title || 'Untitled',
    markdown: markdown,
    url: document.location.href,
    date: new Date().toISOString().slice(0, 10)
  };
}

// --- Main command listener ---

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'clip-page') return;
  console.log('[easy-clip] Alt+S triggered');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('[easy-clip] Active tab:', tab?.url);

  if (!tab || !tab.url || !tab.url.startsWith('http')) {
    console.warn('[easy-clip] Not a clippable page:', tab?.url);
    return;
  }

  try {
    // Inject all three libraries + run the combined extract-and-convert function in the page
    console.log('[easy-clip] Injecting libraries into page...');
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['libs/Readability.js', 'libs/turndown.js', 'libs/turndown-plugin-gfm.js']
    });

    console.log('[easy-clip] Running extractAndConvert...');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractAndConvert
    });

    console.log('[easy-clip] Results:', results);

    if (!results || !results[0] || results[0].result == null) {
      await showToast(tab.id, '⚠ No result from page — try reloading and clipping again.', true);
      return;
    }

    const result = results[0].result;
    console.log('[easy-clip] Title:', result.title);
    console.log('[easy-clip] Markdown length:', result.markdown?.length);

    if (result.error) {
      await showToast(tab.id, `⚠ ${result.error}`, true);
      return;
    }

    // Build file content and filename
    const frontmatter = buildFrontmatter(result.title, result.url, result.date);
    const fullContent = frontmatter + result.markdown;

    const domain = new URL(result.url).hostname.replace('www.', '');
    const safeTitle = sanitiseFilename(result.title);
    const filename = `${result.date} - ${safeTitle} (${domain}).md`;
    console.log('[easy-clip] Saving as:', filename);

    const downloadId = await chrome.downloads.download({
      url: toDataUri(fullContent),
      filename: filename,
      saveAs: false
    });
    console.log('[easy-clip] Download started, id:', downloadId);

    await showToast(tab.id, `✓ Saved: ${filename}`);

  } catch (err) {
    console.error('[easy-clip] Error:', err);
    await showToast(tab.id, `⚠ ${err.message || 'Something went wrong.'}`, true);
  }
});

// --- Toast helper ---
// Injects a small popup banner into the bottom-right of the page.
// Avoids the Chrome notifications API entirely (no permissions, no OS settings needed).

async function showToast(tabId, message, isError = false) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg, isErr) => {
        const existing = document.getElementById('easy-clip-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'easy-clip-toast';
        toast.style.cssText = `
          all: initial;
          position: fixed;
          bottom: 24px;
          right: 24px;
          background: ${isErr ? '#dc2626' : '#4f46e5'};
          color: #fff;
          font-family: system-ui, sans-serif;
          font-size: 13px;
          font-weight: 500;
          padding: 10px 16px;
          border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.25);
          z-index: 2147483647;
          max-width: 340px;
          word-break: break-word;
          opacity: 1;
          transition: opacity 0.4s ease;
        `;
        toast.textContent = msg;
        document.body.appendChild(toast);

        setTimeout(() => { toast.style.opacity = '0'; }, 3000);
        setTimeout(() => { toast.remove(); }, 3400);
      },
      args: [message, isError]
    });
  } catch (err) {
    console.error('[easy-clip] Toast error:', err.message);
  }
}
