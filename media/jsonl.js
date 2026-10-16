(function (root) {
  let lastPreviewLine = 1;
  let activePreviewText = "";

  function parseJsonl(input) {
    const text = String(input ?? "");
    const records = [];
    let emptyLines = 0;

    forEachJsonlLine(text, (raw, index, isTrailingEmpty) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        if (!isTrailingEmpty || raw.length > 0) emptyLines += 1;
        return;
      }

      try {
        records.push({ line: index + 1, raw, value: JSON.parse(trimmed), error: null });
      } catch (error) {
        records.push({
          line: index + 1,
          raw,
          value: null,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    return {
      emptyLines,
      invalidCount: records.filter((record) => record.error).length,
      records
    };
  }

  function jsonlTableRows(input) {
    const flattened = [];
    const columns = ["$line"];
    const seen = new Set(columns);
    const appendRecord = (record) => {
      const row = Object.create(null);
      row.$line = record.line;
      if (record.error) {
        row.$error = record.error;
        row.$raw = record.raw;
      } else if (isPlainObject(record.value)) {
        flattenObject(record.value, "", row);
      } else {
        row.$value = record.value;
      }
      Object.keys(row).forEach((key) => {
        if (!seen.has(key)) {
          seen.add(key);
          columns.push(key);
        }
      });
      flattened.push(row);
    };

    if (typeof input === "string") {
      forEachJsonlLine(input, (raw, index) => {
        const trimmed = raw.trim();
        if (!trimmed) return;
        try {
          appendRecord({ line: index + 1, raw, value: JSON.parse(trimmed), error: null });
        } catch (error) {
          appendRecord({
            line: index + 1,
            raw,
            value: null,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      });
    } else {
      input.records.forEach(appendRecord);
    }

    return [columns, ...flattened.map((row) => columns.map((column) => cellText(row[column])))];
  }

  function forEachJsonlLine(input, callback) {
    const text = String(input ?? "");
    let start = 0;
    let lineIndex = 0;
    for (let index = 0; index <= text.length; index += 1) {
      if (index !== text.length && text.charCodeAt(index) !== 10) continue;
      let end = index;
      if (end > start && text.charCodeAt(end - 1) === 13) end -= 1;
      const isTrailingEmpty = index === text.length && start === text.length && (text.length === 0 || text.endsWith("\n"));
      callback(text.slice(start, end), lineIndex, isTrailingEmpty);
      lineIndex += 1;
      start = index + 1;
    }
  }

  function flattenObject(value, prefix, output) {
    const reservedColumns = new Set(["$line", "$error", "$raw", "$value"]);
    const entries = Object.entries(value);
    if (!entries.length && prefix) {
      output[prefix] = {};
      return;
    }

    entries.forEach(([key, child]) => {
      const rootKey = !prefix && reservedColumns.has(key) ? `data.${key}` : key;
      const path = prefix ? `${prefix}.${key}` : rootKey;
      if (isPlainObject(child) && Object.keys(child).length) {
        flattenObject(child, path, output);
      } else {
        output[path] = child;
      }
    });
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function cellText(value) {
    if (value === undefined) return "";
    if (typeof value === "string") return value;
    if (value === null || typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function renderJsonlViewer(container, input, options = {}) {
    const text = String(input ?? "");
    const lineStarts = jsonlLineStarts(text);
    let activeLine = Math.max(1, Math.min(lastPreviewLine, lineStarts.length));
    container.innerHTML = "";

    const chrome = document.createElement("div");
    chrome.className = "jsonl-chrome";
    const summary = document.createElement("div");
    summary.className = "jsonl-summary";
    const actions = document.createElement("div");
    actions.className = "jsonl-actions";
    const previousButton = actionButton("Previous", () => showLine(activeLine - 1));
    const nextButton = actionButton("Next", () => showLine(activeLine + 1));
    const lineInput = document.createElement("input");
    lineInput.className = "jsonl-line-input";
    lineInput.type = "number";
    lineInput.min = "1";
    lineInput.max = String(lineStarts.length);
    lineInput.setAttribute("aria-label", "Source line to preview");
    lineInput.addEventListener("change", () => showLine(Number(lineInput.value)));
    lineInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") showLine(Number(lineInput.value));
    });
    const copyButton = actionButton("Copy", async () => {
      await copyText(previewText(text, lineStarts, activeLine, options.filename).copyText);
      root.__mdViewerShowToast?.(`Copied line ${activeLine}`);
    });
    actions.append(previousButton, nextButton, lineInput, copyButton);
    chrome.append(summary, actions);

    const scroller = document.createElement("div");
    scroller.className = "jsonl-scroll jsonl-code-scroll";
    const code = document.createElement("div");
    code.className = "jsonl-code-preview";
    scroller.appendChild(code);

    container.append(chrome, scroller);
    showLine(activeLine);

    function showLine(lineNumber) {
      activeLine = Math.max(1, Math.min(Number.isFinite(lineNumber) ? Math.trunc(lineNumber) : activeLine, lineStarts.length));
      lastPreviewLine = activeLine;
      const preview = previewText(text, lineStarts, activeLine, options.filename);
      activePreviewText = preview.copyText;
      summary.textContent = `${options.filename || "JSONL"}:${activeLine} · ${preview.status} · ${lineStarts.length} lines`;
      lineInput.value = String(activeLine);
      previousButton.disabled = activeLine <= 1;
      nextButton.disabled = activeLine >= lineStarts.length;
      renderHighlightedCode(code, preview.displayText);
      scroller.scrollTop = 0;
      scroller.scrollLeft = 0;
    }

    return { lineCount: lineStarts.length };
  }

  function jsonlLineStarts(input) {
    const text = String(input ?? "");
    const starts = [0];
    for (let index = 0; index < text.length; index += 1) {
      if (text.charCodeAt(index) === 10 && index + 1 < text.length) starts.push(index + 1);
    }
    return starts;
  }

  function jsonlLineAt(text, starts, lineNumber) {
    const index = Math.max(0, Math.min(starts.length - 1, lineNumber - 1));
    const start = starts[index];
    let end = index + 1 < starts.length ? starts[index + 1] - 1 : text.length;
    if (end > start && text.charCodeAt(end - 1) === 13) end -= 1;
    return text.slice(start, end);
  }

  function previewText(text, starts, lineNumber, filename = "document.jsonl") {
    const raw = jsonlLineAt(text, starts, lineNumber);
    const header = `// ${filename || "document.jsonl"}:${lineNumber}`;
    if (!raw.trim()) {
      return { copyText: raw, displayText: `${header}\n// (empty line)`, status: "Empty line" };
    }
    try {
      const formatted = JSON.stringify(JSON.parse(raw.trim()), null, 2);
      return { copyText: formatted, displayText: `${header}\n${formatted}`, status: "Valid JSON" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        copyText: raw,
        displayText: `${header}\n// Invalid JSON: ${message}\n\n${raw}`,
        status: "Invalid JSON"
      };
    }
  }

  function renderHighlightedCode(container, text) {
    container.innerHTML = "";
    String(text).split("\n").forEach((line, index) => {
      const row = document.createElement("div");
      row.className = "jsonl-code-line";
      const number = document.createElement("span");
      number.className = "jsonl-code-line-number";
      number.textContent = String(index + 1);
      const content = document.createElement("code");
      content.className = "jsonl-code-line-content";
      if (line.trimStart().startsWith("//")) {
        const comment = document.createElement("span");
        comment.className = "jsonl-token-comment";
        comment.textContent = line;
        content.appendChild(comment);
      } else {
        appendJsonTokens(content, line);
      }
      row.append(number, content);
      container.appendChild(row);
    });
  }

  function appendJsonTokens(container, line) {
    const pattern = /"(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(line))) {
      if (match.index > cursor) container.appendChild(document.createTextNode(line.slice(cursor, match.index)));
      const token = document.createElement("span");
      const value = match[0];
      token.className = value.trimEnd().endsWith(":")
        ? "jsonl-token-key"
        : value.startsWith('"')
          ? "jsonl-token-string"
          : value === "true" || value === "false"
            ? "jsonl-token-boolean"
            : value === "null"
              ? "jsonl-token-null"
              : "jsonl-token-number";
      token.textContent = value;
      container.appendChild(token);
      cursor = pattern.lastIndex;
    }
    if (cursor < line.length) container.appendChild(document.createTextNode(line.slice(cursor)));
  }

  function actionButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", (event) => {
      Promise.resolve(action(event)).catch(() => root.__mdViewerShowToast?.("Copy failed", { tone: "error" }));
    });
    return button;
  }

  async function copyText(text) {
    if (root.__mdViewerCopyText) {
      await root.__mdViewerCopyText(text);
      return;
    }
    await navigator.clipboard.writeText(String(text ?? ""));
  }

  const api = {
    cellText,
    flattenObject,
    getActivePreviewText: () => activePreviewText,
    jsonlLineAt,
    jsonlLineStarts,
    jsonlTableRows,
    parseJsonl,
    previewText,
    renderJsonlViewer
  };
  root.MDViewerJsonl = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
