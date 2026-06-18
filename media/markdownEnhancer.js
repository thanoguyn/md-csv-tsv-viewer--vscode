(function () {
  let mermaidCounter = 0;
  let mermaidReady = false;
  let cleanupTocScroll = null;
  const tocStorageKey = "md-viewer-toc-visible";

  function enhance(root, options = {}) {
    decorateHeadingCopyButtons(root, options);
    decorateCodeBlocks(root);
    renderTableOfContents(root, options);
    renderMermaidBlocks(root);
  }

  function decorateHeadingCopyButtons(root, options = {}) {
    const headings = Array.from(root.children).filter(isHeadingElement);
    const sections = markdownHeadingSections(options.sourceText);

    headings.forEach((heading, index) => {
      if (heading.dataset.headingCopyReady) return;
      heading.dataset.headingCopyReady = "true";

      const actions = document.createElement("span");
      actions.className = "heading-actions";

      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className = "heading-action-button heading-select-button";
      selectButton.title = "Select section";
      selectButton.setAttribute("aria-label", "Select section");
      selectButton.innerHTML = selectIconSvg();
      selectButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectHeadingSection(selectButton, heading);
      });

      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "heading-action-button heading-copy-button";
      copyButton.title = "Copy section. Shift-click to append";
      copyButton.setAttribute("aria-label", "Copy section. Shift-click to append");
      copyButton.innerHTML = copyIconSvg();
      copyButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        copyHeadingSection(copyButton, sections[index] ?? headingSectionText(heading), { append: event.shiftKey });
      });

      actions.append(selectButton, copyButton);
      heading.appendChild(actions);
    });
  }

  function selectHeadingSection(button, heading) {
    const section = headingSectionElements(heading);
    if (!section.length) {
      showToast("Nothing to select", { tone: "warning" });
      return;
    }

    const range = heading.ownerDocument.createRange();
    range.setStartBefore(section[0]);
    range.setEndAfter(section[section.length - 1]);

    const selection = heading.ownerDocument.defaultView.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    button.classList.add("is-selected");
    showToast("Selected section");

    window.setTimeout(() => {
      button.classList.remove("is-selected");
    }, 1200);
  }

  async function copyHeadingSection(button, markdown, options = {}) {
    const originalTitle = button.title;
    const originalLabel = button.getAttribute("aria-label");
    button.disabled = true;

    try {
      await copyText(markdown, options);
      button.classList.add("is-copied");
      button.title = options.append ? "Appended section" : "Copied section";
      button.setAttribute("aria-label", options.append ? "Appended section" : "Copied section");
      showToast(options.append ? "Appended section" : "Copied section");
    } catch (error) {
      button.classList.add("is-failed");
      button.title = "Copy failed";
      button.setAttribute("aria-label", "Copy failed");
    }

    window.setTimeout(() => {
      button.disabled = false;
      button.classList.remove("is-copied", "is-failed");
      button.title = originalTitle;
      button.setAttribute("aria-label", originalLabel || "Copy section");
    }, 1200);
  }

  function markdownHeadingSections(sourceText) {
    const lines = String(sourceText || "").replace(/\r\n?/g, "\n").split("\n");
    const headings = [];
    let fenced = false;

    lines.forEach((line, index) => {
      if (/^```/.test(line)) {
        fenced = !fenced;
        return;
      }
      if (fenced) return;

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (!heading) return;

      headings.push({
        line: index,
        level: heading[1].length
      });
    });

    return headings.map((heading, index) => {
      const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
      const endLine = next ? next.line : lines.length;
      return lines.slice(heading.line + 1, endLine).join("\n").trim();
    });
  }

  function headingSectionText(heading) {
    const fragment = document.createElement("div");
    const section = headingSectionElements(heading);
    section.forEach((sibling) => {
      fragment.appendChild(sibling.cloneNode(true));
    });

    removeViewerChrome(fragment);
    return fragment.innerText.trim();
  }

  function headingSectionElements(heading) {
    const level = headingLevel(heading);
    const section = [];
    let sibling = heading.nextElementSibling;

    while (sibling && !isClosingHeading(sibling, level)) {
      section.push(sibling);
      sibling = sibling.nextElementSibling;
    }

    return section;
  }

  function headingLevel(element) {
    const match = String(element?.tagName || "").match(/^H([1-6])$/i);
    return match ? Number(match[1]) : 0;
  }

  function isHeadingElement(element) {
    return headingLevel(element) > 0;
  }

  function isClosingHeading(element, currentLevel) {
    const nextLevel = headingLevel(element);
    return nextLevel > 0 && nextLevel <= currentLevel;
  }

  function removeViewerChrome(root) {
    root.querySelectorAll(".table-toolbar, .code-toolbar, .grid-chrome, .help-modal, .heading-actions, .heading-action-button").forEach((element) => element.remove());
    root.querySelectorAll("pre[hidden], [hidden]").forEach((element) => element.remove());
  }

  function renderTableOfContents(root, options = {}) {
    clearToc(root.ownerDocument);

    const headings = Array.from(root.children).filter(isHeadingElement);
    if (!headings.length) {
      setTocVisible(false, root.ownerDocument);
      return;
    }

    const document = root.ownerDocument;
    const nodes = tocNodes(headings);
    const toc = document.createElement("nav");
    toc.className = "markdown-toc";
    toc.setAttribute("aria-label", "Table of contents");

    const title = document.createElement("div");
    title.className = "markdown-toc-title";
    title.textContent = "TOC";

    const list = document.createElement("ol");
    list.className = "markdown-toc-list";
    appendTocItems(list, nodes.roots);

    toc.append(title, list);
    document.body.appendChild(toc);
    document.body.classList.add("has-markdown-toc");
    setTocVisible(tocEnabled(options), document);
    installTocScrollTracking(document, nodes.all, toc);
  }

  function clearToc(document = window.document) {
    cleanupTocScroll?.();
    cleanupTocScroll = null;
    document.querySelectorAll(".markdown-toc").forEach((toc) => toc.remove());
    document.body?.classList.remove("has-markdown-toc", "is-toc-visible");
  }

  function setTocVisible(visible, document = window.document) {
    document.body?.classList.toggle("is-toc-visible", Boolean(visible));
  }

  function tocEnabled(options = {}) {
    if (typeof options.tocEnabled === "boolean") return options.tocEnabled;

    try {
      return localStorage.getItem(tocStorageKey) === "true";
    } catch (error) {
      return false;
    }
  }

  function tocNodes(headings) {
    const roots = [];
    const all = [];
    const stack = [];

    headings.forEach((heading, index) => {
      if (!heading.id) heading.id = `md-viewer-heading-${index}`;

      const node = {
        heading,
        level: headingLevel(heading),
        depth: 1,
        parent: null,
        children: [],
        item: null,
        button: null
      };

      while (stack.length && stack[stack.length - 1].level >= node.level) {
        stack.pop();
      }

      const parent = stack[stack.length - 1] || null;
      if (parent) {
        node.parent = parent;
        node.depth = parent.depth + 1;
        parent.children.push(node);
      } else {
        roots.push(node);
      }

      stack.push(node);
      all.push(node);
    });

    return { roots, all };
  }

  function appendTocItems(list, nodes) {
    nodes
      .filter((node) => node.depth <= 3)
      .forEach((node) => {
        const document = node.heading.ownerDocument;
        const item = document.createElement("li");
        item.className = "markdown-toc-item";
        item.dataset.depth = String(node.depth);

        const button = document.createElement("button");
        button.type = "button";
        button.className = "markdown-toc-link";
        button.textContent = headingText(node.heading);
        button.addEventListener("click", () => {
          node.heading.scrollIntoView({ behavior: "smooth", block: "start" });
          updateTocActiveNode(node);
          try {
            window.history.replaceState(null, "", `#${node.heading.id}`);
          } catch (error) {
            // Some embedded page contexts can block history updates.
          }
        });

        node.item = item;
        node.button = button;
        item.appendChild(button);

        const visibleChildren = node.children.filter((child) => child.depth <= 3);
        if (visibleChildren.length) {
          const childList = document.createElement("ol");
          childList.className = "markdown-toc-children";
          appendTocItems(childList, visibleChildren);
          item.appendChild(childList);
        }

        list.appendChild(item);
      });
  }

  function installTocScrollTracking(document, nodes, toc) {
    const view = document.defaultView || window;
    let frame = 0;

    const scheduleUpdate = () => {
      if (frame) return;
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        updateTocForScroll(nodes, toc);
      });
    };

    view.addEventListener("scroll", scheduleUpdate, { passive: true });
    view.addEventListener("resize", scheduleUpdate);
    cleanupTocScroll = () => {
      if (frame) view.cancelAnimationFrame(frame);
      view.removeEventListener("scroll", scheduleUpdate);
      view.removeEventListener("resize", scheduleUpdate);
    };

    scheduleUpdate();
  }

  function updateTocForScroll(nodes, toc) {
    const activeNode = currentTocNode(nodes);
    if (!activeNode) return;

    updateTocActiveNode(activeNode);

    const activeButton = nearestVisibleTocNode(activeNode)?.button;
    if (activeButton && activeNode.heading.ownerDocument.body.classList.contains("is-toc-visible")) {
      activeButton.scrollIntoView({ block: "nearest" });
    }
  }

  function currentTocNode(nodes) {
    const document = nodes[0]?.heading.ownerDocument || window.document;
    const offset = document.body.classList.contains("is-toolbar-hidden") ? 24 : 88;
    let active = nodes[0] || null;

    for (const node of nodes) {
      if (node.heading.getBoundingClientRect().top > offset) break;
      active = node;
    }

    return active;
  }

  function updateTocActiveNode(activeNode) {
    const root = activeNode.item?.closest(".markdown-toc") || nearestVisibleTocNode(activeNode)?.item?.closest(".markdown-toc");
    if (!root) return;

    root.querySelectorAll(".markdown-toc-item.is-active, .markdown-toc-item.is-expanded").forEach((item) => {
      item.classList.remove("is-active", "is-expanded");
    });

    const visibleNode = nearestVisibleTocNode(activeNode);
    visibleNode?.item?.classList.add("is-active");

    let node = visibleNode;
    while (node) {
      node.item?.classList.add("is-expanded");
      node = node.parent;
    }
  }

  function nearestVisibleTocNode(node) {
    let current = node;
    while (current && !current.item) {
      current = current.parent;
    }
    return current;
  }

  function headingText(heading) {
    const clone = heading.cloneNode(true);
    clone.querySelectorAll(".heading-actions, .heading-action-button").forEach((element) => element.remove());
    return clone.textContent.trim() || "Untitled";
  }

  function headingIndex(heading) {
    return Array.from(heading.parentNode?.children || []).filter(isHeadingElement).indexOf(heading);
  }

  function copyIconSvg() {
    return `
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <rect x="9" y="9" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
        <path d="M5 15V7a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      </svg>
    `;
  }

  function selectIconSvg() {
    return `
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"></rect>
        <path d="M9 12h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      </svg>
    `;
  }

  function decorateCodeBlocks(root) {
    const blocks = Array.from(root.querySelectorAll("pre:not([data-code-ready])"));
    const wrapEnabled = getWrapState();

    blocks.forEach((pre) => {
      const code = pre.querySelector("code");
      if (!code) return;

      pre.dataset.codeReady = "true";

      if (isMermaidCode(code)) {
        pre.dataset.mermaidSource = code.textContent;
        pre.classList.add("mermaid-source");
        return;
      }

      const shell = document.createElement("div");
      shell.className = "code-viewer";
      shell.classList.toggle("is-wrapped", wrapEnabled);

      const toolbar = document.createElement("div");
      toolbar.className = "code-toolbar";

      const label = document.createElement("span");
      label.textContent = languageLabel(code);

      const controls = document.createElement("div");
      controls.className = "code-controls";

      const wrapLabel = document.createElement("label");
      wrapLabel.className = "switch-control";
      wrapLabel.title = "Toggle code word wrap";

      const wrapInput = document.createElement("input");
      wrapInput.type = "checkbox";
      wrapInput.className = "wrap-toggle-input";
      wrapInput.checked = wrapEnabled;
      wrapInput.addEventListener("change", () => {
        window.MDViewerTabular?.setWrapEnabled?.(wrapInput.checked, document);
      });

      const wrapText = document.createElement("span");
      wrapText.textContent = "Wrap";
      wrapLabel.append(wrapInput, wrapText);

      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "copy-code-button";
      copyButton.textContent = "Copy";
      copyButton.title = "Copy code block";
      copyButton.addEventListener("click", (event) => copyFromButton(copyButton, code.textContent, { append: event.shiftKey }));

      const scroller = document.createElement("div");
      scroller.className = "code-scroll";

      pre.parentNode.insertBefore(shell, pre);
      shell.append(toolbar, scroller);
      controls.append(wrapLabel, copyButton);
      toolbar.append(label, controls);
      scroller.appendChild(pre);
    });
  }

  async function renderMermaidBlocks(root) {
    const blocks = Array.from(root.querySelectorAll("pre.mermaid-source:not([data-mermaid-ready])"));
    if (!blocks.length) return;

    initializeMermaid();

    for (const pre of blocks) {
      pre.dataset.mermaidReady = "true";
      await renderMermaidBlock(pre);
    }
  }

  async function renderMermaidBlock(pre) {
    const source = pre.dataset.mermaidSource || "";
    const shell = document.createElement("div");
    shell.className = "mermaid-viewer";
    shell.classList.toggle("is-wrapped", getWrapState());

    const toolbar = document.createElement("div");
    toolbar.className = "code-toolbar";

    const label = document.createElement("span");
    label.textContent = "Mermaid";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "copy-code-button";
    copyButton.textContent = "Copy";
    copyButton.title = "Copy Mermaid source";
    copyButton.addEventListener("click", (event) => copyFromButton(copyButton, source, { append: event.shiftKey }));

    const diagram = document.createElement("div");
    diagram.className = "mermaid-diagram";

    shell.append(toolbar, diagram);
    toolbar.append(label, copyButton);
    pre.parentNode.insertBefore(shell, pre);
    pre.hidden = true;

    if (!window.mermaid?.render) {
      diagram.textContent = "Mermaid runtime is unavailable.";
      shell.appendChild(pre);
      return;
    }

    try {
      const id = `md-viewer-mermaid-${Date.now()}-${mermaidCounter++}`;
      const result = await window.mermaid.render(id, source);
      diagram.innerHTML = result.svg;
      result.bindFunctions?.(diagram);
    } catch (error) {
      diagram.classList.add("mermaid-error");
      diagram.textContent = error.message || "Unable to render Mermaid diagram.";
      pre.hidden = false;
      shell.appendChild(pre);
    }
  }

  function initializeMermaid() {
    if (mermaidReady || !window.mermaid?.initialize) return;

    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default"
    });
    mermaidReady = true;
  }

  function isMermaidCode(code) {
    return /\blanguage-mermaid\b/i.test(code.className || "");
  }

  function languageLabel(code) {
    const match = String(code.className || "").match(/\blanguage-([\w-]+)/i);
    return match ? match[1] : "Code";
  }

  function getWrapState() {
    try {
      return localStorage.getItem("md-viewer-table-wrap") === "true";
    } catch (error) {
      return false;
    }
  }

  async function copyFromButton(button, text, options = {}) {
    const originalText = button.textContent;
    button.disabled = true;

    try {
      await copyText(text, options);
      button.textContent = options.append ? "Appended" : "Copied";
    } catch (error) {
      button.textContent = "Failed";
    }

    window.setTimeout(() => {
      button.disabled = false;
      button.textContent = originalText;
    }, 1200);
  }

  async function copyText(text, options = {}) {
    const output = copyOutputText(text, options);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(output);
      rememberCopiedText(output);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = output;
    textarea.style.position = "fixed";
    textarea.style.inset = "0 auto auto 0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    rememberCopiedText(output);
  }

  function copyOutputText(text, options = {}) {
    const nextText = String(text ?? "");
    if (!options.append) return nextText;

    const currentText = rememberedCopiedText();
    if (!currentText) return nextText;
    return `${currentText}${currentText.endsWith("\n") ? "" : "\n"}${nextText}`;
  }

  function rememberedCopiedText() {
    return String(window.__mdViewerLastCopiedText ?? "");
  }

  function rememberCopiedText(text) {
    window.__mdViewerLastCopiedText = String(text ?? "");
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

  window.MDViewerMarkdownEnhancer = {
    enhance,
    clearToc,
    setTocVisible
  };
})();
