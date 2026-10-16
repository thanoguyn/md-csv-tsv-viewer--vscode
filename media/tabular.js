(function () {
  const wrapStorageKey = "md-viewer-table-wrap";
  const filterRowStorageKey = "md-viewer-filter-row-visible";
  const filterModeStorageKey = "md-viewer-filter-mode";
  const numberFormatStorageKey = "md-viewer-number-format";
  const markdownTableSelectionStorageKey = "md-viewer-markdown-table-selection-mode";
  const gridSelectionClass = "is-selected";
  const markdownTableSelectionModeClass = "is-table-selection-mode";
  const defaultColumnWidth = 160;
  const minColumnWidth = 144;
  const maxFitColumnWidth = 420;
  const maxLayoutColumnWidth = 640;
  const rowHeaderWidth = 48;
  const virtualCellThreshold = 20000;
  const virtualRowHeight = 36;
  const virtualRowOverscan = 24;
  let activeGrid = null;
  let activeMarkdownTable = null;
  let hoveredMarkdownTable = null;
  let openGridModal = null;
  let gridContextMenu = null;
  let activeResize = null;
  let filterTimer = null;
  document.addEventListener("keydown", handleGridCopyShortcut);
  document.addEventListener("keydown", handleGridContextMenuKeyDown);
  document.addEventListener("paste", handleGridPaste);
  document.addEventListener("click", hideGridContextMenu);
  document.addEventListener("scroll", hideGridContextMenu, true);
  document.addEventListener("mousemove", handleColumnResizeMove);
  document.addEventListener("mouseup", handleColumnResizeEnd);
  document.addEventListener("mouseup", handleMarkdownTableMouseUp);

  function detectKind(source, contentType) {
    const normalizedSource = String(source || "").toLowerCase().split(/[?#]/)[0];
    const normalizedType = String(contentType || "").toLowerCase();

    if (normalizedSource.endsWith(".csv") || normalizedType.includes("text/csv")) return "csv";
    if (normalizedSource.endsWith(".tsv") || normalizedType.includes("text/tab-separated-values")) return "tsv";
    if (/\.(jsonl|ndjson)$/.test(normalizedSource) || normalizedType.includes("jsonl") || normalizedType.includes("ndjson")) return "jsonl";
    if (/\.(md|markdown|mdown|mkd)$/.test(normalizedSource) || normalizedType.includes("text/markdown")) return "markdown";
    return "markdown";
  }

  function parseDelimited(input, delimiter) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const text = String(input || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];

      if (char === '"') {
        if (quoted && next === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
        continue;
      }

      if (char === delimiter && !quoted) {
        row.push(field);
        field = "";
        continue;
      }

      if (char === "\n" && !quoted) {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        continue;
      }

      field += char;
    }

    row.push(field);
    rows.push(row);

    return rows.filter((items, rowIndex) => {
      if (rowIndex < rows.length - 1) return true;
      return items.some((item) => item.trim() !== "");
    });
  }

  function decorateTables(root) {
    const tables = Array.from(root.querySelectorAll("table:not([data-copy-ready])"));
    const wrapEnabled = getWrapState();
    const selectionModeEnabled = getMarkdownTableSelectionState();

    tables.forEach((table) => {
      table.dataset.copyReady = "true";
      table.classList.toggle("is-wrapped", wrapEnabled);
      indexMarkdownTableCells(table);

      const shell = document.createElement("div");
      shell.className = "table-viewer";
      shell.classList.toggle("is-wrapped", wrapEnabled);

      const toolbar = document.createElement("div");
      toolbar.className = "table-toolbar";

      const label = document.createElement("span");
      label.textContent = tableLabel(table);

      const controls = document.createElement("div");
      controls.className = "table-controls";

      const wrapButton = document.createElement("button");
      wrapButton.type = "button";
      wrapButton.className = "wrap-toggle-input";
      setTableIconButton(wrapButton, "wrap", "Wrap table text", "W");
      wrapButton.setAttribute("aria-pressed", String(wrapEnabled));
      wrapButton.addEventListener("click", () => {
        setWrapEnabled(!getWrapState(), document);
      });

      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className = "table-selection-toggle-input";
      setTableIconButton(selectButton, "selection", "Select table cells", "V");

      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "copy-table-button";
      setIconButton(copyButton, "All", "copy");
      copyButton.addEventListener("click", (event) => copyFromButton(copyButton, tableToDelimited(table), { append: event.shiftKey }));

      const copyBodyButton = document.createElement("button");
      copyBodyButton.type = "button";
      copyBodyButton.className = "copy-table-button";
      setIconButton(copyBodyButton, "Body", "copy");
      copyBodyButton.addEventListener("click", (event) => copyFromButton(copyBodyButton, tableToDelimited(table, { includeHeader: false }), { append: event.shiftKey }));

      const csvButton = document.createElement("button");
      csvButton.type = "button";
      csvButton.className = "copy-table-button";
      setIconButton(csvButton, "CSV", "download");
      csvButton.addEventListener("click", () => downloadRows(tableToRows(table), "csv"));

      const tsvButton = document.createElement("button");
      tsvButton.type = "button";
      tsvButton.className = "copy-table-button";
      setIconButton(tsvButton, "TSV", "download");
      tsvButton.addEventListener("click", () => downloadRows(tableToRows(table), "tsv"));

      const gridButton = document.createElement("button");
      gridButton.type = "button";
      gridButton.className = "copy-table-button";
      setTableIconButton(gridButton, "grid", "Open editable grid", "Space");
      gridButton.addEventListener("click", () => openTableGrid(table));

      const scroller = document.createElement("div");
      scroller.className = "table-scroll";

      table.addEventListener("mousedown", handleMarkdownTableMouseDown);
      table.addEventListener("mouseover", handleMarkdownTableMouseOver);
      table.addEventListener("contextmenu", handleMarkdownTableContextMenu);
      table.addEventListener("dblclick", (event) => {
        const cell = event.target.closest("th, td");
        if (!cell || !table.contains(cell)) return;
        event.preventDefault();
        openTableGrid(table, {
          editColumn: Number(cell.dataset.mdColumn),
          editRow: Number(cell.dataset.mdRow)
        });
      });
      table.addEventListener("mouseenter", () => {
        window.__mdViewerFocusSurface?.();
        hoveredMarkdownTable = table;
      });
      table.addEventListener("mouseleave", () => {
        if (hoveredMarkdownTable === table) hoveredMarkdownTable = null;
      });
      const selection = markdownTableSelection(table);
      selection.shell = shell;
      selection.toggleInput = selectButton;
      selectButton.addEventListener("click", () => {
        setMarkdownTableSelectionEnabled(!getMarkdownTableSelectionState(), document, table);
      });
      setMarkdownTableSelectionMode(table, selectionModeEnabled);

      table.parentNode.insertBefore(shell, table);
      shell.append(toolbar, scroller);
      toolbar.append(label, controls);
      controls.append(wrapButton, selectButton, gridButton, copyButton, copyBodyButton, csvButton, tsvButton);
      scroller.appendChild(table);
    });
  }

  function renderDataGrid(container, input, kind, options = {}) {
    const delimiter = kind === "tsv" ? "\t" : ",";
    const rawRows = parseDelimited(input, delimiter);
    renderDataGridRows(container, rawRows, { editable: options.editable !== false, kind });
  }

  function renderDataGridRows(container, rawRows, options = {}) {
    const previousScroller = container.querySelector(".grid-scroll");
    const previousScrollTop = previousScroller?.scrollTop || 0;
    const previousScrollLeft = previousScroller?.scrollLeft || 0;
    const sourceRows = normalizeRows(rawRows);
    const numberFormat = getNumberFormat();
    const headerEnabled = true;
    const model = gridModelFromSourceRows(sourceRows, headerEnabled, numberFormat);
    activeGrid = {
      columnMeta: model.columnMeta,
      columns: model.columns,
      container,
      editable: Boolean(options.editable),
      filterDrafts: {},
      filterMode: getFilterMode(),
      filterRowVisible: getFilterRowVisible(),
      filters: {},
      headerEnabled,
      kind: options.kind || null,
      markdownSourceEnd: options.markdownSourceEnd,
      markdownSourceStart: options.markdownSourceStart,
      numberFormat,
      rows: model.rows,
      selection: { ranges: [], activeIndex: -1, dragging: false, anchor: null },
      sourceRows,
      sorts: []
    };
    activeGrid.columnWidths = model.columns.map((_, index) => initialColumnWidth(model.widthRows, index, {
      columnMeta: model.columnMeta[index],
      numberFormat
    }));

    container.innerHTML = "";
    container.classList.toggle("is-wrapped", getWrapState());

    if (!activeGrid.columns.length) {
      container.innerHTML = '<div class="grid-empty">No rows found.</div>';
      return;
    }

    const chrome = document.createElement("div");
    chrome.className = "grid-chrome";

    const summary = document.createElement("div");
    summary.className = "grid-summary";

    const actions = document.createElement("div");
    actions.className = "grid-actions";

    const wrapButton = document.createElement("button");
    wrapButton.type = "button";
    wrapButton.className = "wrap-toggle-input";
    setTableIconButton(wrapButton, "wrap", "Wrap cell text", "W");
    wrapButton.setAttribute("aria-pressed", String(getWrapState()));
    wrapButton.disabled = shouldVirtualizeGrid(activeGrid.rows.length, activeGrid.columns.length);
    if (wrapButton.disabled) wrapButton.title = "Wrapping is disabled for virtualized large tables.";
    wrapButton.addEventListener("click", () => {
      const enabled = !getWrapState();
      setWrapState(enabled);
      wrapButton.setAttribute("aria-pressed", String(enabled));
      container.classList.toggle("is-wrapped", enabled);
    });

    const filterModeButton = document.createElement("button");
    filterModeButton.type = "button";
    setTableIconButton(filterModeButton, "filter-live", "Filter while typing", "—");
    filterModeButton.setAttribute("aria-pressed", String(activeGrid.filterMode === "type"));
    filterModeButton.addEventListener("click", () => {
      const enabled = activeGrid.filterMode !== "type";
      activeGrid.filterMode = enabled ? "type" : "change";
      setFilterMode(activeGrid.filterMode);
      filterModeButton.setAttribute("aria-pressed", String(enabled));
    });

    const numberFormatButton = document.createElement("button");
    numberFormatButton.type = "button";
    numberFormatButton.className = "number-format-toggle";
    updateNumberFormatButton(numberFormatButton, activeGrid.numberFormat);
    numberFormatButton.addEventListener("click", () => {
      updateNumberFormatButton(numberFormatButton, toggleNumberFormat(container));
    });

    const headerButton = document.createElement("button");
    headerButton.type = "button";
    headerButton.className = "header-row-toggle";
    updateHeaderButton(headerButton);
    headerButton.disabled = activeGrid.kind === "markdown-table" || activeGrid.kind === "jsonl";
    headerButton.addEventListener("click", () => {
      updateHeaderButton(headerButton, toggleHeaderRow(container));
    });

    const fitButton = document.createElement("button");
    fitButton.type = "button";
    setTableIconButton(fitButton, "fit", "Fit columns to content", "—");
    fitButton.addEventListener("click", () => fitColumnsToContent(container));

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    setIconButton(copyButton, "Selection", "copy");
    copyButton.addEventListener("click", (event) => {
      const text = hasSelection() ? selectedGridText(container) : visibleGridText(container);
      copyFromButton(copyButton, text, { append: event.shiftKey });
    });

    const copyAllButton = document.createElement("button");
    copyAllButton.type = "button";
    setIconButton(copyAllButton, "All", "copy");
    copyAllButton.addEventListener("click", (event) => copyFromButton(copyAllButton, gridText({ includeHeader: true }), { append: event.shiftKey }));

    const copyBodyButton = document.createElement("button");
    copyBodyButton.type = "button";
    setIconButton(copyBodyButton, "Body", "copy");
    copyBodyButton.addEventListener("click", (event) => copyFromButton(copyBodyButton, gridText({ includeHeader: false }), { append: event.shiftKey }));

    const downloadCsvButton = document.createElement("button");
    downloadCsvButton.type = "button";
    setIconButton(downloadCsvButton, "CSV", "download");
    downloadCsvButton.addEventListener("click", () => downloadRows(gridRows({ includeHeader: true }), "csv"));

    const downloadTsvButton = document.createElement("button");
    downloadTsvButton.type = "button";
    setIconButton(downloadTsvButton, "TSV", "download");
    downloadTsvButton.addEventListener("click", () => downloadRows(gridRows({ includeHeader: true }), "tsv"));

    actions.append(wrapButton, filterModeButton, numberFormatButton, headerButton, fitButton, copyButton, copyAllButton, copyBodyButton, downloadCsvButton, downloadTsvButton);
    chrome.append(summary, actions);

    const scroller = document.createElement("div");
    scroller.className = "grid-scroll";
    scroller.addEventListener("scroll", () => scheduleVirtualGridRender(container), { passive: true });

    const table = document.createElement("table");
    table.className = "data-grid";
    table.addEventListener("mousedown", handleGridMouseDown);
    table.addEventListener("mouseover", handleGridMouseOver);
    table.addEventListener("dblclick", handleGridDoubleClick);
    table.addEventListener("contextmenu", handleGridContextMenu);
    document.addEventListener("mouseup", handleGridMouseUp);

    scroller.appendChild(table);
    container.append(chrome, scroller);
    renderGridTable(container);
    scroller.scrollTop = previousScrollTop;
    scroller.scrollLeft = previousScrollLeft;
    scheduleInitialColumnFit(container);
  }

  function clearActiveGrid() {
    hideGridContextMenu();
    activeGrid = null;
  }

  function clearMarkdownTableSelection() {
    document.querySelectorAll("table[data-copy-ready]").forEach((table) => {
      const selection = markdownTableSelection(table);
      selection.ranges = [];
      selection.activeIndex = -1;
      selection.dragging = false;
      selection.anchor = null;
      paintMarkdownTableSelection(table);
    });
    activeMarkdownTable = null;
    hoveredMarkdownTable = null;
  }

  function selectAllActiveGrid() {
    if (!activeGrid?.container) return false;

    const visibleRows = getVisibleRows();
    if (!visibleRows.length || !activeGrid.columns.length) return false;

    activeGrid.selection.ranges = [
      {
        anchorRow: 0,
        anchorColumn: 0,
        focusRow: visibleRows.length - 1,
        focusColumn: activeGrid.columns.length - 1
      }
    ];
    activeGrid.selection.activeIndex = 0;
    activeGrid.selection.dragging = false;
    activeGrid.selection.anchor = { row: 0, column: 0 };
    paintSelection(activeGrid.container);
    return true;
  }

  function selectAllActiveMarkdownTable() {
    if (!activeMarkdownTable) return false;

    const selection = markdownTableSelection(activeMarkdownTable);
    if (!selection.enabled) return false;

    const dimensions = markdownTableDimensions(activeMarkdownTable);
    if (!dimensions.rows || !dimensions.columns) return false;

    selection.ranges = [
      {
        anchorRow: 0,
        anchorColumn: 0,
        focusRow: dimensions.rows - 1,
        focusColumn: dimensions.columns - 1
      }
    ];
    selection.activeIndex = 0;
    selection.dragging = false;
    selection.anchor = { row: 0, column: 0 };
    paintMarkdownTableSelection(activeMarkdownTable);
    return true;
  }

  function toggleMarkdownTableSelection(target) {
    const tables = Array.from(document.querySelectorAll("table[data-copy-ready]"));
    if (!tables.length) return null;

    const targetTable = target?.closest?.("table[data-copy-ready]") || hoveredMarkdownTable || activeMarkdownTable || tables[0];
    const nextEnabled = !getMarkdownTableSelectionState();
    setMarkdownTableSelectionEnabled(nextEnabled, document, targetTable);
    return nextEnabled;
  }

  function openHoveredMarkdownTableGrid(target) {
    if (document.body.classList.contains("has-grid-modal")) return false;

    const targetTable = target?.closest?.("table[data-copy-ready]") || hoveredMarkdownTable;
    if (!targetTable) return false;

    openTableGrid(targetTable);
    return true;
  }

  function getActiveGridText(options = {}) {
    if (!activeGrid) return "";
    return options.selectionOnly && hasSelection()
      ? selectedGridText(activeGrid.container)
      : gridText({ includeHeader: options.includeHeader !== false });
  }

  function toggleWrap(root = document) {
    const nextState = !getWrapState();
    setWrapEnabled(nextState, root);
    return nextState;
  }

  function openTableGrid(table, options = {}) {
    if (openGridModal) return;
    const previousGrid = activeGrid;
    const overlay = document.createElement("div");
    overlay.className = "grid-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const header = document.createElement("div");
    header.className = "grid-modal-header";

    const title = document.createElement("div");
    title.className = "grid-modal-title";
    const markdownSourceStart = Number(table.dataset.mdSourceStart);
    const markdownSourceEnd = Number(table.dataset.mdSourceEnd);
    const editable = Number.isFinite(markdownSourceStart) &&
      Number.isFinite(markdownSourceEnd) &&
      typeof window.__mdViewerMarkdownTableEdit === "function" &&
      window.__mdViewerCanEditDocument?.() !== false;
    title.textContent = editable ? "Markdown table · Editable" : "Markdown table";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Close";

    const gridHost = document.createElement("section");
    gridHost.className = "data-grid-view grid-modal-body";

    const modalState = {
      close,
      gridHost,
      markdownSourceStart,
      modalGrid: null,
      overlay,
      previousGrid,
      tableIndex: Array.from(document.querySelectorAll("table[data-md-source-start]")).indexOf(table),
      title
    };

    function close(options = {}) {
      if (openGridModal !== modalState) return;
      overlay.remove();
      activeGrid = previousGrid;
      openGridModal = null;
      document.body.classList.remove("has-grid-modal");
      document.removeEventListener("keydown", handleEscape);
      if (options.refresh !== false && modalState.modalGrid?.changed) window.__mdViewerRefreshDocument?.();
    }

    function handleEscape(event) {
      if (event.key === "Escape") close();
    }

    closeButton.addEventListener("click", close);
    document.addEventListener("keydown", handleEscape);
    header.append(title, closeButton);
    overlay.append(header, gridHost);
    document.body.classList.add("has-grid-modal");
    document.body.appendChild(overlay);
    openGridModal = modalState;
    renderDataGridRows(gridHost, tableToRows(table), {
      editable,
      kind: editable ? "markdown-table" : null,
      markdownSourceEnd,
      markdownSourceStart
    });
    modalState.modalGrid = activeGrid;
    if (editable && Number.isFinite(options.editRow) && Number.isFinite(options.editColumn)) {
      requestAnimationFrame(() => {
        if (options.editRow === 0) {
          const header = gridHost.querySelector(`th[data-grid-header="true"][data-column="${options.editColumn}"]`);
          if (header) beginHeaderEdit(header, options.editColumn);
        } else {
          const cell = gridHost.querySelector(`td[data-row="${options.editRow - 1}"][data-column="${options.editColumn}"]`);
          if (cell) beginCellEdit(cell);
        }
      });
    }
    closeButton.focus();
  }

  function hasOpenMarkdownTableGrid() {
    return Boolean(openGridModal?.overlay?.isConnected);
  }

  function refreshOpenMarkdownTableGrid(root) {
    const modalState = openGridModal;
    if (!modalState?.overlay?.isConnected) return false;

    const tables = Array.from(root.querySelectorAll("table[data-md-source-start]"));
    const table = tables.find((candidate) =>
      Number(candidate.dataset.mdSourceStart) === Number(modalState.markdownSourceStart)
    ) || tables[modalState.tableIndex];

    if (!table) {
      modalState.close({ refresh: false });
      return false;
    }

    const markdownSourceStart = Number(table.dataset.mdSourceStart);
    const markdownSourceEnd = Number(table.dataset.mdSourceEnd);
    const editable = Number.isFinite(markdownSourceStart) &&
      Number.isFinite(markdownSourceEnd) &&
      typeof window.__mdViewerMarkdownTableEdit === "function" &&
      window.__mdViewerCanEditDocument?.() !== false;

    renderDataGridRows(modalState.gridHost, tableToRows(table), {
      editable,
      kind: editable ? "markdown-table" : null,
      markdownSourceEnd,
      markdownSourceStart
    });
    modalState.markdownSourceStart = markdownSourceStart;
    modalState.modalGrid = activeGrid;
    modalState.title.textContent = editable ? "Markdown table · Editable" : "Markdown table";
    return true;
  }

  function renderGridTable(container) {
    const table = container.querySelector(".data-grid");
    const summary = container.querySelector(".grid-summary");
    const scroller = container.querySelector(".grid-scroll");
    const scrollTop = scroller?.scrollTop || 0;
    const scrollLeft = scroller?.scrollLeft || 0;
    const visibleRows = getVisibleRows();
    activeGrid.visibleRows = visibleRows;
    activeGrid.virtualized = shouldVirtualizeGrid(activeGrid.rows.length, activeGrid.columns.length);
    activeGrid.virtualStart = -1;
    activeGrid.virtualEnd = -1;

    table.innerHTML = "";
    table.appendChild(renderColGroup());
    table.append(renderGridHead(container), renderGridBodyWindow(visibleRows, scroller));
    table.classList.toggle("is-virtualized", activeGrid.virtualized);
    applyGridTableWidth(table);
    summary.textContent = `${visibleRows.length} of ${activeGrid.rows.length} rows x ${activeGrid.columns.length} columns${activeGrid.virtualized ? " · virtual rows" : ""}`;
    paintSelection(container);
    if (scroller) {
      scroller.scrollTop = scrollTop;
      scroller.scrollLeft = scrollLeft;
    }
  }

  function shouldVirtualizeGrid(rowCount, columnCount) {
    return rowCount * columnCount > virtualCellThreshold;
  }

  function scheduleVirtualGridRender(container) {
    if (!activeGrid?.virtualized || activeGrid.container !== container || activeGrid.virtualFrame) return;
    activeGrid.virtualFrame = requestAnimationFrame(() => {
      activeGrid.virtualFrame = null;
      renderVirtualGridWindow(container);
    });
  }

  function renderVirtualGridWindow(container) {
    if (!activeGrid?.virtualized || activeGrid.container !== container) return;
    const table = container.querySelector(".data-grid");
    const scroller = container.querySelector(".grid-scroll");
    const rows = activeGrid.visibleRows || getVisibleRows();
    const range = virtualGridRange(rows.length, scroller);
    if (range.start === activeGrid.virtualStart && range.end === activeGrid.virtualEnd) return;
    table.querySelector("tbody")?.replaceWith(renderGridBody(rows, range.start, range.end));
    activeGrid.virtualStart = range.start;
    activeGrid.virtualEnd = range.end;
    paintSelection(container);
  }

  function renderGridBodyWindow(rows, scroller) {
    if (!activeGrid.virtualized) return renderGridBody(rows, 0, rows.length);
    const range = virtualGridRange(rows.length, scroller);
    activeGrid.virtualStart = range.start;
    activeGrid.virtualEnd = range.end;
    return renderGridBody(rows, range.start, range.end);
  }

  function virtualGridRange(rowCount, scroller) {
    if (!activeGrid?.virtualized) return { start: 0, end: rowCount };
    const viewportRows = Math.ceil((scroller?.clientHeight || 600) / virtualRowHeight);
    const first = Math.max(0, Math.floor((scroller?.scrollTop || 0) / virtualRowHeight));
    const start = Math.min(Math.max(0, first - virtualRowOverscan), Math.max(0, rowCount - 1));
    return {
      start,
      end: Math.min(rowCount, first + viewportRows + virtualRowOverscan)
    };
  }

  function renderColGroup() {
    const colgroup = document.createElement("colgroup");
    const rowHeader = document.createElement("col");
    rowHeader.className = "row-number-col";
    rowHeader.style.width = `${rowHeaderWidth}px`;
    colgroup.appendChild(rowHeader);

    renderedColumnWidths().forEach((width) => {
      const col = document.createElement("col");
      col.style.width = `${width}px`;
      colgroup.appendChild(col);
    });

    return colgroup;
  }

  function renderGridHead(container) {
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const filterRow = document.createElement("tr");
    filterRow.className = "filter-row";
    filterRow.hidden = !activeGrid.filterRowVisible;

    const rowHeader = document.createElement("th");
    rowHeader.className = "row-number-header";
    const div = document.createElement("div");
    div.className = "row-number-header-div";

    const rowSortButton = document.createElement("button");
    rowSortButton.type = "button";
    rowSortButton.className = "row-sort-button";
    rowSortButton.textContent = "#";
    rowSortButton.title = "Clear sorting and return to source order";
    rowSortButton.addEventListener("click", () => {
      activeGrid.sorts = [];
      activeGrid.selection.ranges = [];
      renderGridTable(container);
    });

    const filterToggle = document.createElement("button");
    filterToggle.type = "button";
    filterToggle.className = "filter-toggle-button";
    filterToggle.dataset.icon = activeGrid.filterRowVisible ? "filter-on" : "filter-off";
    filterToggle.setAttribute("aria-label", activeGrid.filterRowVisible ? "Hide column filters" : "Show column filters");
    filterToggle.title = activeGrid.filterRowVisible ? "Hide column filters" : "Show column filters";
    filterToggle.addEventListener("click", () => toggleFilterRow(container));

    div.append(rowSortButton, filterToggle);
    rowHeader.append(div);
    headerRow.appendChild(rowHeader);

    const rowFilterCell = document.createElement("th");
    rowFilterCell.className = "row-filter-cell";
    const clearAllFilters = document.createElement("button");
    clearAllFilters.type = "button";
    clearAllFilters.className = "clear-all-filters-button";
    clearAllFilters.textContent = "⌧";
    clearAllFilters.title = "Clear all filters";
    clearAllFilters.disabled = !hasActiveFilters();
    clearAllFilters.addEventListener("click", () => clearAllFiltersForGrid(container));
    rowFilterCell.appendChild(clearAllFilters);
    filterRow.appendChild(rowFilterCell);

    activeGrid.columns.forEach((name, columnIndex) => {
      const th = document.createElement("th");
      th.dataset.column = String(columnIndex);
      th.dataset.gridHeader = "true";
      if (isNumericColumn(columnIndex)) th.classList.add("is-numeric");
      const headerContent = document.createElement("div");
      headerContent.className = "header-cell";

      const titleButton = document.createElement("button");
      titleButton.type = "button";
      titleButton.className = "column-title";
      titleButton.textContent = name || `Column ${columnIndex + 1}`;
      titleButton.title = "Select this column";
      titleButton.addEventListener("click", (event) => {
        selectColumn(container, columnIndex, event);
      });
      titleButton.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        beginHeaderEdit(th, columnIndex);
      });

      const sortButton = document.createElement("button");
      sortButton.type = "button";
      sortButton.className = "sort-toggle";
      sortButton.textContent = sortIcon(columnIndex);
      sortButton.title = "Sort column. Hold Option for multi-sort.";
      sortButton.addEventListener("click", (event) => {
        cycleSort(columnIndex, event.altKey);
        renderGridTable(container);
      });

      const sort = activeGrid.sorts.find((entry) => entry.column === columnIndex);
      if (sort) {
        const marker = document.createElement("span");
        marker.className = "sort-marker";
        marker.textContent = sort.direction === "asc" ? "Asc" : "Desc";
        titleButton.appendChild(marker);
      }

      const resizeHandle = document.createElement("span");
      resizeHandle.className = "column-resize-handle";
      resizeHandle.title = "Drag to resize column. Double-click to fit content.";
      resizeHandle.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        activeResize = {
          column: columnIndex,
          startX: event.clientX,
          startWidth: activeGrid.columnWidths[columnIndex] || defaultColumnWidth,
          table: event.currentTarget.closest("table")
        };
        document.body.classList.add("is-resizing-column");
      });
      resizeHandle.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        fitColumnToContent(container, columnIndex);
      });

      headerContent.append(titleButton, sortButton);
      th.append(headerContent, resizeHandle);
      headerRow.appendChild(th);

      const filterCell = document.createElement("th");
      const filterValue = activeGrid.filterDrafts[columnIndex] ?? activeGrid.filters[columnIndex] ?? "";
      const isActiveFilter = Boolean(String(activeGrid.filters[columnIndex] || "").trim());
      if (isActiveFilter) filterCell.classList.add("is-filter-active");

      const filterControl = document.createElement("div");
      filterControl.className = "filter-control";

      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Filter";
      input.title = "Contains by default. Use &&, ||, groups like ab && ($bb || ^cc), >30, ~ regex, =exact, !abc, !*abc, = null, = notnull, ^abc, abc$ or $abc.";
      input.value = filterValue;
      if (isActiveFilter) input.classList.add("is-filter-active");
      input.addEventListener("input", () => {
        const caret = input.selectionStart || input.value.length;
        activeGrid.filterDrafts[columnIndex] = input.value;

        if (activeGrid.filterMode === "type") {
          window.clearTimeout(filterTimer);
          filterTimer = window.setTimeout(() => commitFilter(container, columnIndex, input.value, caret), filterDebounceMs());
        }
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          commitFilter(container, columnIndex, input.value, input.selectionStart || input.value.length);
        }
      });
      input.addEventListener("change", () => {
        if (activeGrid.filterMode === "change") {
          commitFilter(container, columnIndex, input.value, input.selectionStart || input.value.length);
        }
      });

      const clearFilter = document.createElement("button");
      clearFilter.type = "button";
      clearFilter.className = "clear-filter-button";
      clearFilter.textContent = "×";
      clearFilter.title = "Clear this filter";
      clearFilter.hidden = !isActiveFilter && !String(filterValue).trim();
      clearFilter.addEventListener("click", () => clearFilterForColumn(container, columnIndex));

      filterControl.append(input, clearFilter);
      filterCell.appendChild(filterControl);
      filterRow.appendChild(filterCell);
    });

    thead.append(headerRow, filterRow);
    return thead;
  }

  function renderGridBody(rows, startIndex = 0, endIndex = rows.length) {
    const tbody = document.createElement("tbody");

    if (activeGrid.virtualized && startIndex > 0) {
      tbody.appendChild(renderVirtualSpacer(startIndex * virtualRowHeight));
    }

    rows.slice(startIndex, endIndex).forEach((row, windowIndex) => {
      const rowIndex = startIndex + windowIndex;
      const tr = document.createElement("tr");
      tr.dataset.visibleRow = String(rowIndex);
      tr.dataset.sourceRow = String(row.sourceIndex);

      const rowHeader = document.createElement("th");
      rowHeader.className = "row-number-cell";
      rowHeader.dataset.row = String(rowIndex);
      rowHeader.textContent = String(row.sourceIndex + 1);
      rowHeader.title = "Select row";
      rowHeader.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        selectRow(event.currentTarget.closest(".data-grid-view"), rowIndex, event);
      });
      tr.appendChild(rowHeader);

      activeGrid.columns.forEach((_, columnIndex) => {
        const td = document.createElement("td");
        td.dataset.row = String(rowIndex);
        td.dataset.column = String(columnIndex);
        if (isNumericColumn(columnIndex)) td.classList.add("is-numeric");
        td.textContent = row.cells[columnIndex] || "";
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    if (activeGrid.virtualized && endIndex < rows.length) {
      tbody.appendChild(renderVirtualSpacer((rows.length - endIndex) * virtualRowHeight));
    }

    return tbody;
  }

  function renderVirtualSpacer(height) {
    const row = document.createElement("tr");
    row.className = "grid-virtual-spacer";
    const cell = document.createElement("td");
    cell.colSpan = activeGrid.columns.length + 1;
    cell.style.height = `${height}px`;
    row.appendChild(cell);
    return row;
  }

  function getVisibleRows() {
    const filters = Object.entries(activeGrid.filters).filter(([, value]) => value.trim());
    let rows = filters.length
      ? activeGrid.rows.filter((row) =>
        filters.every(([column, value]) => matchesFilter(row.cells[Number(column)] || "", value, Number(column)))
      )
      : activeGrid.rows;

    if (activeGrid.sorts.length) {
      rows = [...rows].sort((left, right) => {
        for (const { column, direction } of activeGrid.sorts) {
          const result = compareCell(left.cells[column], right.cells[column], direction, column);
          if (result !== 0) return result;
        }
        return left.sourceIndex - right.sourceIndex;
      });
    }

    return rows;
  }

  function compareCell(left, right, direction, columnIndex) {
    const leftValue = String(left || "");
    const rightValue = String(right || "");
    const leftNumber = parseNumberForColumn(leftValue, columnIndex);
    const rightNumber = parseNumberForColumn(rightValue, columnIndex);
    const bothNumeric = leftValue.trim() !== "" && rightValue.trim() !== "" && Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
    const result = bothNumeric
      ? leftNumber - rightNumber
      : leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" });

    return direction === "asc" ? result : -result;
  }

  function cycleSort(columnIndex, multiSort) {
    const existingIndex = activeGrid.sorts.findIndex((entry) => entry.column === columnIndex);
    const existing = activeGrid.sorts[existingIndex];
    const nextDirection = !existing ? "desc" : existing.direction === "desc" ? "asc" : null;
    const nextSorts = multiSort ? [...activeGrid.sorts] : [];

    if (existingIndex >= 0 && multiSort) nextSorts.splice(existingIndex, 1);

    if (nextDirection) {
      nextSorts.push({ column: columnIndex, direction: nextDirection });
    }

    activeGrid.sorts = nextSorts;
    activeGrid.selection.ranges = [];
  }

  function sortIcon(columnIndex) {
    const sort = activeGrid.sorts.find((entry) => entry.column === columnIndex);
    if (!sort) return "⇅";
    return sort.direction === "desc" ? "↓" : "↑";
  }

  function selectColumn(container, columnIndex, event = null) {
    blurFocusedFilterInput();
    const lastRow = Math.max(0, getVisibleRows().length - 1);
    activeGrid.container = container;
    if (event) {
      startSelection(container, 0, columnIndex, lastRow, columnIndex, event);
      activeGrid.selection.dragging = false;
      paintSelection(container);
      return;
    }
    activeGrid.selection.ranges = [
      {
        anchorRow: 0,
        anchorColumn: columnIndex,
        focusRow: lastRow,
        focusColumn: columnIndex
      }
    ];
    activeGrid.selection.activeIndex = 0;
    activeGrid.selection.dragging = false;
    paintSelection(container);
  }

  function selectRow(container, rowIndex, event) {
    blurFocusedFilterInput();
    startSelection(container, rowIndex, 0, rowIndex, activeGrid.columns.length - 1, event);
    activeGrid.selection.dragging = false;
    paintSelection(container);
  }

  function startSelection(container, anchorRow, anchorColumn, focusRow, focusColumn, event) {
    const range = { anchorRow, anchorColumn, focusRow, focusColumn };

    if (event.shiftKey && activeGrid.selection.anchor) {
      const anchor = activeGrid.selection.anchor;
      range.anchorRow = anchor.row;
      range.anchorColumn = anchor.column;
      activeGrid.selection.ranges = [range];
      activeGrid.selection.activeIndex = 0;
    } else if (event.metaKey || event.ctrlKey) {
      activeGrid.selection.ranges.push(range);
      activeGrid.selection.activeIndex = activeGrid.selection.ranges.length - 1;
      activeGrid.selection.anchor = { row: anchorRow, column: anchorColumn };
    } else {
      activeGrid.selection.ranges = [range];
      activeGrid.selection.activeIndex = 0;
      activeGrid.selection.anchor = { row: anchorRow, column: anchorColumn };
    }

    activeGrid.selection.dragging = true;
  }

  function toggleFilterRow(container) {
    activeGrid.filterRowVisible = !activeGrid.filterRowVisible;
    setFilterRowVisible(activeGrid.filterRowVisible);
    renderGridTable(container);
  }

  function commitFilter(container, columnIndex, value, caret) {
    activeGrid.filters[columnIndex] = value;
    activeGrid.filterDrafts[columnIndex] = value;
    activeGrid.selection.ranges = [];
    renderGridTable(container);
    const nextInput = container.querySelector(`.filter-row th:nth-child(${columnIndex + 2}) input`);
    nextInput?.focus();
    nextInput?.setSelectionRange(caret, caret);
  }

  function clearFilterForColumn(container, columnIndex) {
    activeGrid.filters[columnIndex] = "";
    activeGrid.filterDrafts[columnIndex] = "";
    activeGrid.selection.ranges = [];
    renderGridTable(container);
  }

  function clearAllFiltersForGrid(container) {
    activeGrid.filters = {};
    activeGrid.filterDrafts = {};
    activeGrid.selection.ranges = [];
    renderGridTable(container);
  }

  function hasActiveFilters() {
    return Object.values(activeGrid.filters).some((value) => String(value || "").trim());
  }

  function filterDebounceMs() {
    const rows = activeGrid?.rows?.length || 0;
    return Math.min(700, Math.max(180, Math.round(rows / 25)));
  }

  function applyGridTableWidth(table) {
    const widths = renderedColumnWidths();
    const columns = table.querySelectorAll("colgroup col");
    if (columns[0]) columns[0].style.width = `${rowHeaderWidth}px`;
    widths.forEach((width, index) => {
      if (columns[index + 1]) columns[index + 1].style.width = `${width}px`;
    });
    const width = rowHeaderWidth + widths.reduce((total, value) => total + value, 0);
    table.style.width = `${width}px`;
  }

  function renderedColumnWidths() {
    const widths = activeGrid.columnWidths.map((width) => Math.max(minColumnWidth, width || defaultColumnWidth));
    const parentWidth = activeGrid.container?.querySelector(".grid-scroll")?.clientWidth || 0;
    const layoutColumnLimit = layoutColumnWidthLimit(parentWidth, widths.length);
    const naturalWidth = rowHeaderWidth + widths.reduce((total, width) => total + width, 0);
    let extraWidth = Math.max(0, parentWidth - naturalWidth);

    while (extraWidth > 0) {
      const expandableColumns = widths
        .map((width, index) => ({ index, width }))
        .filter(({ index, width }) => isExpandableColumn(index, width));

      if (!expandableColumns.length) break;

      const share = extraWidth / expandableColumns.length;
      let appliedWidth = 0;
      expandableColumns.forEach(({ index, width }) => {
        const nextWidth = Math.min(layoutColumnLimit, width + share);
        const delta = nextWidth - width;
        widths[index] = nextWidth;
        appliedWidth += delta;
      });

      if (appliedWidth <= 0.5) break;
      extraWidth -= appliedWidth;
    }

    return widths.map((width) => Math.round(width));
  }

  function scheduleInitialColumnFit(container) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => fitColumnsToAvailableWidth(container));
    });
  }

  function fitColumnsToAvailableWidth(container) {
    if (!activeGrid || activeGrid.container !== container) return;

    const scroller = container.querySelector(".grid-scroll");
    const table = container.querySelector(".data-grid");
    const availableWidth = scroller?.clientWidth || 0;
    const tableWidth = table?.getBoundingClientRect().width || 0;
    if (!availableWidth || !tableWidth || tableWidth >= availableWidth - 2) return;

    activeGrid.columnWidths = renderedColumnWidths();
    renderGridTable(container);
  }

  function isExpandableColumn(columnIndex, width) {
    return width < maxLayoutColumnWidth;
  }

  function layoutColumnWidthLimit(parentWidth, columnCount) {
    if (!columnCount || !parentWidth) return maxFitColumnWidth;
    const evenWidth = (parentWidth - rowHeaderWidth) / columnCount;
    return Math.min(maxLayoutColumnWidth, Math.max(maxFitColumnWidth, evenWidth));
  }

  function fitColumnsToContent(container) {
    if (!activeGrid?.columns?.length) return;

    const model = gridModelFromSourceRows(activeGrid.sourceRows, activeGrid.headerEnabled, activeGrid.numberFormat);
    activeGrid.columnMeta = model.columnMeta;
    activeGrid.columns = model.columns;
    activeGrid.rows = model.rows;
    const visibleRows = getVisibleRows();
    const bodyRows = visibleRows.length ? visibleRows.map((row) => row.cells) : activeGrid.rows.map((row) => row.cells);
    const rows = [activeGrid.columns, ...bodyRows];
    activeGrid.columnWidths = activeGrid.columns.map((_, columnIndex) =>
      initialColumnWidth(rows, columnIndex, { columnMeta: activeGrid.columnMeta[columnIndex], sampleLimit: Infinity })
    );
    renderGridTable(container);
  }

  function fitColumnToContent(container, columnIndex) {
    if (!activeGrid?.columns?.length) return;

    const visibleRows = getVisibleRows();
    const bodyRows = visibleRows.length ? visibleRows.map((row) => row.cells) : activeGrid.rows.map((row) => row.cells);
    const rows = [activeGrid.columns, ...bodyRows];
    activeGrid.columnMeta[columnIndex] = detectColumnMeta(rows, columnIndex, activeGrid.numberFormat);
    activeGrid.columnWidths[columnIndex] = initialColumnWidth(rows, columnIndex, {
      columnMeta: activeGrid.columnMeta[columnIndex],
      sampleLimit: Infinity
    });
    renderGridTable(container);
  }

  function handleGridDoubleClick(event) {
    if (!activeGrid?.editable) return;
    const cell = event.target.closest("td");
    if (!cell) return;
    event.preventDefault();
    event.stopPropagation();
    beginCellEdit(cell);
  }

  function beginCellEdit(cell) {
    if (!activeGrid?.editable || cell.querySelector(".grid-cell-editor")) return;
    const visibleRow = Number(cell.dataset.row);
    const column = Number(cell.dataset.column);
    const row = getVisibleRows()[visibleRow];
    if (!row) return;

    const original = String(row.cells[column] || "");
    const cellBounds = cell.getBoundingClientRect();
    const cellWidth = Math.ceil(cell.clientWidth || cellBounds.width || cell.offsetWidth || 0);
    const cellHeight = Math.ceil(cell.clientHeight || cellBounds.height || cell.offsetHeight || 0);
    const input = document.createElement("textarea");
    input.className = "grid-cell-editor";
    input.rows = 1;
    input.value = original;
    if (cellWidth) input.style.width = `${cellWidth}px`;
    if (cellHeight) input.style.height = `${cellHeight}px`;
    input.addEventListener("mousedown", (event) => event.stopPropagation());
    cell.textContent = "";
    cell.appendChild(input);

    let finished = false;
    const finish = (commit, move = 0) => {
      if (finished) return;
      finished = true;
      if (commit) {
        row.cells[column] = input.value;
        refreshGridAfterCellEdit(activeGrid.container, row.sourceIndex, column);
      } else {
        renderGridTable(activeGrid.container);
      }
      if (move) focusAdjacentGridCell(row.sourceIndex, column + move);
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true, event.shiftKey ? -activeGrid.columns.length : activeGrid.columns.length);
      } else if (event.key === "Tab") {
        event.preventDefault();
        finish(true, event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    input.focus();
    input.select();
  }

  function beginHeaderEdit(headerCell, columnIndex) {
    if (!activeGrid?.editable || !activeGrid.headerEnabled || headerCell.querySelector(".grid-cell-editor")) return;
    const original = String(activeGrid.columns[columnIndex] || "");
    const headerContent = headerCell.querySelector(".header-cell");
    if (!headerContent) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "grid-cell-editor grid-header-editor";
    input.value = original;
    headerContent.hidden = true;
    headerCell.appendChild(input);

    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      if (commit) {
        activeGrid.sourceRows[0][columnIndex] = input.value;
        rebuildGridAfterStructure(activeGrid.container, { row: 0, column: columnIndex });
      } else {
        renderGridTable(activeGrid.container);
      }
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    input.focus();
    input.select();
  }

  function focusAdjacentGridCell(sourceIndex, flatColumn) {
    if (!activeGrid?.editable) return;
    const columnCount = activeGrid.columns.length;
    let nextSourceRow = sourceIndex + Math.floor(flatColumn / columnCount);
    let nextColumn = ((flatColumn % columnCount) + columnCount) % columnCount;
    nextSourceRow = Math.max(0, Math.min(activeGrid.rows.length - 1, nextSourceRow));
    const visibleIndex = getVisibleRows().findIndex((row) => row.sourceIndex === nextSourceRow);
    const cell = activeGrid.container.querySelector(`td[data-row="${visibleIndex}"][data-column="${nextColumn}"]`);
    if (cell) {
      selectSingleCell(activeGrid.container, visibleIndex, nextColumn);
      beginCellEdit(cell);
    }
  }

  function refreshGridAfterCellEdit(container, sourceRow, column) {
    activeGrid.columnMeta = detectGridColumnMeta([activeGrid.columns, ...activeGrid.rows.map((row) => row.cells)], activeGrid.numberFormat);
    notifyGridDocumentChanged();
    renderGridTable(container);
    const visibleRow = getVisibleRows().findIndex((row) => row.sourceIndex === sourceRow);
    if (visibleRow >= 0) selectSingleCell(container, visibleRow, column);
  }

  function handleGridPaste(event) {
    if (!activeGrid?.editable || isTextInput(event.target) || !hasSelection()) return;
    const text = event.clipboardData?.getData("text/plain");
    if (typeof text !== "string" || !text.length) return;

    const selection = normalizedSelections()[0];
    if (!selection) return;
    event.preventDefault();
    hideGridContextMenu();

    const pastedRows = parseClipboardGrid(text);
    if (!pastedRows.length) return;
    const startColumn = selection.startColumn;
    const visibleRows = getVisibleRows();
    const target = visibleRows[selection.startRow];
    const startSourceRow = target?.sourceIndex ?? activeGrid.rows.length;
    const requiredColumns = startColumn + Math.max(...pastedRows.map((row) => row.length), 1);

    while (activeGrid.columns.length < requiredColumns) insertColumnData(activeGrid.columns.length);

    pastedRows.forEach((values, rowOffset) => {
      let row = visibleRows[selection.startRow + rowOffset];
      if (!row) {
        const cells = Array.from({ length: activeGrid.columns.length }, () => "");
        activeGrid.sourceRows.push(cells);
        row = { cells, sourceIndex: activeGrid.sourceRows.length - (activeGrid.headerEnabled ? 2 : 1) };
      }
      while (row.cells.length < activeGrid.columns.length) row.cells.push("");
      values.forEach((value, columnOffset) => {
        row.cells[startColumn + columnOffset] = value;
      });
    });

    rebuildGridAfterStructure(activeGrid.container, {
      row: startSourceRow,
      column: startColumn,
      endRow: startSourceRow + pastedRows.length - 1,
      endColumn: requiredColumns - 1
    });
  }

  function parseClipboardGrid(text) {
    const normalized = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "");
    return parseDelimited(normalized, "\t");
  }

  function insertColumnData(columnIndex) {
    const headerName = uniqueColumnName(`Column ${columnIndex + 1}`);
    activeGrid.sourceRows.forEach((row, rowIndex) => {
      row.splice(columnIndex, 0, activeGrid.headerEnabled && rowIndex === 0 ? headerName : "");
    });
    if (!activeGrid.sourceRows.length) activeGrid.sourceRows.push([headerName]);
    activeGrid.columns.splice(columnIndex, 0, headerName);
  }

  function insertGridColumn(container, columnIndex) {
    if (!activeGrid?.editable) return;
    insertColumnData(Math.max(0, Math.min(columnIndex, activeGrid.columns.length)));
    rebuildGridAfterStructure(container, { row: 0, column: columnIndex });
  }

  function deleteGridColumns(container, columnIndices) {
    if (!activeGrid?.editable) return;
    const columns = normalizedGridIndices(columnIndices, activeGrid.columns.length);
    if (!columns.length || columns.length >= activeGrid.columns.length) return;

    [...columns].reverse().forEach((columnIndex) => {
      activeGrid.sourceRows.forEach((row) => row.splice(columnIndex, 1));
    });
    rebuildGridAfterStructure(container, {
      row: 0,
      column: Math.min(columns[0], activeGrid.columns.length - columns.length - 1)
    });
  }

  function insertGridRow(container, visibleRowIndex, after) {
    if (!activeGrid?.editable) return;
    const target = getVisibleRows()[visibleRowIndex];
    const sourceIndex = target?.sourceIndex ?? activeGrid.rows.length;
    const bodyIndex = sourceIndex + (after ? 1 : 0);
    const rawIndex = bodyIndex + (activeGrid.headerEnabled ? 1 : 0);
    activeGrid.sourceRows.splice(rawIndex, 0, Array.from({ length: activeGrid.columns.length }, () => ""));
    rebuildGridAfterStructure(container, { row: bodyIndex, column: 0 });
  }

  function deleteGridRows(container, sourceRowIndices) {
    if (!activeGrid?.editable || !activeGrid.rows.length) return;
    const rows = normalizedGridIndices(sourceRowIndices, activeGrid.rows.length);
    if (!rows.length) return;

    [...rows].reverse().forEach((sourceRowIndex) => {
      const rawIndex = sourceRowIndex + (activeGrid.headerEnabled ? 1 : 0);
      activeGrid.sourceRows.splice(rawIndex, 1);
    });
    rebuildGridAfterStructure(container, {
      row: Math.min(rows[0], Math.max(0, activeGrid.rows.length - rows.length - 1)),
      column: 0
    });
  }

  function normalizedGridIndices(indices, length) {
    return [...new Set(indices)]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < length)
      .sort((left, right) => left - right);
  }

  function selectedGridColumnIndices(fallbackColumnIndex) {
    const columns = [];
    normalizedSelections().forEach(({ startColumn, endColumn }) => {
      for (let column = startColumn; column <= endColumn; column += 1) columns.push(column);
    });
    if (!columns.length && Number.isInteger(fallbackColumnIndex)) columns.push(fallbackColumnIndex);
    return normalizedGridIndices(columns, activeGrid.columns.length);
  }

  function selectedGridSourceRowIndices(fallbackVisibleRowIndex) {
    const visibleRows = getVisibleRows();
    const sourceRows = [];
    normalizedSelections().forEach(({ startRow, endRow }) => {
      for (let row = startRow; row <= endRow; row += 1) {
        const sourceIndex = visibleRows[row]?.sourceIndex;
        if (Number.isInteger(sourceIndex)) sourceRows.push(sourceIndex);
      }
    });
    if (!sourceRows.length && Number.isInteger(fallbackVisibleRowIndex)) {
      const sourceIndex = visibleRows[fallbackVisibleRowIndex]?.sourceIndex;
      if (Number.isInteger(sourceIndex)) sourceRows.push(sourceIndex);
    }
    return normalizedGridIndices(sourceRows, activeGrid.rows.length);
  }

  function uniqueColumnName(base) {
    let name = base;
    let suffix = 2;
    const existing = new Set(activeGrid.columns.map((column) => String(column).toLowerCase()));
    while (existing.has(name.toLowerCase())) {
      name = `${base} ${suffix}`;
      suffix += 1;
    }
    return name;
  }

  function rebuildGridAfterStructure(container, selection = {}) {
    activeGrid.sourceRows = normalizeRows(activeGrid.sourceRows);
    const model = gridModelFromSourceRows(activeGrid.sourceRows, activeGrid.headerEnabled, activeGrid.numberFormat);
    activeGrid.columns = model.columns;
    activeGrid.rows = model.rows;
    activeGrid.columnMeta = model.columnMeta;
    activeGrid.columnWidths = model.columns.map((_, index) => initialColumnWidth(model.widthRows, index, {
      columnMeta: model.columnMeta[index],
      numberFormat: activeGrid.numberFormat
    }));
    activeGrid.filters = {};
    activeGrid.filterDrafts = {};
    activeGrid.sorts = [];
    notifyGridDocumentChanged();
    renderGridTable(container);

    if (activeGrid.rows.length && activeGrid.columns.length) {
      activeGrid.selection.ranges = [{
        anchorRow: Math.max(0, Math.min(selection.row || 0, activeGrid.rows.length - 1)),
        anchorColumn: Math.max(0, Math.min(selection.column || 0, activeGrid.columns.length - 1)),
        focusRow: Math.max(0, Math.min(selection.endRow ?? selection.row ?? 0, activeGrid.rows.length - 1)),
        focusColumn: Math.max(0, Math.min(selection.endColumn ?? selection.column ?? 0, activeGrid.columns.length - 1))
      }];
      activeGrid.selection.activeIndex = 0;
      paintSelection(container);
    }
  }

  function notifyGridDocumentChanged() {
    if (!activeGrid?.editable || !activeGrid.kind) return;
    activeGrid.changed = true;
    if (activeGrid.kind === "markdown-table") {
      const markdown = rowsToMarkdownTable(activeGrid.sourceRows);
      const nextEnd = window.__mdViewerMarkdownTableEdit?.(
        activeGrid.markdownSourceStart,
        activeGrid.markdownSourceEnd,
        markdown
      );
      if (Number.isFinite(nextEnd)) activeGrid.markdownSourceEnd = nextEnd;
      return;
    }
    const delimiter = activeGrid.kind === "tsv" ? "\t" : ",";
    window.__mdViewerDocumentEdit?.(rowsToDelimited(activeGrid.sourceRows, delimiter));
  }

  function rowsToMarkdownTable(rows) {
    const normalized = normalizeRows(rows);
    if (!normalized.length) return "";
    const header = normalized[0];
    const divider = header.map(() => "---");
    return [header, divider, ...normalized.slice(1)]
      .map((row) => `| ${row.map(encodeMarkdownTableCell).join(" | ")} |`)
      .join("\n");
  }

  function encodeMarkdownTableCell(value) {
    return String(value ?? "")
      .replace(/\r?\n/g, "<br>")
      .replace(/\|/g, "\\|");
  }

  function handleGridMouseDown(event) {
    if (event.target.closest(".column-resize-handle")) return;
    if (event.target.closest(".grid-cell-editor")) return;
    hideGridContextMenu();

    const cell = event.target.closest("td");
    if (!cell || !activeGrid) return;
    if (event.button !== 0) return;

    window.__mdViewerFocusSurface?.();
    event.preventDefault();
    requestAnimationFrame(() => window.__mdViewerFocusSurface?.());
    blurFocusedFilterInput();
    activeGrid.container = cell.closest(".data-grid-view");
    startSelection(activeGrid.container, Number(cell.dataset.row), Number(cell.dataset.column), Number(cell.dataset.row), Number(cell.dataset.column), event);
    paintSelection(cell.closest(".data-grid-view"));
  }

  function handleGridMouseOver(event) {
    const cell = event.target.closest("td");
    if (!cell || !activeGrid?.selection?.dragging) return;

    const range = activeGrid.selection.ranges[activeGrid.selection.activeIndex];
    if (range) {
      range.focusRow = Number(cell.dataset.row);
      range.focusColumn = Number(cell.dataset.column);
    }
    paintSelection(cell.closest(".data-grid-view"));
  }

  function handleGridMouseUp() {
    if (activeGrid?.selection) {
      activeGrid.selection.dragging = false;
    }
  }

  function handleColumnResizeMove(event) {
    if (!activeResize || !activeGrid) return;

    const nextWidth = Math.max(minColumnWidth, activeResize.startWidth + event.clientX - activeResize.startX);
    activeGrid.columnWidths[activeResize.column] = nextWidth;
    if (activeResize.table) applyGridTableWidth(activeResize.table);
  }

  function handleColumnResizeEnd() {
    if (!activeResize) return;

    activeResize = null;
    document.body.classList.remove("is-resizing-column");
  }

  function handleGridCopyShortcut(event) {
    const isCopy = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c";
    if (!isCopy || isTextInput(event.target)) return;

    if (hasSelection() && activeGrid?.container) {
      event.preventDefault();
      copyText(selectedGridText(activeGrid.container, { normalizeNumbers: event.shiftKey }));
      return;
    }

    const tableText = activeMarkdownTableSelectionText();
    if (tableText) {
      event.preventDefault();
      copyText(tableText);
    }
  }

  function handleGridContextMenu(event) {
    const cell = event.target.closest("td");
    const rowHeader = event.target.closest(".row-number-cell");
    const columnHeader = event.target.closest("th[data-grid-header='true']");
    if ((!cell && !rowHeader && !columnHeader) || !activeGrid) return;

    event.preventDefault();
    blurFocusedFilterInput();
    const container = event.currentTarget.closest(".data-grid-view");
    activeGrid.container = container;

    let columnIndex = null;
    let visibleRowIndex = null;
    if (cell) {
      const row = Number(cell.dataset.row);
      const column = Number(cell.dataset.column);
      visibleRowIndex = row;
      columnIndex = column;
      if (!isCellSelected(row, column)) {
        selectSingleCell(container, row, column);
      }
    } else if (columnHeader) {
      columnIndex = Number(columnHeader.dataset.column);
      if (!isColumnSelected(columnIndex)) {
        selectColumn(container, columnIndex);
      }
    } else if (rowHeader) {
      const row = Number(rowHeader.dataset.row);
      visibleRowIndex = row;
      if (!isRowSelected(row)) {
        selectSingleRow(container, row);
      }
    }

    showGridContextMenu(event.clientX, event.clientY, container, columnIndex, visibleRowIndex);
  }

  function indexMarkdownTableCells(table) {
    Array.from(table.querySelectorAll("tr")).forEach((row, rowIndex) => {
      Array.from(row.children).forEach((cell, columnIndex) => {
        cell.dataset.mdRow = String(rowIndex);
        cell.dataset.mdColumn = String(columnIndex);
      });
    });
  }

  function markdownTableSelection(table) {
    if (!table.__mdViewerSelection) {
      table.__mdViewerSelection = {
        enabled: false,
        ranges: [],
        activeIndex: -1,
        dragging: false,
        anchor: null,
        shell: null,
        toggleInput: null
      };
    }

    return table.__mdViewerSelection;
  }

  function setMarkdownTableSelectionMode(table, enabled) {
    const selection = markdownTableSelection(table);
    selection.enabled = enabled;
    selection.shell?.classList.toggle(markdownTableSelectionModeClass, enabled);
    table.classList.toggle(markdownTableSelectionModeClass, enabled);

    if (!enabled) {
      selection.ranges = [];
      selection.activeIndex = -1;
      selection.dragging = false;
      selection.anchor = null;
      if (activeMarkdownTable === table) activeMarkdownTable = null;
    }

    paintMarkdownTableSelection(table);
  }

  function setMarkdownTableSelectionEnabled(enabled, root = document, activeTable = null) {
    localStorage.setItem(markdownTableSelectionStorageKey, String(enabled));
    const tables = Array.from(root.querySelectorAll("table[data-copy-ready]"));
    tables.forEach((table) => setMarkdownTableSelectionMode(table, enabled));

    if (enabled) {
      activeMarkdownTable = activeTable || hoveredMarkdownTable || activeMarkdownTable || tables[0] || null;
      window.getSelection()?.removeAllRanges();
    } else {
      activeMarkdownTable = null;
    }
  }

  function getMarkdownTableSelectionState() {
    return localStorage.getItem(markdownTableSelectionStorageKey) === "true";
  }

  function handleMarkdownTableMouseDown(event) {
    const table = event.currentTarget;
    const selection = markdownTableSelection(table);
    if (!selection.enabled || event.button !== 0) return;

    const cell = event.target.closest("th, td");
    if (!cell || !table.contains(cell)) return;

    window.__mdViewerFocusSurface?.();
    event.preventDefault();
    requestAnimationFrame(() => window.__mdViewerFocusSurface?.());
    hideGridContextMenu();
    activeMarkdownTable = table;
    window.getSelection()?.removeAllRanges();

    const row = Number(cell.dataset.mdRow);
    const column = Number(cell.dataset.mdColumn);
    if (!Number.isFinite(row) || !Number.isFinite(column)) return;

    if (cell.tagName.toLowerCase() === "th") {
      startMarkdownTableColumnSelection(table, column, event);
      paintMarkdownTableSelection(table);
      return;
    }

    startMarkdownTableSelection(table, row, column, row, column, event);
    paintMarkdownTableSelection(table);
  }

  function handleMarkdownTableMouseOver(event) {
    const table = event.currentTarget;
    const selection = markdownTableSelection(table);
    if (!selection.enabled || !selection.dragging) return;

    const cell = event.target.closest("th, td");
    if (!cell || !table.contains(cell)) return;

    const range = selection.ranges[selection.activeIndex];
    if (range) {
      range.focusColumn = Number(cell.dataset.mdColumn);
      if (range.excludeHeaderOnCopy) {
        range.focusRow = Math.max(0, markdownTableDimensions(table).rows - 1);
      } else {
        range.focusRow = Number(cell.dataset.mdRow);
      }
    }
    paintMarkdownTableSelection(table);
  }

  function handleMarkdownTableMouseUp() {
    if (!activeMarkdownTable) return;
    markdownTableSelection(activeMarkdownTable).dragging = false;
  }

  function handleMarkdownTableContextMenu(event) {
    const table = event.currentTarget;
    const selection = markdownTableSelection(table);
    if (!selection.enabled) return;

    const cell = event.target.closest("th, td");
    if (!cell || !table.contains(cell)) return;

    window.__mdViewerFocusSurface?.();
    event.preventDefault();
    requestAnimationFrame(() => window.__mdViewerFocusSurface?.());
    activeMarkdownTable = table;

    const row = Number(cell.dataset.mdRow);
    const column = Number(cell.dataset.mdColumn);
    if (!isMarkdownTableCellSelected(table, row, column)) {
      selection.ranges = [
        {
          anchorRow: row,
          anchorColumn: column,
          focusRow: row,
          focusColumn: column
        }
      ];
      selection.activeIndex = 0;
      selection.anchor = { row, column };
      selection.dragging = false;
      paintMarkdownTableSelection(table);
    }

    showGridContextMenu(event.clientX, event.clientY, null);
  }

  function startMarkdownTableSelection(table, anchorRow, anchorColumn, focusRow, focusColumn, event) {
    const selection = markdownTableSelection(table);
    const range = { anchorRow, anchorColumn, focusRow, focusColumn };

    if (event.shiftKey && selection.anchor) {
      range.anchorRow = selection.anchor.row;
      range.anchorColumn = selection.anchor.column;
      selection.ranges = [range];
      selection.activeIndex = 0;
    } else if (event.metaKey || event.ctrlKey) {
      selection.ranges.push(range);
      selection.activeIndex = selection.ranges.length - 1;
      selection.anchor = { row: anchorRow, column: anchorColumn };
    } else {
      selection.ranges = [range];
      selection.activeIndex = 0;
      selection.anchor = { row: anchorRow, column: anchorColumn };
    }

    selection.dragging = true;
  }

  function startMarkdownTableColumnSelection(table, columnIndex, event) {
    const selection = markdownTableSelection(table);
    const dimensions = markdownTableDimensions(table);
    const lastRow = Math.max(0, dimensions.rows - 1);
    const range = {
      anchorRow: 0,
      anchorColumn: columnIndex,
      focusRow: lastRow,
      focusColumn: columnIndex,
      excludeHeaderOnCopy: true
    };

    if (event.shiftKey && selection.anchor) {
      range.anchorColumn = selection.anchor.column;
      selection.ranges = [range];
      selection.activeIndex = 0;
    } else if (event.metaKey || event.ctrlKey) {
      selection.ranges.push(range);
      selection.activeIndex = selection.ranges.length - 1;
      selection.anchor = { row: 0, column: columnIndex };
    } else {
      selection.ranges = [range];
      selection.activeIndex = 0;
      selection.anchor = { row: 0, column: columnIndex };
    }

    selection.dragging = true;
  }

  function selectMarkdownTableColumn(table, columnIndex) {
    startMarkdownTableColumnSelection(table, columnIndex, {
      shiftKey: false,
      metaKey: false,
      ctrlKey: false
    });
    const selection = markdownTableSelection(table);
    selection.dragging = false;
    paintMarkdownTableSelection(table);
  }

  function paintMarkdownTableSelection(table) {
    const selection = markdownTableSelection(table);
    table.querySelectorAll(`th.${gridSelectionClass}, td.${gridSelectionClass}`).forEach((cell) => {
      cell.classList.remove(gridSelectionClass);
    });

    if (!selection.ranges.length) {
      updateMarkdownSelectionControls(table);
      return;
    }

    normalizedMarkdownSelections(table).forEach(({ startRow, endRow, startColumn, endColumn }) => {
      table.querySelectorAll("th, td").forEach((cell) => {
        const row = Number(cell.dataset.mdRow);
        const column = Number(cell.dataset.mdColumn);
        if (row >= startRow && row <= endRow && column >= startColumn && column <= endColumn) {
          cell.classList.add(gridSelectionClass);
        }
      });
    });

    updateMarkdownSelectionControls(table);
  }

  function updateMarkdownSelectionControls(table) {
    const selection = markdownTableSelection(table);
    if (selection.toggleInput) {
      if (selection.toggleInput.tagName === "BUTTON") {
        selection.toggleInput.setAttribute("aria-pressed", String(selection.enabled));
      } else {
        selection.toggleInput.checked = selection.enabled;
      }
    }
  }

  function normalizedMarkdownSelection(range) {
    const { anchorRow, anchorColumn, focusRow, focusColumn, excludeHeaderOnCopy } = range;
    return {
      startRow: Math.min(anchorRow, focusRow),
      endRow: Math.max(anchorRow, focusRow),
      startColumn: Math.min(anchorColumn, focusColumn),
      endColumn: Math.max(anchorColumn, focusColumn),
      excludeHeaderOnCopy: Boolean(excludeHeaderOnCopy)
    };
  }

  function normalizedMarkdownSelections(table) {
    return markdownTableSelection(table).ranges.map(normalizedMarkdownSelection);
  }

  function isMarkdownTableCellSelected(table, row, column) {
    return normalizedMarkdownSelections(table).some(({ startRow, endRow, startColumn, endColumn }) =>
      row >= startRow && row <= endRow && column >= startColumn && column <= endColumn
    );
  }

  function markdownTableDimensions(table) {
    const rows = Array.from(table.querySelectorAll("tr"));
    const columns = rows.reduce((maximum, row) => Math.max(maximum, row.children.length), 0);
    return { rows: rows.length, columns };
  }

  function markdownTableSelectionText(table) {
    const selection = markdownTableSelection(table);
    if (!selection.enabled || !selection.ranges.length) return "";

    const blocks = normalizedMarkdownSelections(table).map(({ startRow, endRow, startColumn, endColumn, excludeHeaderOnCopy }) => {
      const rows = [];
      const copyStartRow = excludeHeaderOnCopy ? Math.max(startRow, 1) : startRow;
      for (let row = copyStartRow; row <= endRow; row += 1) {
        const cells = [];
        for (let column = startColumn; column <= endColumn; column += 1) {
          const value = table.querySelector(`[data-md-row="${row}"][data-md-column="${column}"]`)?.textContent || "";
          cells.push(value.replace(/\s+/g, " ").trim());
        }
        rows.push(cells.join("\t"));
      }
      return rows.join("\n");
    });

    return blocks.join("\n\n");
  }

  function activeMarkdownTableSelectionText() {
    return activeMarkdownTable ? markdownTableSelectionText(activeMarkdownTable) : "";
  }

  function showGridContextMenu(clientX, clientY, container, columnIndex = null, visibleRowIndex = null) {
    hideGridContextMenu();
    const isGridSelection = Boolean(container && hasSelection());
    const isMarkdownSelection = !container && Boolean(activeMarkdownTableSelectionText());
    if (!isGridSelection && !isMarkdownSelection) return;

    const menu = document.createElement("div");
    menu.className = "grid-context-menu";
    menu.setAttribute("role", "menu");

    const copyButton = gridContextMenuButton("Copy", () => (
      isGridSelection ? selectedGridText(container) : activeMarkdownTableSelectionText()
    ));
    menu.append(copyButton);

    if (isGridSelection) {
      const copyNumbersButton = gridContextMenuButton("Copy US numbers", () => selectedGridText(container, { normalizeNumbers: true }));
      menu.append(copyNumbersButton);
    }

    if (isGridSelection && activeGrid.editable && Number.isInteger(columnIndex)) {
      const selectedColumns = selectedGridColumnIndices(columnIndex);
      const separator = document.createElement("div");
      separator.className = "grid-context-separator";
      const addBefore = gridContextActionButton("Add column before", () => insertGridColumn(container, columnIndex));
      const addAfter = gridContextActionButton("Add column after", () => insertGridColumn(container, columnIndex + 1));
      const remove = gridContextActionButton(
        selectedColumns.length === 1 ? "Delete column" : `Delete ${selectedColumns.length} columns`,
        () => deleteGridColumns(container, selectedColumns)
      );
      remove.classList.add("is-danger");
      remove.disabled = selectedColumns.length >= activeGrid.columns.length;
      menu.append(separator, addBefore, addAfter, remove);
    }

    if (isGridSelection && activeGrid.editable && Number.isInteger(visibleRowIndex)) {
      const selectedRows = selectedGridSourceRowIndices(visibleRowIndex);
      const separator = document.createElement("div");
      separator.className = "grid-context-separator";
      const addBefore = gridContextActionButton("Insert row above", () => insertGridRow(container, visibleRowIndex, false));
      const addAfter = gridContextActionButton("Insert row below", () => insertGridRow(container, visibleRowIndex, true));
      const remove = gridContextActionButton(
        selectedRows.length === 1 ? "Delete row" : `Delete ${selectedRows.length} rows`,
        () => deleteGridRows(container, selectedRows)
      );
      remove.classList.add("is-danger");
      menu.append(separator, addBefore, addAfter, remove);
    }

    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    const left = Math.min(clientX, window.innerWidth - rect.width - 8);
    const top = Math.min(clientY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    gridContextMenu = menu;
  }

  function gridContextMenuButton(label, getText) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.addEventListener("click", async (event) => {
      try {
        await copyText(getText(), { append: event.shiftKey });
      } finally {
        hideGridContextMenu();
      }
    });
    return button;
  }

  function gridContextActionButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.addEventListener("click", () => {
      action();
      hideGridContextMenu();
    });
    return button;
  }

  function hideGridContextMenu(event) {
    if (event?.target?.closest?.(".grid-context-menu")) return;
    gridContextMenu?.remove();
    gridContextMenu = null;
  }

  function handleGridContextMenuKeyDown(event) {
    if (event.key === "Escape") hideGridContextMenu();
  }

  function isTextInput(target) {
    return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
  }

  function blurFocusedFilterInput() {
    const active = document.activeElement;
    if (active?.closest?.(".filter-row")) {
      active.blur();
    }
  }

  function paintSelection(container) {
    if (!container) return;
    container.querySelectorAll(`td.${gridSelectionClass}`).forEach((cell) => cell.classList.remove(gridSelectionClass));
    container.querySelectorAll(`.row-number-cell.${gridSelectionClass}`).forEach((cell) => cell.classList.remove(gridSelectionClass));
    if (!hasSelection()) return;

    normalizedSelections().forEach(({ startRow, endRow, startColumn, endColumn }) => {
      container.querySelectorAll("tbody td").forEach((cell) => {
        const row = Number(cell.dataset.row);
        const column = Number(cell.dataset.column);
        if (row >= startRow && row <= endRow && column >= startColumn && column <= endColumn) {
          cell.classList.add(gridSelectionClass);
        }
      });
      container.querySelectorAll(".row-number-cell").forEach((cell) => {
        const row = Number(cell.dataset.row);
        if (row >= startRow && row <= endRow && startColumn === 0 && endColumn === activeGrid.columns.length - 1) {
          cell.classList.add(gridSelectionClass);
        }
      });
    });
  }

  function normalizedSelection(range) {
    const { anchorRow, anchorColumn, focusRow, focusColumn } = range;
    return {
      startRow: Math.min(anchorRow, focusRow),
      endRow: Math.max(anchorRow, focusRow),
      startColumn: Math.min(anchorColumn, focusColumn),
      endColumn: Math.max(anchorColumn, focusColumn)
    };
  }

  function normalizedSelections() {
    return activeGrid.selection.ranges.map(normalizedSelection);
  }

  function hasSelection() {
    return Boolean(activeGrid?.selection?.ranges?.length);
  }

  function selectedGridText(container, options = {}) {
    const visibleRows = activeGrid.visibleRows || getVisibleRows();
    const selections = normalizedSelections().sort((left, right) => (
      left.startRow - right.startRow || left.startColumn - right.startColumn
    ));
    const sharesRows = selections.length > 1 && selections.every((range) => (
      range.startRow === selections[0].startRow && range.endRow === selections[0].endRow
    ));

    if (sharesRows) {
      const rows = [];
      for (let row = selections[0].startRow; row <= selections[0].endRow; row += 1) {
        const cells = [];
        selections.forEach(({ startColumn, endColumn }) => {
          for (let column = startColumn; column <= endColumn; column += 1) {
            const value = visibleRows[row]?.cells[column] || "";
            cells.push(options.normalizeNumbers ? normalizeCellForUsCopy(value, column) : value);
          }
        });
        rows.push(cells.join("\t"));
      }
      return rows.join("\n");
    }

    const blocks = selections.map(({ startRow, endRow, startColumn, endColumn }) => {
      const rows = [];
      for (let row = startRow; row <= endRow; row += 1) {
        const cells = [];
        for (let column = startColumn; column <= endColumn; column += 1) {
          const value = visibleRows[row]?.cells[column] || "";
          cells.push(options.normalizeNumbers ? normalizeCellForUsCopy(value, column) : value);
        }
        rows.push(cells.join("\t"));
      }
      return rows.join("\n");
    });

    return blocks.join("\n");
  }

  function selectSingleCell(container, row, column) {
    activeGrid.selection.ranges = [
      {
        anchorRow: row,
        anchorColumn: column,
        focusRow: row,
        focusColumn: column
      }
    ];
    activeGrid.selection.activeIndex = 0;
    activeGrid.selection.dragging = false;
    activeGrid.selection.anchor = { row, column };
    paintSelection(container);
  }

  function selectSingleRow(container, row) {
    activeGrid.selection.ranges = [
      {
        anchorRow: row,
        anchorColumn: 0,
        focusRow: row,
        focusColumn: activeGrid.columns.length - 1
      }
    ];
    activeGrid.selection.activeIndex = 0;
    activeGrid.selection.dragging = false;
    activeGrid.selection.anchor = { row, column: 0 };
    paintSelection(container);
  }

  function isCellSelected(row, column) {
    return normalizedSelections().some(({ startRow, endRow, startColumn, endColumn }) =>
      row >= startRow && row <= endRow && column >= startColumn && column <= endColumn
    );
  }

  function isRowSelected(row) {
    return normalizedSelections().some(({ startRow, endRow, startColumn, endColumn }) =>
      row >= startRow && row <= endRow && startColumn === 0 && endColumn === activeGrid.columns.length - 1
    );
  }

  function isColumnSelected(column) {
    const lastRow = Math.max(0, getVisibleRows().length - 1);
    return normalizedSelections().some(({ startRow, endRow, startColumn, endColumn }) =>
      column >= startColumn && column <= endColumn && startRow === 0 && endRow === lastRow
    );
  }

  function visibleGridText(container) {
    return (activeGrid.visibleRows || getVisibleRows())
      .map((row) => row.cells.join("\t"))
      .join("\n");
  }

  function gridText({ includeHeader }) {
    return rowsToDelimited(gridRows({ includeHeader }), "\t");
  }

  function gridRows({ includeHeader }) {
    const rows = activeGrid.rows.map((row) => row.cells);
    return includeHeader ? [activeGrid.columns, ...rows] : rows;
  }

  function downloadRows(rows, kind) {
    const delimiter = kind === "tsv" ? "\t" : ",";
    const mime = kind === "tsv" ? "text/tab-separated-values" : "text/csv";
    const extension = kind === "tsv" ? "tsv" : "csv";
    const text = rowsToDelimited(rows, delimiter);
    if (window.__mdViewerSaveCopy) {
      window.__mdViewerSaveCopy(`table.${extension}`, text);
      return;
    }

    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `table.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function rowsToDelimited(rows, delimiter) {
    return rows.map((row) => row.map((cell) => encodeDelimitedCell(cell, delimiter)).join(delimiter)).join("\n");
  }

  function encodeDelimitedCell(value, delimiter) {
    const text = String(value ?? "");
    const mustQuote = delimiter === "," && /[",\n]/.test(text);
    if (!mustQuote) return text;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function matchesFilter(value, filter, columnIndex) {
    const text = String(value ?? "");
    const query = String(filter || "").trim();
    if (!query) return true;

    try {
      return parseFilterExpression(query).evaluate(text, columnIndex);
    } catch (error) {
      return matchesFilterClause(text, query, columnIndex);
    }
  }

  function matchesFilterClause(text, clause, columnIndex) {
    const comparison = clause.match(/^(>=|<=|>|<)\s*([+-]?\d+(?:[.,]\d+)*)$/);
    if (comparison) {
      const value = parseNumberForColumn(text, columnIndex);
      const target = parseNumberForColumn(comparison[2], columnIndex);
      if (!Number.isFinite(value) || !Number.isFinite(target)) return false;

      if (comparison[1] === ">") return value > target;
      if (comparison[1] === ">=") return value >= target;
      if (comparison[1] === "<") return value < target;
      return value <= target;
    }

    const normalized = text.trim().toLowerCase();
    const normalizedClause = clause.trim().toLowerCase();

    if (clause.startsWith("~")) {
      try {
        return new RegExp(clause.slice(1).trim(), "i").test(text);
      } catch (error) {
        return false;
      }
    }

    if (clause.startsWith("=")) {
      const expected = clause.slice(1).trim().toLowerCase();
      if (expected === "null") return normalized === "";
      if (expected === "notnull") return normalized !== "";
      return normalized === expected;
    }

    if (clause.startsWith("<>")) {
      const expected = clause.slice(2).trim().toLowerCase();
      if (expected === "null") return normalized !== "";
      return normalized !== clause.slice(2).trim().toLowerCase();
    }

    if (clause.startsWith("!*")) {
      return !text.toLowerCase().includes(clause.slice(2).trim().toLowerCase());
    }

    if (clause.startsWith("!")) {
      const expected = clause.slice(1).trim().toLowerCase();
      if (expected === "null") return normalized !== "";
      return normalized !== clause.slice(1).trim().toLowerCase();
    }

    if (clause.startsWith("^")) {
      return normalized.startsWith(clause.slice(1).trim().toLowerCase());
    }

    if (clause.startsWith("$") && clause.length > 1) {
      return normalized.endsWith(clause.slice(1).trim().toLowerCase());
    }

    if (clause.endsWith("$") && clause.length > 1) {
      return normalized.endsWith(clause.slice(0, -1).trim().toLowerCase());
    }

    return text.toLowerCase().includes(normalizedClause);
  }

  function parseFilterExpression(query) {
    const tokens = tokenizeFilterExpression(query);
    let position = 0;

    function peek() {
      return tokens[position];
    }

    function consume(type) {
      if (peek()?.type !== type) return null;
      position += 1;
      return tokens[position - 1];
    }

    function parseOr() {
      let node = parseAnd();
      while (consume("or")) {
        const left = node;
        const right = parseAnd();
        node = {
          evaluate: (text, columnIndex) => left.evaluate(text, columnIndex) || right.evaluate(text, columnIndex)
        };
      }
      return node;
    }

    function parseAnd() {
      let node = parsePrimary();
      while (consume("and")) {
        const left = node;
        const right = parsePrimary();
        node = {
          evaluate: (text, columnIndex) => left.evaluate(text, columnIndex) && right.evaluate(text, columnIndex)
        };
      }
      return node;
    }

    function parsePrimary() {
      if (consume("open")) {
        const node = parseOr();
        if (!consume("close")) throw new Error("Missing closing parenthesis");
        return node;
      }

      const token = consume("clause");
      if (!token) throw new Error("Expected filter clause");
      return {
        evaluate: (text, columnIndex) => matchesFilterClause(text, token.value, columnIndex)
      };
    }

    const expression = parseOr();
    if (position < tokens.length) throw new Error("Unexpected filter token");
    return expression;
  }

  function tokenizeFilterExpression(query) {
    const tokens = [];
    let index = 0;

    while (index < query.length) {
      while (/\s/.test(query[index] || "")) index += 1;
      if (index >= query.length) break;

      if (query.startsWith("&&", index)) {
        tokens.push({ type: "and" });
        index += 2;
        continue;
      }

      if (query.startsWith("||", index)) {
        tokens.push({ type: "or" });
        index += 2;
        continue;
      }

      if (query[index] === "(") {
        tokens.push({ type: "open" });
        index += 1;
        continue;
      }

      if (query[index] === ")") {
        tokens.push({ type: "close" });
        index += 1;
        continue;
      }

      const start = index;
      while (index < query.length) {
        if (query.startsWith("&&", index) || query.startsWith("||", index) || query[index] === "(" || query[index] === ")") break;
        index += 1;
      }

      const value = query.slice(start, index).trim();
      if (value) tokens.push({ type: "clause", value });
    }

    if (!tokens.length) return [{ type: "clause", value: query }];
    return tokens;
  }

  function parseNumberForColumn(value, columnIndex) {
    const meta = activeGrid?.columnMeta?.[columnIndex];
    if (meta?.numeric) {
      return parseNumber(value, meta.format || activeGrid?.numberFormat || "auto");
    }

    return parseNumber(value, activeGrid?.numberFormat || getNumberFormat());
  }

  function parseNumber(value, format = activeGrid?.numberFormat || getNumberFormat()) {
    const text = normalizeNumberText(value);
    const analysis = analyzeNumberToken(text);
    if (!analysis.candidate) return NaN;

    if (format === "auto") {
      if (analysis.format === "plain") return Number(text);
      if (!analysis.format || analysis.ambiguous) return NaN;
      return parseNumber(text, analysis.format);
    }

    if (format === "plain") {
      if (analysis.format === "plain") return Number(text);
      if (!analysis.format || analysis.ambiguous) return NaN;
      return parseNumber(text, analysis.format);
    }

    const normalized = format === "us"
      ? text.replaceAll(",", "")
      : text.replaceAll(".", "").replace(",", ".");

    return Number(normalized);
  }

  function normalizeRows(rows) {
    if (!rows.length) return [];
    const columnCount = Math.max(...rows.map((row) => row.length));
    return rows.map((row) => {
      const normalized = Array.isArray(row) ? row : Array.from(row || []);
      while (normalized.length < columnCount) normalized.push("");
      for (let index = 0; index < normalized.length; index += 1) {
        if (normalized[index] === null || normalized[index] === undefined) normalized[index] = "";
      }
      return normalized;
    });
  }

  function gridModelFromSourceRows(sourceRows, headerEnabled, numberFormat) {
    const columnCount = sourceRows[0]?.length || 0;
    const columns = headerEnabled && sourceRows.length
      ? sourceRows[0]
      : Array.from({ length: columnCount }, (_, index) => excelColumnName(index));
    const bodyRows = headerEnabled ? sourceRows.slice(1) : sourceRows;
    const widthRows = headerEnabled ? sourceRows : [columns, ...bodyRows];
    const columnMeta = detectGridColumnMeta(widthRows, numberFormat);

    return {
      columnMeta,
      columns,
      rows: bodyRows.map((cells, index) => ({ cells, sourceIndex: index })),
      widthRows
    };
  }

  function excelColumnName(index) {
    let value = index + 1;
    let label = "";

    while (value > 0) {
      value -= 1;
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26);
    }

    return label;
  }

  function initialColumnWidth(rows, columnIndex, options = {}) {
    const sampleLimit = options.sampleLimit ?? 80;
    const numberFormat = options.numberFormat || activeGrid?.numberFormat || getNumberFormat();
    const columnMeta = options.columnMeta || detectColumnMeta(rows, columnIndex, numberFormat);
    const header = String(rows[0]?.[columnIndex] || "");
    const bodyRows = sampleLimit === Infinity ? rows.slice(1) : rows.slice(1, sampleLimit + 1);
    const values = bodyRows.map((row) => String(row[columnIndex] || "").trim());
    const nonEmptyValues = values.filter(Boolean);
    const samples = [header, ...nonEmptyValues];
    const longest = Math.max(...samples.map((value) => Math.min(value.length, 48)), 4);
    const headerWidth = textWidthEstimate(header, 9, 52);
    const valueWidth = textWidthEstimate(samples.reduce((longestValue, value) => (
      value.length > longestValue.length ? value : longestValue
    ), ""), 8, 42);

    if (columnMeta.numeric || isCompactNumericColumn(header, nonEmptyValues, numberFormat)) {
      return clampWidth(Math.max(headerWidth, valueWidth) + 34, minColumnWidth, 220);
    }

    if (isShortCodeColumn(header, nonEmptyValues)) {
      return clampWidth(Math.max(headerWidth, valueWidth) + 34, minColumnWidth, 220);
    }

    return clampWidth(Math.max(headerWidth, longest * 8 + 36), minColumnWidth, maxFitColumnWidth);
  }

  function isCompactNumericColumn(header, values, numberFormat) {
    if (!values.length) return false;
    const numericCount = values.filter((value) => Number.isFinite(parseNumber(value, numberFormat))).length;
    const numericRatio = numericCount / values.length;
    const longestValue = Math.max(...values.map((value) => value.length), 0);
    const headerText = String(header || "").toLowerCase();
    return numericRatio >= 0.85 && longestValue <= 12 && !/(sentence|text|prompt|description|url|content|script)/.test(headerText);
  }

  function detectGridColumnMeta(rows, numberFormat = getNumberFormat()) {
    return (rows[0] || []).map((_, columnIndex) => detectColumnMeta(rows, columnIndex, numberFormat));
  }

  function detectColumnMeta(rows, columnIndex, numberFormat = getNumberFormat()) {
    const values = rows
      .slice(1, 41)
      .map((row) => String(row[columnIndex] || "").trim())
      .filter(Boolean);

    if (!values.length) return { numeric: false, format: null };

    if (numberFormat !== "auto") {
      const numericCount = values.filter((value) => Number.isFinite(parseNumber(value, numberFormat))).length;
      return {
        numeric: numericCount / values.length >= 0.85,
        format: numberFormat
      };
    }

    let candidateCount = 0;
    let plainCount = 0;
    let ambiguousCount = 0;
    const formatCounts = { us: 0, vn: 0 };

    values.forEach((value) => {
      const analysis = analyzeNumberToken(value);
      if (!analysis.candidate) return;

      candidateCount += 1;
      if (analysis.format === "plain") plainCount += 1;
      if (analysis.ambiguous) ambiguousCount += 1;
      if (analysis.format === "us" || analysis.format === "vn") {
        formatCounts[analysis.format] += 1;
      }
    });

    if (candidateCount / values.length < 0.85) return { numeric: false, format: null };

    if (formatCounts.us || formatCounts.vn) {
      const format = formatCounts.us > formatCounts.vn ? "us" : "vn";
      if (formatCounts.us === formatCounts.vn) return { numeric: false, format: null };
      return { numeric: true, format };
    }

    if (ambiguousCount > 0) {
      return { numeric: false, format: null };
    }

    return { numeric: plainCount > 0, format: "plain" };
  }

  function analyzeNumberToken(value) {
    const text = normalizeNumberText(value);
    if (!/^[+-]?\d+(?:[.,]\d+)*$/.test(text)) return { candidate: false, format: null, ambiguous: false };

    const unsigned = /^[+-]/.test(text) ? text.slice(1) : text;
    const commaCount = (unsigned.match(/,/g) || []).length;
    const dotCount = (unsigned.match(/\./g) || []).length;

    if (!commaCount && !dotCount) return { candidate: true, format: "plain", ambiguous: false };
    if (commaCount && dotCount) {
      return { candidate: true, format: unsigned.lastIndexOf(".") > unsigned.lastIndexOf(",") ? "us" : "vn", ambiguous: false };
    }

    const separator = commaCount ? "," : ".";
    const count = commaCount || dotCount;
    const parts = unsigned.split(separator);
    if (parts.some((part) => !part)) return { candidate: false, format: null, ambiguous: false };

    if (count > 1) {
      const validThousands = parts[0].length <= 3 && parts.slice(1).every((part) => part.length === 3);
      return {
        candidate: validThousands,
        format: validThousands ? separator === "," ? "us" : "vn" : null,
        ambiguous: false
      };
    }

    const decimalDigits = parts[1].length;
    if (decimalDigits === 3 && parts[0].length <= 3) {
      return { candidate: true, format: null, ambiguous: true };
    }

    return { candidate: true, format: separator === "," ? "vn" : "us", ambiguous: false };
  }

  function normalizeNumberText(value) {
    return String(value ?? "")
      .trim()
      .replace(/[\s\u00a0\u202f]/g, "")
      .replace(/^[^\d.,+-]+/, "")
      .replace(/[^\d.,]+$/, "");
  }

  function normalizeCellForUsCopy(value, columnIndex) {
    const text = normalizeNumberText(value);
    const analysis = analyzeNumberToken(text);
    if (!analysis.candidate) return value;

    const meta = activeGrid?.columnMeta?.[columnIndex];
    let format = analysis.format && analysis.format !== "plain" && !analysis.ambiguous
      ? analysis.format
      : meta?.numeric
        ? meta.format || activeGrid?.numberFormat || getNumberFormat()
        : analysis.ambiguous ? null : analysis.format;

    if (format === "auto") {
      format = analysis.ambiguous ? null : analysis.format;
    }

    if (!format || format === "plain") {
      return Number.isFinite(parseNumber(text, format || "auto")) ? text : value;
    }

    const normalized = format === "us"
      ? text.replaceAll(",", "")
      : text.replaceAll(".", "").replace(",", ".");

    return Number.isFinite(Number(normalized)) ? normalized : value;
  }

  function isNumericColumn(columnIndex) {
    return Boolean(activeGrid?.columnMeta?.[columnIndex]?.numeric);
  }

  function isShortCodeColumn(header, values) {
    if (!values.length) return false;
    const longestValue = Math.max(...values.map((value) => value.length), 0);
    const averageLength = values.reduce((sum, value) => sum + value.length, 0) / values.length;
    const headerText = String(header || "").toLowerCase();
    return longestValue <= 14 && averageLength <= 8 && !/(sentence|text|prompt|description|url|content|script)/.test(headerText);
  }

  function textWidthEstimate(value, charWidth, maxChars) {
    return Math.min(String(value || "").length, maxChars) * charWidth;
  }

  function clampWidth(value, min, max) {
    return Math.round(Math.min(max, Math.max(min, value)));
  }

  function setWrapEnabled(enabled, root = document) {
    setWrapState(enabled);
    updateWrappedContent(root, enabled);
    activeGrid?.container?.classList.toggle("is-wrapped", enabled);
  }

  function updateWrappedContent(root, wrapEnabled) {
    root.querySelectorAll(".table-viewer, table[data-copy-ready], .code-viewer, .mermaid-viewer").forEach((element) => {
      element.classList.toggle("is-wrapped", wrapEnabled);
    });
    root.querySelectorAll(".wrap-toggle-input").forEach((input) => {
      if (input.tagName === "BUTTON") {
        input.setAttribute("aria-pressed", String(wrapEnabled));
      } else {
        input.checked = wrapEnabled;
      }
    });
  }

  function getWrapState() {
    try {
      return localStorage.getItem(wrapStorageKey) === "true";
    } catch (error) {
      return false;
    }
  }

  function setWrapState(enabled) {
    try {
      localStorage.setItem(wrapStorageKey, String(enabled));
    } catch (error) {
      // Some page origins block localStorage for content scripts.
    }
  }

  function getFilterRowVisible() {
    try {
      const value = localStorage.getItem(filterRowStorageKey);
      return value === null ? true : value === "true";
    } catch (error) {
      return true;
    }
  }

  function setFilterRowVisible(enabled) {
    try {
      localStorage.setItem(filterRowStorageKey, String(enabled));
    } catch (error) {
      // Some page origins block localStorage for content scripts.
    }
  }

  function getFilterMode() {
    try {
      return localStorage.getItem(filterModeStorageKey) === "type" ? "type" : "change";
    } catch (error) {
      return "change";
    }
  }

  function setFilterMode(mode) {
    try {
      localStorage.setItem(filterModeStorageKey, mode);
    } catch (error) {
      // Some page origins block localStorage for content scripts.
    }
  }

  function getNumberFormat() {
    try {
      const value = localStorage.getItem(numberFormatStorageKey);
      return value === "vn" || value === "us" ? value : "auto";
    } catch (error) {
      return "auto";
    }
  }

  function setNumberFormat(format) {
    try {
      localStorage.setItem(numberFormatStorageKey, ["auto", "vn", "us"].includes(format) ? format : "auto");
    } catch (error) {
      // Some page origins block localStorage for content scripts.
    }
  }

  function toggleNumberFormat(container = activeGrid?.container) {
    const currentFormat = getNumberFormat();
    const nextFormat = currentFormat === "auto" ? "vn" : currentFormat === "vn" ? "us" : "auto";
    setNumberFormat(nextFormat);

    if (activeGrid) {
      activeGrid.numberFormat = nextFormat;
      if (container) {
        fitColumnsToContent(container);
      }
    }

    syncNumberFormatButtons(nextFormat);
    return nextFormat;
  }

  function updateNumberFormatButton(button, format) {
    const normalized = format === "us" ? "US" : format === "vn" ? "VN" : "Auto";
    setTableIconButton(button, "number", `Number parsing: ${normalized}`, "U", normalized);
  }

  function syncNumberFormatButtons(format = getNumberFormat()) {
    document.querySelectorAll(".number-format-toggle").forEach((button) => {
      updateNumberFormatButton(button, format);
    });
  }

  function toggleHeaderRow(container = activeGrid?.container) {
    if (!activeGrid?.sourceRows?.length || !container) return null;

    activeGrid.headerEnabled = !activeGrid.headerEnabled;
    rebuildGridFromSourceRows(container);
    return activeGrid.headerEnabled;
  }

  function rebuildGridFromSourceRows(container = activeGrid?.container) {
    const model = gridModelFromSourceRows(activeGrid.sourceRows, activeGrid.headerEnabled, activeGrid.numberFormat);
    activeGrid.columnMeta = model.columnMeta;
    activeGrid.columns = model.columns;
    activeGrid.rows = model.rows;
    activeGrid.selection.ranges = [];
    activeGrid.selection.activeIndex = -1;
    activeGrid.selection.anchor = null;
    activeGrid.columnWidths = model.columns.map((_, index) => initialColumnWidth(model.widthRows, index, {
      columnMeta: model.columnMeta[index],
      numberFormat: activeGrid.numberFormat
    }));
    renderGridTable(container);
    syncHeaderButtons();
  }

  function updateHeaderButton(button, enabled = activeGrid?.headerEnabled) {
    setTableIconButton(button, "header", enabled ? "First row is header" : "Generated headers A-Z", "H", enabled ? "H" : "A-Z");
    button.setAttribute("aria-pressed", String(Boolean(enabled)));
  }

  function syncHeaderButtons() {
    document.querySelectorAll(".header-row-toggle").forEach((button) => {
      updateHeaderButton(button);
    });
  }

  function tableLabel(table) {
    const rows = table.querySelectorAll("tr").length;
    const columns = table.querySelector("tr")?.children.length || 0;
    return `${rows} rows x ${columns} columns`;
  }

  function tableToDelimited(table, options = {}) {
    const includeHeader = options.includeHeader !== false;
    const rows = Array.from(table.querySelectorAll("tr"));
    return rows
      .slice(includeHeader ? 0 : 1)
      .map((row) =>
        Array.from(row.children)
          .map((cell) => cell.textContent.replace(/\s+/g, " ").trim())
          .join("\t")
      )
      .join("\n");
  }

  function tableToRows(table) {
    return Array.from(table.querySelectorAll("tr")).map((row) =>
      Array.from(row.children).map((cell) => (
        cell.dataset.mdCellSource ?? cell.textContent.replace(/\s+/g, " ").trim()
      ))
    );
  }

  async function copyFromButton(button, text, options = {}) {
    const originalHtml = button.innerHTML;
    button.disabled = true;

    try {
      await copyText(text, options);
      button.textContent = options.append ? "Appended" : "Copied";
    } catch (error) {
      button.textContent = "Failed";
    }

    window.setTimeout(() => {
      button.disabled = false;
      button.innerHTML = originalHtml;
    }, 1200);
  }

  function setIconButton(button, label, type) {
    const download = type === "download";
    const tooltip = download
      ? `Download ${label}`
      : label === "Selection" ? "Copy selection" : label === "Body" ? "Copy body without header" : "Copy all";
    setTableIconButton(button, download ? "download" : label === "Selection" ? "selection" : "copy", tooltip, download ? "—" : "C", download ? label : label === "Selection" ? "" : label);
  }

  function setTableIconButton(button, icon, tooltip, shortcut = "—", badge = "") {
    button.classList.add("table-icon-button");
    button.innerHTML = `${tableIcon(icon)}${badge ? `<span class="table-icon-badge">${badge}</span>` : ""}`;
    button.dataset.tooltip = tooltip;
    button.dataset.shortcut = shortcut;
    button.setAttribute("aria-label", shortcut && shortcut !== "—" ? `${tooltip} (${shortcut})` : tooltip);
    button.removeAttribute("title");
  }

  function tableIcon(name) {
    const paths = {
      copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
      download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
      filter: '<path d="M4 5h16l-6 7v6l-4 2v-8Z"/>',
      "filter-live": '<path d="M4 5h16l-6 7v6l-4 2v-8Z"/><path d="M18 15v5M15.5 17.5h5"/>',
      fit: '<path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"/><path d="M9 12h6M12 9v6"/>',
      grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
      header: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v16"/>',
      number: '<path d="M10 3 8 21M16 3l-2 18M4 9h16M3 15h16"/>',
      selection: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
      wrap: '<path d="M4 6h13a4 4 0 0 1 0 8H9M12 11l-3 3 3 3M4 18h4"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.grid}</svg>`;
  }

  async function copyText(text, options = {}) {
    const output = await copyOutputText(text, options);
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

  window.MDViewerTabular = {
    decorateTables,
    clearActiveGrid,
    clearMarkdownTableSelection,
    detectKind,
    hasOpenMarkdownTableGrid,
    parseDelimited,
    getActiveGridText,
    renderDataGrid,
    renderDataGridRows,
    refreshOpenMarkdownTableGrid,
    rowsToMarkdownTable,
    selectAllActiveGrid,
    selectAllActiveMarkdownTable,
    openHoveredMarkdownTableGrid,
    setWrapEnabled,
    tableToDelimited,
    toggleHeaderRow,
    toggleMarkdownTableSelection,
    toggleNumberFormat,
    toggleWrap
  };
})();
