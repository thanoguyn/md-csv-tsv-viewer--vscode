(function () {
  const safeLinkSchemePattern = /^(https?:|mailto:|tel:|#)/i;
  const safeImageSchemePattern = /^(https?:|#)/i;
  const imageDataPattern = /^data:image\/(?:png|gif|jpe?g|webp|svg\+xml);base64,/i;
  const explicitSchemePattern = /^[a-z][a-z0-9+.-]*:/i;
  const relativePathPattern = /^(?:\/|\.\/|\.\.\/|[^:/?#]+(?:[/?#]|$))/;

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function sanitizeUrl(value, options = {}) {
    return escapeHtml(resolveUrl(value, options));
  }

  function resolveUrl(value, options = {}) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "#";
    if ((options.image ? safeImageSchemePattern : safeLinkSchemePattern).test(trimmed)) return trimmed;
    if (options.image && imageDataPattern.test(trimmed)) return trimmed;
    if (explicitSchemePattern.test(trimmed)) return "#";
    if (!relativePathPattern.test(trimmed)) return "#";

    const baseUri = String(window.__MD_VIEWER_BASE_URI__ || "");
    if (!baseUri) return trimmed;

    try {
      return new URL(trimmed, baseUri).toString();
    } catch {
      return "#";
    }
  }

  function normalizeLinkDestination(value) {
    const trimmed = String(value || "").trim();
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed.slice(1, -1).trim();
    return trimmed;
  }

  function stashHtml(tokens, html) {
    const token = `\uE000MDVIEWER${tokens.length}\uE001`;
    tokens.push(html);
    return token;
  }

  function restoreHtmlTokens(value, tokens) {
    return value.replace(/\uE000MDVIEWER(\d+)\uE001/g, (_, index) => tokens[Number(index)] || "");
  }

  function slugify(value) {
    return value
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/&[a-z0-9#]+;/gi, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function inlineMarkdown(value) {
    const tokens = [];
    let output = String(value || "");

    output = output.replace(/`([^`]+)`/g, (_, code) => stashHtml(tokens, `<code>${escapeHtml(code)}</code>`));
    output = output.replace(/(!?)\[([^\]]*)\]\s*\(\s*(<[^>]+>|[^\s)]+)(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*\)/g, (_, bang, text, destination, doubleTitle, singleTitle, parenTitle) => {
      const title = doubleTitle ?? singleTitle ?? parenTitle ?? "";
      const src = normalizeLinkDestination(destination);
      const safeTitle = title ? ` title="${escapeHtml(title)}"` : "";
      if (bang) {
        return stashHtml(tokens, `<img src="${sanitizeUrl(src, { image: true })}" data-markdown-src="${escapeHtml(src)}" alt="${escapeHtml(text)}"${safeTitle}>`);
      }
      return stashHtml(tokens, `<a href="${sanitizeUrl(src)}" data-markdown-href="${escapeHtml(src)}"${safeTitle} target="_blank" rel="noreferrer noopener">${inlineMarkdown(text)}</a>`);
    });

    output = escapeHtml(output);
    output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    output = output.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    output = output.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    output = output.replace(/_([^_]+)_/g, "<em>$1</em>");
    output = output.replace(/~~([^~]+)~~/g, "<del>$1</del>");

    return restoreHtmlTokens(output, tokens);
  }

  function parseTable(lines, start) {
    if (!isPotentialTableRow(lines[start]) || !isPotentialTableDivider(lines[start + 1])) return null;

    const header = splitTableRow(lines[start]);
    const divider = splitTableRow(lines[start + 1]);
    if (header.length < 2 || divider.length < 2) return null;

    const alignments = divider.map((cell) => {
      const trimmed = cell.trim();
      if (!/^:?-{1,}:?$/.test(trimmed)) return null;
      if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
      if (trimmed.endsWith(":")) return "right";
      return "left";
    });

    if (alignments.includes(null)) return null;

    const columnCount = Math.max(header.length, divider.length);
    const normalizedHeader = normalizeRow(header, columnCount);
    const normalizedAlignments = normalizeRow(alignments, columnCount, "left");

    const parsedRows = parseTableRows(lines, start + 2, columnCount);
    const rows = parsedRows.rows;
    const index = parsedRows.next;

    const head = normalizedHeader
      .map((cell, cellIndex) => `<th data-md-cell-source="${escapeHtml(String(cell).trim())}" style="text-align:${normalizedAlignments[cellIndex]}">${renderTableCell(cell)}</th>`)
      .join("");
    const body = rows
      .map((row) => {
        const cells = normalizedHeader
          .map((_, cellIndex) => {
            const value = row[cellIndex] || "";
            return `<td data-md-cell-source="${escapeHtml(String(value).trim())}" style="text-align:${normalizedAlignments[cellIndex]}">${renderTableCell(value)}</td>`;
          })
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");

    return {
      html: `<table data-md-source-start="${start}" data-md-source-end="${index}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
      next: index
    };
  }

  function parseTableRows(lines, start, columnCount) {
    const rows = [];
    let current = null;
    let index = start;

    function flushCurrent() {
      if (!current) return;
      rows.push(normalizeRow(current, columnCount));
      current = null;
    }

    while (index < lines.length) {
      const line = lines[index];

      if (!line.trim()) {
        if (nextNonEmptyTableRow(lines, index + 1)) {
          index += 1;
          continue;
        }
        break;
      }

      if (!isPotentialTableRow(line)) break;

      const cells = splitTableRow(line);
      const isEmptyPipe = cells.every((cell) => !cell.trim());

      if (isEmptyPipe) {
        flushCurrent();
        index += 1;
        continue;
      }

      if (!current) {
        current = cells;
        index += 1;
        continue;
      }

      if (startsNewTableRow(cells, columnCount)) {
        flushCurrent();
        current = cells;
      } else if (current.length < columnCount) {
        current.push(...cells);
      } else {
        current[columnCount - 1] = [current[columnCount - 1], cells.join(" | ")]
          .filter((value) => String(value || "").trim())
          .join("\n");
      }

      index += 1;
    }

    flushCurrent();

    return { rows, next: index };
  }

  function startsNewTableRow(cells, columnCount) {
    return cells.length >= columnCount || (cells.length > 1 && cells[0].trim() !== "");
  }

  function nextNonEmptyTableRow(lines, start) {
    for (let index = start; index < lines.length; index += 1) {
      if (!lines[index].trim()) continue;
      return isPotentialTableRow(lines[index]);
    }
    return false;
  }

  function renderTableCell(value) {
    const source = String(value || "").trim();
    if (window.marked?.parseInline) {
      return window.marked.parseInline(source, {
        gfm: true,
        breaks: true,
        renderer: createMarkedRenderer(createHeadingSlugger())
      });
    }
    return inlineMarkdown(source).replace(/\n/g, "<br>");
  }

  function splitTableRow(line) {
    const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells = [];
    let cell = "";
    let escaped = false;

    for (let index = 0; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      const next = trimmed[index + 1];

      if (escaped) {
        cell += char;
        escaped = false;
        continue;
      }

      if (char === "\\" && next === "|") {
        escaped = true;
        continue;
      }

      if (char === "|") {
        cells.push(cell);
        cell = "";
        continue;
      }

      cell += char;
    }

    cells.push(cell);
    return cells;
  }

  function normalizeRow(row, length, fallback = "") {
    return Array.from({ length }, (_, index) => row[index] ?? fallback);
  }

  function isPotentialTableRow(line) {
    const trimmed = String(line || "").trim();
    return trimmed.includes("|") && !/^```/.test(trimmed);
  }

  function isPotentialTableDivider(line) {
    if (!isPotentialTableRow(line)) return false;
    const cells = splitTableRow(line);
    return cells.length > 1 && cells.every((cell) => /^:?-{1,}:?$/.test(cell.trim()));
  }

  function parseList(lines, start, ordered) {
    const tag = ordered ? "ol" : "ul";
    const pattern = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-+*]\s+(.+)$/;
    const items = [];
    let index = start;

    while (index < lines.length) {
      const match = lines[index].match(pattern);
      if (!match) break;
      items.push(`<li>${inlineMarkdown(match[1])}</li>`);
      index += 1;
    }

    return {
      html: `<${tag}>${items.join("")}</${tag}>`,
      next: index
    };
  }

  function parseBlocks(markdown) {
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (!line.trim()) {
        index += 1;
        continue;
      }

      const fence = line.match(/^```([\w-]*)\s*$/);
      if (fence) {
        const code = [];
        index += 1;
        while (index < lines.length && !/^```\s*$/.test(lines[index])) {
          code.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
        blocks.push(`<pre><code${language}>${escapeHtml(code.join("\n"))}</code></pre>`);
        continue;
      }

      if (isPotentialTableRow(line) && index + 1 < lines.length) {
        const table = parseTable(lines, index);
        if (table) {
          blocks.push(table.html);
          index = table.next;
          continue;
        }
      }

      const heading = line.match(/^\s{0,3}(#{1,6})[ \t]+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        const content = inlineMarkdown(heading[2].replace(/\s+#+\s*$/, ""));
        const id = slugify(content);
        const idAttr = id ? ` id="${id}"` : "";
        blocks.push(`<h${level}${idAttr}>${content}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^---+$|^\*\*\*+$|^___+$/.test(line.trim())) {
        blocks.push("<hr>");
        index += 1;
        continue;
      }

      if (/^\s*[-+*]\s+/.test(line)) {
        const list = parseList(lines, index, false);
        blocks.push(list.html);
        index = list.next;
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        const list = parseList(lines, index, true);
        blocks.push(list.html);
        index = list.next;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quote = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) {
          quote.push(lines[index].replace(/^>\s?/, ""));
          index += 1;
        }
        blocks.push(`<blockquote>${parseBlocks(quote.join("\n"))}</blockquote>`);
        continue;
      }

      // A bold-leading line is commonly used as a label/section row in notes.
      // Keep it as its own visual line even when Markdown has no blank line.
      if (/^\s*\*\*[^*].*?\*\*/.test(line)) {
        blocks.push(`<p>${inlineMarkdown(line.trim())}</p>`);
        index += 1;
        continue;
      }

      const paragraph = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      blocks.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    }

    return blocks.join("\n");
  }

  function isBlockStart(lines, index) {
    const line = lines[index];
    return (
      /^```/.test(line) ||
      /^\s{0,3}(#{1,6})[ \t]+/.test(line) ||
      /^\s*[-+*]\s+/.test(line) ||
      /^\s*\d+\.\s+/.test(line) ||
      /^>\s?/.test(line) ||
      /^\s*\*\*[^*].*?\*\*/.test(line) ||
      /^---+$|^\*\*\*+$|^___+$/.test(line.trim()) ||
      (isPotentialTableRow(line) && index + 1 < lines.length && isPotentialTableDivider(lines[index + 1]))
    );
  }

  function renderMarkdown(markdown) {
    if (!window.marked?.parse || !window.DOMPurify?.sanitize) {
      return parseBlocks(markdown);
    }

    const extracted = extractInteractiveTables(markdown);
    const prepared = separateBoldLeadingLines(extracted.markdown);
    const renderer = createMarkedRenderer(createHeadingSlugger());
    let html = window.marked.parse(prepared, {
      async: false,
      breaks: false,
      gfm: true,
      renderer
    });

    extracted.tables.forEach((table) => {
      html = html.replace(table.placeholderHtml, table.html);
    });

    const sanitized = window.DOMPurify.sanitize(html, {
      ADD_ATTR: [
        "checked",
        "data-markdown-href",
        "data-markdown-src",
        "data-md-cell-source",
        "data-md-source-end",
        "data-md-source-start",
        "disabled",
        "rel",
        "target"
      ],
      FORBID_TAGS: ["script", "style"]
    });

    return rewriteRenderedUrls(sanitized);
  }

  function extractInteractiveTables(markdown) {
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const output = [];
    const tables = [];
    let index = 0;

    while (index < lines.length) {
      const table = index + 1 < lines.length ? parseTable(lines, index) : null;
      if (!table) {
        output.push(lines[index]);
        index += 1;
        continue;
      }

      const token = `mdviewer-table-${tables.length}-${index}`;
      const placeholderHtml = `<div data-mdviewer-table-token="${token}"></div>`;
      tables.push({
        html: table.html,
        placeholderHtml
      });
      output.push("", placeholderHtml, "");
      index = table.next;
    }

    return {
      markdown: output.join("\n"),
      tables
    };
  }

  function separateBoldLeadingLines(markdown) {
    const lines = String(markdown || "").split("\n");
    const output = [];
    let fence = null;

    lines.forEach((line) => {
      const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (!fence) fence = marker;
        else if (fence === marker) fence = null;
        output.push(line);
        return;
      }

      if (!fence && /^\s*\*\*[^*].*?\*\*/.test(line)) {
        if (output.length && output[output.length - 1] !== "") output.push("");
        output.push(line);
        output.push("");
        return;
      }

      output.push(line);
    });

    return output.join("\n");
  }

  function createMarkedRenderer(slugger) {
    const renderer = new window.marked.Renderer();

    renderer.heading = function (token) {
      const content = this.parser.parseInline(token.tokens || []);
      const id = slugger(token.text || content);
      return `<h${token.depth}${id ? ` id="${escapeHtml(id)}"` : ""}>${content}</h${token.depth}>\n`;
    };

    renderer.link = function (token) {
      const href = sanitizeUrl(token.href);
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      const content = this.parser.parseInline(token.tokens || []);
      return `<a href="${href}" data-markdown-href="${escapeHtml(token.href || "")}"${title} target="_blank" rel="noreferrer noopener">${content}</a>`;
    };

    renderer.image = function (token) {
      const src = sanitizeUrl(token.href, { image: true });
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      return `<img src="${src}" data-markdown-src="${escapeHtml(token.href || "")}" alt="${escapeHtml(token.text || "")}"${title}>`;
    };

    return renderer;
  }

  function createHeadingSlugger() {
    const counts = new Map();
    return (value) => {
      const plain = String(value || "")
        .replace(/<[^>]*>/g, "")
        .replace(/[*_`~[\]()]/g, "")
        .trim()
        .toLowerCase();
      let base;
      try {
        base = plain.replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-").replace(/-+/g, "-");
      } catch (error) {
        base = slugify(plain);
      }
      base = base.replace(/^-+|-+$/g, "");
      if (!base) return "";

      const count = counts.get(base) || 0;
      counts.set(base, count + 1);
      return count ? `${base}-${count}` : base;
    };
  }

  function rewriteRenderedUrls(html) {
    if (!document?.createElement) return html;
    const template = document.createElement("template");
    template.innerHTML = html;

    template.content.querySelectorAll("a[href]").forEach((link) => {
      link.setAttribute("href", resolveUrl(link.getAttribute("href")));
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noreferrer noopener");
    });
    template.content.querySelectorAll("img[src]").forEach((image) => {
      image.setAttribute("src", resolveUrl(image.getAttribute("src"), { image: true }));
    });

    return template.innerHTML;
  }

  window.MDViewerMarkdown = {
    render: renderMarkdown,
    escapeHtml
  };
})();
