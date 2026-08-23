(function () {
  const scriptNonce = document.currentScript?.nonce || "";
  const viewerScriptSrc = document.currentScript?.src || "";
  const vscode = acquireVsCodeApi();
  const preview = document.getElementById("preview");
  const dataGrid = document.getElementById("dataGrid");
  const sourceView = document.getElementById("sourceView");
  const sourceCode = document.getElementById("sourceCode");
  const documentMeta = document.getElementById("documentMeta");
  const dropZone = document.getElementById("dropZone");
  const toggleTheme = document.getElementById("toggleTheme");
  const toggleFullWidth = document.getElementById("toggleFullWidth");
  const toggleSource = document.getElementById("toggleSource");
  const toggleToc = document.getElementById("toggleToc");
  const openEdit = document.getElementById("openEdit");
  const downloadDocument = document.getElementById("downloadDocument");
  const downloadPdf = document.getElementById("downloadPdf");
  const showHelp = document.getElementById("showHelp");
  const fullWidthStorageKey = "md-viewer-full-width";
  const sourceStorageKey = "md-viewer-source-view";
  const tocStorageKey = "md-viewer-toc-visible";
  const toolbarHiddenStorageKey = "md-viewer-toolbar-hidden";
  const selectionStatsStorageKey = "md-viewer-selection-stats-disabled";
  const pdfAssets = resolvePdfAssetUrls();
  let pdfLibraryPromise = null;
  let currentDocument = {
    filename: "document",
    kind: "markdown",
    meta: "",
    text: ""
  };
  let markdownAllSelected = false;
  let selectionContextMenu = null;
  let lastFocusRequestAt = 0;
  const findState = {
    bar: null,
    input: null,
    count: null,
    matches: [],
    activeIndex: -1,
    query: ""
  };

  const savedTheme = localStorage.getItem("md-viewer-theme");
  if (savedTheme) {
    document.documentElement.dataset.theme = savedTheme;
  }

  toggleFullWidth.checked = localStorage.getItem(fullWidthStorageKey) === "true";
  dropZone.classList.toggle("is-md-full-width", toggleFullWidth.checked);
  toggleSource.checked = localStorage.getItem(sourceStorageKey) === "true";
  toggleToc.checked = localStorage.getItem(tocStorageKey) === "true";
  document.body.classList.toggle("is-toolbar-hidden", localStorage.getItem(toolbarHiddenStorageKey) === "true");
  dropZone.tabIndex = -1;
  window.__mdViewerFocusSurface = focusViewerSurface;
  window.__mdViewerSaveCopy = (filename, text) => {
    vscode.postMessage({
      type: "saveCopy",
      filename,
      text
    });
  };

  toggleTheme.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("md-viewer-theme", nextTheme);
  });

  openEdit.addEventListener("click", openTextEditor);
  downloadPdf.addEventListener("click", exportPdf);
  downloadDocument.addEventListener("click", saveCopy);
  showHelp.addEventListener("click", openHelp);
  document.addEventListener("keydown", handleViewerShortcuts);
  document.addEventListener("copy", handleCopySelection);
  document.addEventListener("selectionchange", syncMarkdownSelectionState);
  document.addEventListener("contextmenu", handleSelectionContextMenu);
  document.addEventListener("click", hideSelectionContextMenu);
  document.addEventListener("scroll", hideSelectionContextMenu, true);
  document.addEventListener("pointerdown", handleViewerPointerDown, true);
  initializeFindBar();

  toggleFullWidth.addEventListener("change", () => {
    localStorage.setItem(fullWidthStorageKey, String(toggleFullWidth.checked));
    dropZone.classList.toggle("is-md-full-width", toggleFullWidth.checked);
  });

  toggleSource.addEventListener("change", () => {
    localStorage.setItem(sourceStorageKey, String(toggleSource.checked));
    renderCurrentDocument();
  });

  toggleToc.addEventListener("change", () => {
    localStorage.setItem(tocStorageKey, String(toggleToc.checked));
    window.MDViewerMarkdownEnhancer.setTocVisible(toggleToc.checked);
    showToast(toggleToc.checked ? "TOC shown" : "TOC hidden");
  });

  window.addEventListener("message", (event) => {
    if (event.data?.type !== "documentUpdate") return;
    renderDocument(event.data);
  });

  renderDocument(window.__MD_VIEWER_INITIAL__ || {});

  function renderDocument(documentInfo) {
    currentDocument = {
      filename: String(documentInfo.filename || "document"),
      kind: documentInfo.kind || "markdown",
      meta: documentInfo.meta || "",
      text: String(documentInfo.text || "")
    };
    renderCurrentDocument();
  }

  function renderCurrentDocument() {
    const { kind, meta, text } = currentDocument;
    const isDelimited = kind === "csv" || kind === "tsv";
    const isSource = toggleSource.checked;
    window.MDViewerTabular.clearMarkdownTableSelection?.();
    toggleSource.disabled = false;
    toggleFullWidth.disabled = isDelimited;
    toggleToc.disabled = isDelimited || isSource;

    if (isSource) {
      window.MDViewerTabular.clearActiveGrid();
      window.MDViewerMarkdownEnhancer.clearToc();
      preview.hidden = true;
      dataGrid.hidden = true;
      dataGrid.innerHTML = "";
      sourceView.hidden = false;
      sourceCode.className = `language-${kind}`;
      sourceCode.textContent = text;
    } else if (isDelimited) {
      window.MDViewerMarkdownEnhancer.clearToc();
      sourceView.hidden = true;
      sourceCode.textContent = "";
      preview.hidden = true;
      preview.innerHTML = "";
      dataGrid.hidden = false;
      window.MDViewerTabular.renderDataGrid(dataGrid, text, kind);
    } else {
      sourceView.hidden = true;
      sourceCode.textContent = "";
      window.MDViewerTabular.clearActiveGrid();
      dataGrid.hidden = true;
      dataGrid.innerHTML = "";
      preview.innerHTML = window.MDViewerMarkdown.render(text);
      window.MDViewerTabular.decorateTables(preview);
      window.MDViewerMarkdownEnhancer.enhance(preview, { sourceText: text, tocEnabled: toggleToc.checked });
      preview.hidden = false;
    }

    syncWrapState();
    dropZone.classList.toggle("is-data-mode", isDelimited && !isSource);
    dropZone.classList.toggle("is-source-mode", isSource);
    document.body.classList.toggle("has-grid-view", (isDelimited && !isSource) || isSource);
    documentMeta.textContent = meta;
    document.title = currentDocument.filename ? `MD Viewer - ${currentDocument.filename}` : "MD Viewer";
    hideSelectionContextMenu();
    if (isFindOpen()) {
      refreshFind();
    } else {
      clearFindHighlights();
    }
  }

  function syncWrapState() {
    const enabled = localStorage.getItem("md-viewer-table-wrap") === "true";
    window.MDViewerTabular?.setWrapEnabled?.(enabled, document);
  }

  async function handleViewerShortcuts(event) {
    if (document.querySelector(".help-modal")) return;

    const key = event.key.toLowerCase();
    const commandOrControl = event.metaKey || event.ctrlKey;
    const inTextInput = isTextInput(event.target);

    if (commandOrControl && key === "f") {
      event.preventDefault();
      openFindBar();
      return;
    }

    if (key === "escape" && isFindOpen()) {
      event.preventDefault();
      closeFindBar();
      return;
    }

    if (key === "e" && !commandOrControl && !event.altKey && !event.shiftKey) {
      if (inTextInput) return;
      event.preventDefault();
      openTextEditor();
      return;
    }

    if (commandOrControl && key === "a") {
      if (inTextInput) return;
      event.preventDefault();
      selectVisibleContent();
      return;
    }

    if (event.ctrlKey && key === "b") {
      event.preventDefault();
      toggleToolbar();
      return;
    }

    if (key === "c" && !commandOrControl && !event.altKey) {
      if (inTextInput && !event.ctrlKey) return;
      event.preventDefault();
      await copyCurrentContent({ source: event.shiftKey });
      return;
    }

    const allowSingleKeyShortcut = !inTextInput || event.ctrlKey;
    if (commandOrControl || event.altKey || event.shiftKey || !allowSingleKeyShortcut) return;

    if (key === "f" && !toggleFullWidth.disabled) {
      event.preventDefault();
      toggleFullWidth.checked = !toggleFullWidth.checked;
      toggleFullWidth.dispatchEvent(new Event("change"));
    } else if (key === "t" && !toggleToc.disabled) {
      event.preventDefault();
      toggleToc.checked = !toggleToc.checked;
      toggleToc.dispatchEvent(new Event("change"));
    } else if (key === "s" && !toggleSource.disabled) {
      event.preventDefault();
      toggleSource.checked = !toggleSource.checked;
      toggleSource.dispatchEvent(new Event("change"));
    } else if (key === "d") {
      event.preventDefault();
      saveCopy();
    } else if (key === "p") {
      event.preventDefault();
      exportPdf();
    } else if (key === " ") {
      if (window.MDViewerTabular.openHoveredMarkdownTableGrid?.(event.target)) {
        event.preventDefault();
      }
    } else if (key === "w") {
      event.preventDefault();
      window.MDViewerTabular.toggleWrap(document);
    } else if (key === "v") {
      event.preventDefault();
      const enabled = window.MDViewerTabular.toggleMarkdownTableSelection?.(event.target);
      if (enabled !== null && enabled !== undefined) showToast(enabled ? "Table selection on" : "Table selection off");
    } else if (key === "u") {
      event.preventDefault();
      const format = window.MDViewerTabular.toggleNumberFormat();
      showToast(`Number format: ${format.toUpperCase()}`);
    } else if (key === "h") {
      event.preventDefault();
      const enabled = window.MDViewerTabular.toggleHeaderRow();
      if (enabled !== null) showToast(enabled ? "First row is header" : "Generated headers A-Z");
    }
  }

  function openTextEditor() {
    vscode.postMessage({ type: "openEdit" });
  }

  function toggleToolbar() {
    const nextHidden = !document.body.classList.contains("is-toolbar-hidden");
    document.body.classList.toggle("is-toolbar-hidden", nextHidden);
    localStorage.setItem(toolbarHiddenStorageKey, String(nextHidden));
  }

  function handleViewerPointerDown(event) {
    if (!event.target?.closest?.("#dropZone")) return;
    if (isTextInput(event.target)) return;
    focusViewerSurface();
  }

  function focusViewerSurface() {
    window.focus();
    dropZone.focus({ preventScroll: true });
    requestViewerFocus();
  }

  function requestViewerFocus() {
    const now = Date.now();
    if (now - lastFocusRequestAt < 250) return;
    lastFocusRequestAt = now;
    vscode.postMessage({ type: "focusViewer" });
  }

  async function copyCurrentContent({ source }) {
    try {
      if (!source && !preview.hidden) {
        await copyRenderedMarkdown();
        showToast("Copied rendered Markdown");
        return;
      }

      const text = source ? currentDocument.text : currentRenderedText();
      if (!text) {
        showToast("Nothing to copy", { tone: "warning" });
        return;
      }
      await copyText(text);
      showToast(source ? "Copied source" : "Copied content");
    } catch (error) {
      showToast("Copy failed", { tone: "error" });
    }
  }

  function currentRenderedText() {
    if (!dataGrid.hidden) return window.MDViewerTabular.getActiveGridText({ includeHeader: true });
    if (!sourceView.hidden) return sourceCode.textContent;
    if (!preview.hidden) return viewerContentText(preview);
    return "";
  }

  function selectVisibleContent() {
    markdownAllSelected = false;
    if (!dataGrid.hidden && window.MDViewerTabular.selectAllActiveGrid()) return;
    if (!preview.hidden && window.MDViewerTabular.selectAllActiveMarkdownTable?.()) return;

    const target = !sourceView.hidden ? sourceCode : preview;
    if (!target || target.hidden) return;

    if (!sourceView.hidden) {
      selectNodeContents(sourceCode);
      return;
    }

    selectNodeContents(preview);
    markdownAllSelected = true;
  }

  function selectNodeContents(target) {
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function viewerContentText(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll(".table-toolbar, .code-toolbar, .grid-chrome, .help-modal, .heading-actions, .heading-action-button").forEach((element) => element.remove());
    unwrapFindHighlights(clone);
    clone.querySelectorAll("pre[hidden], [hidden]").forEach((element) => element.remove());
    return clone.innerText.trim();
  }

  function renderedMarkdownHtml() {
    const clone = preview.cloneNode(true);
    clone.querySelectorAll(".table-toolbar, .code-toolbar, .grid-chrome, .help-modal, .heading-actions, .heading-action-button").forEach((element) => element.remove());
    unwrapFindHighlights(clone);
    clone.querySelectorAll("pre[hidden], [hidden]").forEach((element) => element.remove());
    return clone.innerHTML;
  }

  function unwrapFindHighlights(root) {
    root.querySelectorAll(".find-highlight").forEach((mark) => {
      mark.replaceWith(document.createTextNode(mark.textContent || ""));
    });
  }

  function initializeFindBar() {
    const bar = document.createElement("div");
    bar.className = "find-bar";
    bar.hidden = true;
    bar.innerHTML = `
      <input class="find-input" type="search" placeholder="Find" aria-label="Find in viewer">
      <span class="find-count">0 / 0</span>
      <button class="find-prev" type="button" title="Previous match">↑</button>
      <button class="find-next" type="button" title="Next match">↓</button>
      <button class="find-close" type="button" title="Close find">×</button>
    `;
    document.body.appendChild(bar);

    findState.bar = bar;
    findState.input = bar.querySelector(".find-input");
    findState.count = bar.querySelector(".find-count");

    findState.input.addEventListener("input", () => {
      findState.query = findState.input.value;
      refreshFind();
    });

    findState.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        stepFind(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeFindBar();
      }
    });

    bar.querySelector(".find-prev").addEventListener("click", () => stepFind(-1));
    bar.querySelector(".find-next").addEventListener("click", () => stepFind(1));
    bar.querySelector(".find-close").addEventListener("click", closeFindBar);
  }

  function openFindBar() {
    findState.bar.hidden = false;
    findState.input.focus();
    findState.input.select();
    refreshFind();
  }

  function closeFindBar() {
    findState.bar.hidden = true;
    clearFindHighlights();
  }

  function isFindOpen() {
    return findState.bar && !findState.bar.hidden;
  }

  function refreshFind() {
    clearFindHighlights();
    findState.matches = [];
    findState.activeIndex = -1;

    const query = String(findState.query || "").trim();
    if (!query) {
      updateFindCount();
      return;
    }

    const root = currentFindRoot();
    if (!root) {
      updateFindCount();
      return;
    }

    highlightFindMatches(root, query);
    if (findState.matches.length) {
      findState.activeIndex = 0;
      syncActiveFindMatch({ scroll: isFindOpen() });
    }
    updateFindCount();
  }

  function currentFindRoot() {
    if (!dataGrid.hidden) return dataGrid;
    if (!sourceView.hidden) return sourceCode;
    if (!preview.hidden) return preview;
    return null;
  }

  function highlightFindMatches(root, query) {
    const textNodes = findTextNodes(root);
    const needle = query.toLowerCase();

    textNodes.forEach((node) => {
      const text = node.nodeValue || "";
      const lower = text.toLowerCase();
      let cursor = 0;
      let matchIndex = lower.indexOf(needle);
      if (matchIndex < 0) return;

      const fragment = document.createDocumentFragment();
      while (matchIndex >= 0) {
        if (matchIndex > cursor) {
          fragment.appendChild(document.createTextNode(text.slice(cursor, matchIndex)));
        }

        const mark = document.createElement("mark");
        mark.className = "find-highlight";
        mark.textContent = text.slice(matchIndex, matchIndex + query.length);
        fragment.appendChild(mark);
        findState.matches.push(mark);

        cursor = matchIndex + query.length;
        matchIndex = lower.indexOf(needle, cursor);
      }

      if (cursor < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(cursor)));
      }

      node.parentNode.replaceChild(fragment, node);
    });
  }

  function findTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || shouldSkipFindNode(parent)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    return nodes;
  }

  function shouldSkipFindNode(element) {
    return Boolean(element.closest([
      ".toolbar",
      ".find-bar",
      ".markdown-toc",
      ".table-toolbar",
      ".code-toolbar",
      ".grid-chrome",
      ".grid-context-menu",
      ".selection-context-menu",
      ".help-modal",
      ".heading-actions",
      "button",
      "input",
      "textarea",
      "select",
      "[hidden]"
    ].join(",")));
  }

  function clearFindHighlights() {
    document.querySelectorAll(".find-highlight").forEach((mark) => {
      const parent = mark.parentNode;
      mark.replaceWith(document.createTextNode(mark.textContent || ""));
      parent?.normalize();
    });
    findState.matches = [];
    findState.activeIndex = -1;
  }

  function stepFind(direction) {
    if (!findState.matches.length) {
      refreshFind();
      if (!findState.matches.length) return;
    }

    findState.activeIndex = (findState.activeIndex + direction + findState.matches.length) % findState.matches.length;
    syncActiveFindMatch({ scroll: true });
    updateFindCount();
  }

  function syncActiveFindMatch(options = {}) {
    findState.matches.forEach((match, index) => {
      match.classList.toggle("is-active", index === findState.activeIndex);
    });

    const active = findState.matches[findState.activeIndex];
    if (active && options.scroll) {
      active.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }

  function updateFindCount() {
    if (!findState.count) return;
    const total = findState.matches.length;
    const current = total ? findState.activeIndex + 1 : 0;
    findState.count.textContent = `${current} / ${total}`;
    findState.input?.classList.toggle("has-no-results", Boolean(findState.query) && total === 0);
  }

  function handleCopySelection(event) {
    if (preview.hidden || !markdownAllSelected || !isNodeContentsSelected(preview)) return;

    event.preventDefault();
    event.clipboardData.setData("text/html", renderedMarkdownHtml());
    event.clipboardData.setData("text/plain", viewerContentText(preview));
  }

  function syncMarkdownSelectionState() {
    if (markdownAllSelected && !isNodeContentsSelected(preview)) {
      markdownAllSelected = false;
    }
  }

  function handleSelectionContextMenu(event) {
    if (event.target?.closest?.(".selection-context-menu, .grid-context-menu")) return;

    const selection = currentViewerSelection();
    if (!selection) {
      hideSelectionContextMenu();
      return;
    }

    event.preventDefault();
    showSelectionContextMenu(event.clientX, event.clientY, selection);
  }

  function showSelectionContextMenu(clientX, clientY, selection) {
    hideSelectionContextMenu();

    const menu = document.createElement("div");
    menu.className = "selection-context-menu";
    menu.setAttribute("role", "menu");

    const stats = selectionStats(selection.text);
    const statsInfo = document.createElement("div");
    statsInfo.className = "selection-count-info";
    statsInfo.textContent = selectionStatsDisabled()
      ? "Count info hidden"
      : `${stats.characters} chars · ${stats.words} words`;

    const slugButton = selectionMenuButton("Copy slug", async () => {
      await copyText(slugifySelection(selection.text));
      showToast("Copied slug");
    });
    const textButton = selectionMenuButton("Copy text", async () => {
      await copyText(selection.text);
      showToast("Copied text");
    });
    const markdownButton = selectionMenuButton("Copy Markdown", async () => {
      const markdown = selectionMarkdown(selection);
      if (!markdown) throw new Error("No Markdown selection");
      await copyText(markdown);
      showToast("Copied Markdown");
    });
    const richTextButton = selectionMenuButton("Copy rich text", async () => {
      const copiedRichText = await copyRichSelection(selection);
      showToast(copiedRichText ? "Copied rich text" : "Copied text");
    });
    const statsButton = selectionMenuButton(selectionStatsDisabled() ? "Enable count info" : "Disable count info", async () => {
      const disabled = !selectionStatsDisabled();
      localStorage.setItem(selectionStatsStorageKey, String(disabled));
      showToast(disabled ? "Selection count hidden" : "Selection count shown");
    });

    menu.append(statsInfo, slugButton, textButton, markdownButton, richTextButton, statsButton);
    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    const left = Math.min(clientX, window.innerWidth - rect.width - 8);
    const top = Math.min(clientY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    selectionContextMenu = menu;
  }

  function selectionMenuButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.addEventListener("click", async () => {
      try {
        await action();
      } catch (error) {
        showToast("Copy failed", { tone: "error" });
      } finally {
        hideSelectionContextMenu();
      }
    });
    return button;
  }

  function hideSelectionContextMenu(event) {
    if (event?.target?.closest?.(".selection-context-menu")) return;
    selectionContextMenu?.remove();
    selectionContextMenu = null;
  }

  function selectionStatsDisabled() {
    return localStorage.getItem(selectionStatsStorageKey) === "true";
  }

  function selectionStats(text) {
    const normalized = String(text || "").trim();
    const characters = Array.from(normalized).length;
    const words = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
    return { characters, words };
  }

  function currentViewerSelection() {
    if (currentDocument.kind !== "markdown") return null;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;

    const text = selection.toString();
    if (!text.trim()) return null;

    const range = selection.getRangeAt(0);
    const root = selectionRootForRange(range);
    if (!root) return null;

    return {
      fragment: cloneSelectionFragment(range),
      range,
      root,
      text: text.trim()
    };
  }

  function selectionRootForRange(range) {
    const start = nodeElement(range.startContainer);
    const end = nodeElement(range.endContainer);
    if (!start || !end) return null;

    if (!sourceView.hidden && sourceCode.contains(start) && sourceCode.contains(end)) return sourceCode;
    if (!preview.hidden && preview.contains(start) && preview.contains(end)) return preview;
    return null;
  }

  function nodeElement(node) {
    return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  }

  function cloneSelectionFragment(range) {
    const fragment = range.cloneContents();
    cleanSelectionFragment(fragment);
    return fragment;
  }

  function cleanSelectionFragment(fragment) {
    fragment.querySelectorAll?.([
      ".table-toolbar",
      ".code-toolbar",
      ".grid-chrome",
      ".help-modal",
      ".heading-actions",
      ".heading-action-button",
      ".find-highlight",
      "button",
      "input",
      "textarea",
      "select",
      "[hidden]"
    ].join(",")).forEach((element) => {
      if (element.classList?.contains("find-highlight")) {
        element.replaceWith(document.createTextNode(element.textContent || ""));
      } else {
        element.remove();
      }
    });
  }

  function slugifySelection(text) {
    return String(text || "")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function selectionMarkdown(selection) {
    if (selection.root === sourceCode) return selection.text;
    const container = document.createElement("div");
    container.appendChild(selection.fragment.cloneNode(true));
    return htmlFragmentToMarkdown(container).trim();
  }

  async function copyRichSelection(selection) {
    if (selection.root === sourceCode) {
      await copyText(selection.text);
      return false;
    }

    const container = document.createElement("div");
    container.appendChild(selection.fragment.cloneNode(true));
    const html = container.innerHTML;
    const text = (container.innerText || container.textContent || "").trim() || selection.text;

    await copyHtml(html, text);
    rememberCopiedText(text);
    return true;
  }

  async function copyHtml(html, text) {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" })
        })
      ]);
      return;
    }

    await copyText(text);
  }

  function htmlFragmentToMarkdown(root) {
    return Array.from(root.childNodes)
      .map((node) => nodeToMarkdown(node, { inline: false }))
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function nodeToMarkdown(node, context = {}) {
    if (node.nodeType === Node.TEXT_NODE) {
      return context.inline ? node.nodeValue || "" : normalizeMarkdownWhitespace(node.nodeValue || "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    if (node.hidden || node.closest?.(".heading-actions, .table-toolbar, .code-toolbar")) return "";

    if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${inlineChildrenToMarkdown(node).trim()}\n\n`;
    if (tag === "p") return `${inlineChildrenToMarkdown(node).trim()}\n\n`;
    if (tag === "strong" || tag === "b") return `**${inlineChildrenToMarkdown(node).trim()}**`;
    if (tag === "em" || tag === "i") return `*${inlineChildrenToMarkdown(node).trim()}*`;
    if (tag === "del" || tag === "s") return `~~${inlineChildrenToMarkdown(node).trim()}~~`;
    if (tag === "code" && node.closest("pre")) return node.textContent || "";
    if (tag === "code") return `\`${(node.textContent || "").replace(/`/g, "\\`")}\``;
    if (tag === "pre") return codeBlockToMarkdown(node);
    if (tag === "br") return context.inline ? "  \n" : "\n";
    if (tag === "a") return linkToMarkdown(node);
    if (tag === "img") return imageToMarkdown(node);
    if (tag === "ul" || tag === "ol") return listToMarkdown(node, tag === "ol");
    if (tag === "li") return inlineChildrenToMarkdown(node).trim();
    if (tag === "blockquote") return blockquoteToMarkdown(node);
    if (tag === "table") return tableToMarkdown(node);
    if (tag === "hr") return "---\n\n";

    const children = Array.from(node.childNodes).map((child) => nodeToMarkdown(child, context)).join("");
    return isBlockElement(node) ? `${children.trim()}\n\n` : children;
  }

  function inlineChildrenToMarkdown(node) {
    return Array.from(node.childNodes)
      .map((child) => nodeToMarkdown(child, { inline: true }))
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeMarkdownWhitespace(text) {
    return String(text || "").replace(/\s+/g, " ");
  }

  function linkToMarkdown(node) {
    const label = inlineChildrenToMarkdown(node) || node.textContent || "";
    const href = node.getAttribute("href") || "";
    return href ? `[${label}](${href})` : label;
  }

  function imageToMarkdown(node) {
    const alt = node.getAttribute("alt") || "";
    const src = node.getAttribute("src") || "";
    return src ? `![${alt}](${src})` : alt;
  }

  function codeBlockToMarkdown(node) {
    const code = node.textContent?.replace(/\n$/, "") || "";
    const language = node.querySelector("code")?.className?.match(/language-([\w-]+)/)?.[1] || "";
    return `\`\`\`${language}\n${code}\n\`\`\`\n\n`;
  }

  function listToMarkdown(node, ordered) {
    const items = Array.from(node.children)
      .filter((child) => child.tagName?.toLowerCase() === "li")
      .map((item, index) => `${ordered ? `${index + 1}.` : "-"} ${inlineChildrenToMarkdown(item)}`)
      .join("\n");
    return `${items}\n\n`;
  }

  function blockquoteToMarkdown(node) {
    const content = Array.from(node.childNodes)
      .map((child) => nodeToMarkdown(child, { inline: false }))
      .join("")
      .trim();
    return `${content.split("\n").map((line) => `> ${line}`.trimEnd()).join("\n")}\n\n`;
  }

  function tableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
      Array.from(row.children).map((cell) => inlineChildrenToMarkdown(cell).replace(/\|/g, "\\|"))
    );
    if (!rows.length) return "";

    const columnCount = Math.max(...rows.map((row) => row.length));
    const normalizedRows = rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] || ""));
    const header = normalizedRows[0];
    const divider = Array.from({ length: columnCount }, () => "---");
    const body = normalizedRows.slice(1);
    return [
      `| ${header.join(" | ")} |`,
      `| ${divider.join(" | ")} |`,
      ...body.map((row) => `| ${row.join(" | ")} |`)
    ].join("\n") + "\n\n";
  }

  function isBlockElement(node) {
    return /^(address|article|aside|blockquote|div|dl|fieldset|figcaption|figure|footer|form|header|main|nav|ol|p|pre|section|table|ul)$/i.test(node.tagName || "");
  }

  function isNodeContentsSelected(target) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount !== 1 || !target) return false;

    const range = selection.getRangeAt(0);
    return range.startContainer === target &&
      range.startOffset === 0 &&
      range.endContainer === target &&
      range.endOffset === target.childNodes.length;
  }

  function isTextInput(target) {
    return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      rememberCopiedText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.inset = "0 auto auto 0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    rememberCopiedText(text);
  }

  function rememberCopiedText(text) {
    window.__mdViewerLastCopiedText = String(text ?? "");
  }

  async function copyRenderedMarkdown() {
    const html = renderedMarkdownHtml();
    const text = viewerContentText(preview);

    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" })
        })
      ]);
      rememberCopiedText(text);
      return;
    }

    await copyText(text);
  }

  function saveCopy() {
    vscode.postMessage({
      type: "saveCopy",
      filename: documentFilename(currentDocument),
      text: currentDocument.text
    });
  }

  async function exportPdf() {
    let pdfLibraries;
    try {
      pdfLibraries = await loadPdfLibraries();
    } catch (error) {
      showToast("PDF export is not available", { tone: "error" });
      vscode.postMessage({
        type: "error",
        message: `PDF export libraries did not load: ${error?.message || error}`
      });
      return;
    }

    const root = currentPdfRoot();
    if (!root) {
      showToast("Nothing to export", { tone: "warning" });
      return;
    }

    downloadPdf.disabled = true;
    showToast("Preparing PDF...");

    try {
      const { container, background } = createPdfExportSurface(root);
      document.body.appendChild(container);

      const canvas = await pdfLibraries.html2canvas(container, {
        backgroundColor: background,
        logging: false,
        scale: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
        useCORS: true,
        windowWidth: container.scrollWidth,
        windowHeight: container.scrollHeight
      });

      container.remove();

      const pdfBase64 = canvasToPdfBase64(canvas, {
        filename: pdfFilename(currentDocument),
        landscape: shouldUseLandscapePdf(root, canvas),
        jsPDF: pdfLibraries.jsPDF
      });

      vscode.postMessage({
        type: "exportPdf",
        filename: pdfFilename(currentDocument),
        pdfBase64
      });
      showToast("PDF ready");
    } catch (error) {
      document.querySelector(".pdf-export-root")?.remove();
      showToast("PDF export failed", { tone: "error" });
      vscode.postMessage({
        type: "error",
        message: `PDF export failed: ${error?.message || error}`
      });
    } finally {
      downloadPdf.disabled = false;
    }
  }

  function currentPdfRoot() {
    if (!dataGrid.hidden) return dataGrid;
    if (!sourceView.hidden) return sourceView;
    if (!preview.hidden) return preview;
    return null;
  }

  function loadPdfLibraries() {
    const existing = resolvePdfLibraries();
    if (existing) return Promise.resolve(existing);
    if (pdfLibraryPromise) return pdfLibraryPromise;

    pdfLibraryPromise = Promise.resolve()
      .then(() => loadScriptOnce(pdfAssets.html2canvas, () => typeof resolveHtml2Canvas() === "function", "html2canvas"))
      .then(() => loadScriptOnce(pdfAssets.jspdf, () => typeof resolveJsPdf() === "function", "jsPDF"))
      .then(() => {
        const libraries = resolvePdfLibraries();
        if (!libraries) throw new Error("PDF globals are missing after script load");
        return libraries;
      })
      .catch((error) => {
        pdfLibraryPromise = null;
        throw error;
      });

    return pdfLibraryPromise;
  }

  function resolvePdfAssetUrls() {
    const injected = window.__MD_VIEWER_ASSETS__ || {};
    const fallback = fallbackPdfAssetUrls();
    return {
      html2canvas: injected.html2canvas || fallback.html2canvas || "",
      jspdf: injected.jspdf || fallback.jspdf || ""
    };
  }

  function fallbackPdfAssetUrls() {
    if (!viewerScriptSrc) return {};
    try {
      return {
        html2canvas: new URL("vendor/pdf/html2canvas.min.js", viewerScriptSrc).toString(),
        jspdf: new URL("vendor/pdf/jspdf.umd.min.js", viewerScriptSrc).toString()
      };
    } catch (error) {
      return {};
    }
  }

  function loadScriptOnce(src, isReady, label) {
    if (isReady()) return Promise.resolve();
    if (!src) return Promise.reject(new Error(`${label} URL is missing`));

    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-mdviewer-pdf="${label}"]`);
      if (existing) {
        existing.addEventListener("load", () => isReady() ? resolve() : reject(new Error(`${label} did not expose its API`)), { once: true });
        existing.addEventListener("error", () => reject(new Error(`${label} script failed to load`)), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.dataset.mdviewerPdf = label;
      script.src = src;
      if (scriptNonce) script.nonce = scriptNonce;
      script.onload = () => {
        window.setTimeout(() => {
          if (isReady()) {
            resolve();
          } else {
            reject(new Error(`${label} loaded but did not expose its API`));
          }
        }, 0);
      };
      script.onerror = () => reject(new Error(`${label} script failed to load from ${src}`));
      document.head.appendChild(script);
    });
  }

  function resolvePdfLibraries() {
    const html2canvas = resolveHtml2Canvas();
    const jsPDF = resolveJsPdf();
    if (typeof html2canvas !== "function" || typeof jsPDF !== "function") return null;
    return { html2canvas, jsPDF };
  }

  function resolveHtml2Canvas() {
    return window.html2canvas || window.HTML2Canvas;
  }

  function resolveJsPdf() {
    return window.jspdf?.jsPDF || window.jsPDF;
  }

  function createPdfExportSurface(root) {
    const computed = window.getComputedStyle(root);
    const background = effectiveBackgroundColor(root);
    const width = Math.max(Math.ceil(root.scrollWidth || root.getBoundingClientRect().width), 320);
    const clone = root.cloneNode(true);

    clone.hidden = false;
    clone.removeAttribute("hidden");
    clone.querySelectorAll([
      ".table-toolbar",
      ".code-toolbar",
      ".grid-chrome",
      ".grid-context-menu",
      ".help-modal",
      ".heading-actions",
      ".heading-action-button",
      ".markdown-toc",
      ".find-bar",
      "button",
      "input",
      "textarea",
      "select",
      "[hidden]"
    ].join(",")).forEach((element) => element.remove());
    unwrapFindHighlights(clone);

    clone.querySelectorAll(".table-scroll, .grid-scroll, .source-view pre").forEach((element) => {
      element.style.height = "auto";
      element.style.maxHeight = "none";
      element.style.overflow = "visible";
    });

    const container = document.createElement("div");
    container.className = "pdf-export-root";
    container.style.position = "fixed";
    container.style.left = "-100000px";
    container.style.top = "0";
    container.style.width = `${width}px`;
    container.style.minHeight = "1px";
    container.style.background = background;
    container.style.color = computed.color;
    container.style.padding = "0";
    container.style.zIndex = "-1";
    container.appendChild(clone);

    return { container, background };
  }

  function effectiveBackgroundColor(element) {
    let current = element;
    while (current && current !== document.documentElement) {
      const color = window.getComputedStyle(current).backgroundColor;
      if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
        return color;
      }
      current = current.parentElement;
    }
    return window.getComputedStyle(document.body).backgroundColor || "#ffffff";
  }

  function shouldUseLandscapePdf(root, canvas) {
    if (currentDocument.kind === "csv" || currentDocument.kind === "tsv") return true;
    return canvas.width > canvas.height && root.scrollWidth > root.clientWidth;
  }

  function canvasToPdfBase64(canvas, options = {}) {
    const pdf = new options.jsPDF({
      orientation: options.landscape ? "landscape" : "portrait",
      unit: "pt",
      format: "a4",
      compress: true
    });

    pdf.setProperties({
      title: options.filename || currentDocument.filename || "Document",
      creator: "MD Viewer"
    });

    const margin = 24;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - margin * 2;
    const pixelsPerPoint = canvas.width / contentWidth;
    const pageCanvasHeight = Math.max(1, Math.floor(contentHeight * pixelsPerPoint));
    let offsetY = 0;
    let pageIndex = 0;

    while (offsetY < canvas.height) {
      const sliceHeight = Math.min(pageCanvasHeight, canvas.height - offsetY);
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;

      const context = pageCanvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      context.drawImage(canvas, 0, offsetY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

      if (pageIndex > 0) pdf.addPage();
      const imgData = pageCanvas.toDataURL("image/jpeg", 0.95);
      const renderedHeight = sliceHeight / pixelsPerPoint;
      pdf.addImage(imgData, "JPEG", margin, margin, contentWidth, renderedHeight, undefined, "FAST");

      offsetY += sliceHeight;
      pageIndex += 1;
    }

    return pdf.output("datauristring").split(",")[1] || "";
  }

  function documentFilename(documentInfo) {
    const extension = extensionForKind(documentInfo.kind);
    const base = safeFilename(documentInfo.filename || `document.${extension}`);
    return ensureExtension(base, extension, documentInfo.kind);
  }

  function pdfFilename(documentInfo) {
    return documentFilename(documentInfo).replace(/\.[^.]+$/, "") + ".pdf";
  }

  function safeFilename(value) {
    return String(value || "document")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || "document";
  }

  function ensureExtension(filename, extension, kind) {
    if (kind === "markdown" && /\.(md|markdown|mdown|mkd)$/i.test(filename)) return filename;
    return new RegExp(`\\.${extension}$`, "i").test(filename) ? filename : `${filename}.${extension}`;
  }

  function extensionForKind(kind) {
    if (kind === "csv") return "csv";
    if (kind === "tsv") return "tsv";
    return "md";
  }

  function openHelp() {
    const overlay = document.createElement("div");
    overlay.className = "help-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    overlay.innerHTML = `
      <div class="help-panel">
        <header class="help-header">
          <h2>MD/CSV/TSV Viewer Help</h2>
          <button type="button" data-close-help>Close</button>
        </header>
        <div class="help-body">
          <h3>Open and edit</h3>
          <p>Supported files open in viewer mode. Press E or the Edit button to switch to VS Code text editing. Use the Open in MD Viewer editor title button or Command/Ctrl+Alt+V to return to viewer mode.</p>
          <h3>Markdown</h3>
          <p>Markdown supports tables with saved V-key cell/range/column selection for all tables, code block copy, Mermaid diagrams, heading section copy/select, TOC, source toggle, PDF export, dark mode, and full-width mode.</p>
          <h3>Tables</h3>
          <p>CSV and TSV files open as an interactive grid with sorting, filters, range selection, copy, download, and numeric parsing controls.</p>
          <h3>Shortcuts</h3>
          <p>E opens the text editor. Command/Ctrl+Alt+V returns to viewer mode from edit mode. Command/Ctrl+F opens find. Control+B hides or shows the toolbar. F toggles full width. T toggles TOC. S toggles source. [space] opens the hovered Markdown table as Grid. W toggles wrap. V toggles saved Markdown table selection for all tables. U toggles Auto/VN/US number parsing. H toggles first row as header. D saves a copy. P exports PDF. C copies rendered content. Shift+C copies source. Command/Ctrl+A selects viewer/table content.</p>
        </div>
      </div>
    `;

    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") close();
    }

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close-help]")) close();
    });
    document.addEventListener("keydown", onKeyDown);
    document.body.appendChild(overlay);
    overlay.querySelector("[data-close-help]")?.focus();
  }

  function showToast(message, options = {}) {
    const container = getToastContainer();
    const toast = document.createElement("div");
    toast.className = `toast-message${options.tone ? ` is-${options.tone}` : ""}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add("is-visible");
    });

    window.setTimeout(() => {
      toast.classList.remove("is-visible");
      toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, options.duration || 1800);
  }

  function getToastContainer() {
    let container = document.querySelector(".toast-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "toast-container";
      document.body.appendChild(container);
    }
    return container;
  }
})();
