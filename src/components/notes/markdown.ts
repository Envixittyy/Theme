/**
 * A deliberately small Markdown renderer.
 *
 * Notes are the student's own text, but they are also the most likely place for
 * pasted content from elsewhere, so this escapes everything first and then
 * re-introduces a fixed set of constructs. No raw HTML passes through, which
 * means no XSS surface — and no dependency either.
 *
 * Supported: headings, bold, italic, inline code, fenced code, links
 * (http/https only), lists, task checkboxes, blockquotes, horizontal rules,
 * tables, and [[wiki links]] to other notes.
 */
export function renderMarkdown(source: string): string {
  const escaped = escapeHtml(source);
  const lines = escaped.split('\n');
  const out: string[] = [];
  let inCode = false;
  let listType: 'ul' | 'ol' | null = null;
  let inQuote = false;
  let inTable = false;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const closeQuote = () => {
    if (inQuote) {
      out.push('</blockquote>');
      inQuote = false;
    }
  };
  const closeTable = () => {
    if (inTable) {
      out.push('</tbody></table>');
      inTable = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.startsWith('```')) {
      closeList();
      closeQuote();
      closeTable();
      out.push(inCode ? '</code></pre>' : '<pre class="md-pre"><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(`${line}\n`);
      continue;
    }

    if (!line.trim()) {
      closeList();
      closeQuote();
      closeTable();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      closeQuote();
      closeTable();
      const level = heading[1]!.length + 1;
      out.push(`<h${level} class="md-h">${inline(heading[2]!)}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeList();
      closeQuote();
      closeTable();
      out.push('<hr class="md-hr" />');
      continue;
    }

    if (line.startsWith('&gt;')) {
      closeList();
      closeTable();
      if (!inQuote) {
        out.push('<blockquote class="md-quote">');
        inQuote = true;
      }
      out.push(`<p>${inline(line.replace(/^&gt;\s?/, ''))}</p>`);
      continue;
    }

    const task = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line.trim());
    if (task) {
      closeQuote();
      closeTable();
      if (listType !== 'ul') {
        closeList();
        out.push('<ul class="md-list md-tasks">');
        listType = 'ul';
      }
      const checked = task[1]!.toLowerCase() === 'x';
      out.push(
        `<li><input type="checkbox" disabled ${checked ? 'checked' : ''} aria-label="checklist item" /> <span${
          checked ? ' class="md-done"' : ''
        }>${inline(task[2]!)}</span></li>`,
      );
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line.trim());
    if (bullet) {
      closeQuote();
      closeTable();
      if (listType !== 'ul') {
        closeList();
        out.push('<ul class="md-list">');
        listType = 'ul';
      }
      out.push(`<li>${inline(bullet[1]!)}</li>`);
      continue;
    }

    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line.trim());
    if (numbered) {
      closeQuote();
      closeTable();
      if (listType !== 'ol') {
        closeList();
        out.push('<ol class="md-list">');
        listType = 'ol';
      }
      out.push(`<li>${inline(numbered[2]!)}</li>`);
      continue;
    }

    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      closeList();
      closeQuote();
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator row
      if (!inTable) {
        out.push('<table class="md-table"><tbody>');
        inTable = true;
      }
      out.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`);
      continue;
    }

    closeTable();
    if (listType) closeList();
    out.push(`<p>${inline(line)}</p>`);
  }

  if (inCode) out.push('</code></pre>');
  closeList();
  closeQuote();
  closeTable();
  return out.join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="md-wikilink">$1</span>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_m, label: string, href: string) => {
      // Only http(s) survive; the escape pass already neutralised quotes.
      return `<a href="${href}" rel="noreferrer noopener" target="_blank" class="md-link">${label}</a>`;
    });
}
