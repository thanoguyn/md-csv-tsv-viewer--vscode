(function () {
  const wrapStorageKey = "md-viewer-table-wrap";
  const filterRowStorageKey = "md-viewer-filter-row-visible";
  const filterModeStorageKey = "md-viewer-filter-mode";
  const numberFormatStorageKey = "md-viewer-number-format";
  const gridSelectionClass = "is-selected";
  const defaultColumnWidth = 160;
  const minColumnWidth = 144;
  const maxFitColumnWidth = 420;
  const maxLayoutColumnWidth = 640;
  const rowHeaderWidth = 48;
  let activeGrid = null;
  let gridContextMenu = null;
  let activeResize = null;
  let filterTimer = null;
  document.addEventListener("keydown", handleGridCopyShortcut);
  document.addEventListener("keydown", handleGridContextMenuKeyDown);
  document.addEventListener("click", hideGridContextMenu);
  document.addEventListener("scroll", hideGridContextMenu, true);
  document.addEventListener("mousemove", handleColumnResizeMove);
  document.addEventListener("mouseup", handleColumnResizeEnd);

  function detectKind(source, contentType) {
    const normalizedSource = String(source || "").toLowerCase().split(/[?#]/)[0];
    const normalizedType = String(contentType || "").toLowerCase();

    if (normalizedSource.endsWith(".csv") || normalizedType.includes("text/csv")) return "csv";
    if (normalizedSource.endsWith(".tsv") || normalizedType.includes("text/tab-separated-values")) return "tsv";
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

    tables.forEach((table) => {
      table.dataset.copyReady = "true";
      table.classList.toggle("is-wrapped", wrapEnabled);

      const shell = document.createElement("div");
      shell.className = "table-viewer";
      shell.classList.toggle("is-wrapped", wrapEnabled);

      const toolbar = document.createElement("div");
      toolbar.className = "table-toolbar";

      const label = document.createElement("span");
      label.textContent = tableLabel(table);

      const controls = document.createElement("div");
      controls.className = "table-controls";

      const wrapLabel = document.createElement("label");
      wrapLabel.className = "switch-control";
      wrapLabel.title = "Toggle table text wrapping";

      const wrapInput = document.createElement("input");
      wrapInput.type = "checkbox";
      wrapInput.className = "wrap-toggle-input";
      wrapInput.checked = wrapEnabled;
      wrapInput.addEventListener("change", () => {
        setWrapEnabled(wrapInput.checked, document);
      });

      const wrapText = document.createElement("span");
      wrapText.textContent = "Wrap";
      wrapLabel.append(wrapInput, wrapText);

      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "copy-table-button";
      setIconButton(copyButton, "All", "copy");
      copyButton.title = "Copy table as TSV";
      copyButton.addEventListener("click", (event) => copyFromButton(copyButton, tableToDelimited(table), { append: event.shiftKey }));

      const copyBodyButton = document.createElement("button");
      copyBodyButton.type = "button";
      copyBodyButton.className = "copy-table-button";
      setIconButton(copyBodyButton, "Body", "copy");
      copyBodyButton.title = "Copy table body without header";
      copyBodyButton.addEventListener("click", (event) => copyFromButton(copyBodyButton, tableToDelimited(table, { includeHeader: false }), { append: event.shiftKey }));

      const csvButton = document.createElement("button");
      csvButton.type = "button";
      csvButton.className = "copy-table-button";
      setIconButton(csvButton, "CSV", "download");
      csvButton.title = "Download table as CSV";
      csvButton.addEventListener("click", () => downloadRows(tableToRows(table), "csv"));

      const tsvButton = document.createElement("button");
      tsvButton.type = "button";
      tsvButton.className = "copy-table-button";
      setIconButton(tsvButton, "TSV", "download");
      tsvButton.title = "Download table as TSV";
      tsvButton.addEventListener("click", () => downloadRows(tableToRows(table), "tsv"));

      const gridButton = document.createElement("button");
      gridButton.type = "button";
      gridButton.className = "copy-table-button";
      gridButton.textContent = "Grid";
      gridButton.title = "Open table in fullscreen grid";
      gridButton.addEventListener("click", () => openTableGrid(table));

      const scroller = document.createElement("div");
      scroller.className = "table-scroll";

      table.parentNode.insertBefore(shell, table);
      shell.append(toolbar, scroller);
      toolbar.append(label, controls);
      controls.append(wrapLabel, gridButton, copyButton, copyBodyButton, csvButton, tsvButton);
      scroller.appendChild(table);
    });
  }

  function renderDataGrid(container, input, kind) {
    const delimiter = kind === "tsv" ? "\t" : ",";
    const rawRows = parseDelimited(input, delimiter);
    renderDataGridRows(container, rawRows);
  }

  function renderDataGridRows(container, rawRows) {
    const sourceRows = normalizeRows(rawRows);
    const numberFormat = getNumberFormat();
    const headerEnabled = true;
    const model = gridModelFromSourceRows(sourceRows, headerEnabled, numberFormat);
    activeGrid = {
      columnMeta: model.columnMeta,
      columns: model.columns,
      container,
      filterDrafts: {},
      filterMode: getFilterMode(),
      filterRowVisible: getFilterRowVisible(),
      filters: {},
      headerEnabled,
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

    const wrapLabel = document.createElement("label");
    wrapLabel.className = "switch-control";

    const wrapInput = document.createElement("input");
    wrapInput.type = "checkbox";
    wrapInput.className = "wrap-toggle-input";
    wrapInput.checked = getWrapState();
    wrapInput.addEventListener("change", () => {
      setWrapState(wrapInput.checked);
      container.classList.toggle("is-wrapped", wrapInput.checked);
    });

    const wrapText = document.createElement("span");
    wrapText.textContent = "Wrap";
    wrapLabel.append(wrapInput, wrapText);

    const filterModeLabel = document.createElement("label");
    filterModeLabel.className = "switch-control";
    filterModeLabel.title = "Filter while typing";

    const filterModeInput = document.createElement("input");
    filterModeInput.type = "checkbox";
    filterModeInput.checked = activeGrid.filterMode === "type";
    filterModeInput.addEventListener("change", () => {
      activeGrid.filterMode = filterModeInput.checked ? "type" : "change";
      setFilterMode(activeGrid.filterMode);
    });

    const filterModeText = document.createElement("span");
    filterModeText.textContent = "Filter on type";
    filterModeLabel.append(filterModeInput, filterModeText);

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
    headerButton.addEventListener("click", () => {
      updateHeaderButton(headerButton, toggleHeaderRow(container));
    });

    const fitButton = document.createElement("button");
    fitButton.type = "button";
    fitButton.textContent = "Fit";
    fitButton.title = "Fit columns to visible content";
    fitButton.addEventListener("click", () => fitColumnsToContent(container));

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    setIconButton(copyButton, "Selection", "copy");
    copyButton.title = "Copy selected range";
    copyButton.addEventListener("click", (event) => {
      const text = hasSelection() ? selectedGridText(container) : visibleGridText(container);
      copyFromButton(copyButton, text, { append: event.shiftKey });
    });

    const copyAllButton = document.createElement("button");
    copyAllButton.type = "button";
    setIconButton(copyAllButton, "All", "copy");
    copyAllButton.title = "Copy whole table with header";
    copyAllButton.addEventListener("click", (event) => copyFromButton(copyAllButton, gridText({ includeHeader: true }), { append: event.shiftKey }));

    const copyBodyButton = document.createElement("button");
    copyBodyButton.type = "button";
    setIconButton(copyBodyButton, "Body", "copy");
    copyBodyButton.title = "Copy table without header";
    copyBodyButton.addEventListener("click", (event) => copyFromButton(copyBodyButton, gridText({ includeHeader: false }), { append: event.shiftKey }));

    const downloadCsvButton = document.createElement("button");
    downloadCsvButton.type = "button";
    setIconButton(downloadCsvButton, "CSV", "download");
    downloadCsvButton.title = "Download as CSV";
    downloadCsvButton.addEventListener("click", () => downloadRows(gridRows({ includeHeader: true }), "csv"));

    const downloadTsvButton = document.createElement("button");
    downloadTsvButton.type = "button";
    setIconButton(downloadTsvButton, "TSV", "download");
    downloadTsvButton.title = "Download as TSV";
    downloadTsvButton.addEventListener("click", () => downloadRows(gridRows({ includeHeader: true }), "tsv"));

    actions.append(wrapLabel, filterModeLabel, numberFormatButton, headerButton, fitButton, copyButton, copyAllButton, copyBodyButton, downloadCsvButton, downloadTsvButton);
    chrome.append(summary, actions);

    const scroller = document.createElement("div");
    scroller.className = "grid-scroll";

    const table = document.createElement("table");
    table.className = "data-grid";
    table.addEventListener("mousedown", handleGridMouseDown);
    table.addEventListener("mouseover", handleGridMouseOver);
    table.addEventListener("contextmenu", handleGridContextMenu);
    document.addEventListener("mouseup", handleGridMouseUp);

    scroller.appendChild(table);
    container.append(chrome, scroller);
    renderGridTable(container);
    scheduleInitialColumnFit(container);
  }

  function clearActiveGrid() {
    hideGridContextMenu();
    activeGrid = null;
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

  function openTableGrid(table) {
    const previousGrid = activeGrid;
    const overlay = document.createElement("div");
    overlay.className = "grid-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const header = document.createElement("div");
    header.className = "grid-modal-header";

    const title = document.createElement("div");
    title.className = "grid-modal-title";
    title.textContent = "Markdown table";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Close";

    const gridHost = document.createElement("section");
    gridHost.className = "data-grid-view grid-modal-body";

    function close() {
      overlay.remove();
      activeGrid = previousGrid;
      document.body.classList.remove("has-grid-modal");
      document.removeEventListener("keydown", handleEscape);
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
    renderDataGridRows(gridHost, tableToRows(table));
    closeButton.focus();
  }

  function renderGridTable(container) {
    const table = container.querySelector(".data-grid");
    const summary = container.querySelector(".grid-summary");
    const visibleRows = getVisibleRows();

    table.innerHTML = "";
    table.appendChild(renderColGroup());
    table.append(renderGridHead(container), renderGridBody(visibleRows));
    applyGridTableWidth(table);
    summary.textContent = `${visibleRows.length} of ${activeGrid.rows.length} rows x ${activeGrid.columns.length} columns`;
    paintSelection(container);
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
      if (isNumericColumn(columnIndex)) th.classList.add("is-numeric");
      const headerContent = document.createElement("div");
      headerContent.className = "header-cell";

      const titleButton = document.createElement("button");
      titleButton.type = "button";
      titleButton.className = "column-title";
      titleButton.textContent = name || `Column ${columnIndex + 1}`;
      titleButton.title = "Select this column";
      titleButton.addEventListener("click", () => {
        selectColumn(container, columnIndex);
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

  function renderGridBody(rows) {
    const tbody = document.createElement("tbody");

    rows.forEach((row, rowIndex) => {
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

    return tbody;
  }

  function getVisibleRows() {
    const filters = Object.entries(activeGrid.filters).filter(([, value]) => value.trim());
    let rows = activeGrid.rows.filter((row) =>
      filters.every(([column, value]) => matchesFilter(row.cells[Number(column)] || "", value, Number(column)))
    );

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

  function selectColumn(container, columnIndex) {
    blurFocusedFilterInput();
    const lastRow = Math.max(0, getVisibleRows().length - 1);
    activeGrid.container = container;
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

  function handleGridMouseDown(event) {
    if (event.target.closest(".column-resize-handle")) return;
    hideGridContextMenu();

    const cell = event.target.closest("td");
    if (!cell || !activeGrid) return;
    if (event.button !== 0) return;

    event.preventDefault();
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
    if (!isCopy || !hasSelection() || !activeGrid.container || isTextInput(event.target)) return;

    event.preventDefault();
    copyText(selectedGridText(activeGrid.container, { normalizeNumbers: event.shiftKey }));
  }

  function handleGridContextMenu(event) {
    const cell = event.target.closest("td");
    const rowHeader = event.target.closest(".row-number-cell");
    if ((!cell && !rowHeader) || !activeGrid) return;

    event.preventDefault();
    blurFocusedFilterInput();
    const container = event.currentTarget.closest(".data-grid-view");
    activeGrid.container = container;

    if (cell) {
      const row = Number(cell.dataset.row);
      const column = Number(cell.dataset.column);
      if (!isCellSelected(row, column)) {
        selectSingleCell(container, row, column);
      }
    } else if (rowHeader) {
      const row = Number(rowHeader.dataset.row);
      if (!isRowSelected(row)) {
        selectSingleRow(container, row);
      }
    }

    showGridContextMenu(event.clientX, event.clientY, container);
  }

  function showGridContextMenu(clientX, clientY, container) {
    hideGridContextMenu();
    if (!hasSelection()) return;

    const menu = document.createElement("div");
    menu.className = "grid-context-menu";
    menu.setAttribute("role", "menu");

    const copyButton = gridContextMenuButton("Copy", () => selectedGridText(container));
    const copyNumbersButton = gridContextMenuButton("Copy US numbers", () => selectedGridText(container, { normalizeNumbers: true }));
    menu.append(copyButton, copyNumbersButton);
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
    const blocks = normalizedSelections().map(({ startRow, endRow, startColumn, endColumn }) => {
      const rows = [];
      for (let row = startRow; row <= endRow; row += 1) {
        const cells = [];
        for (let column = startColumn; column <= endColumn; column += 1) {
          const value = container.querySelector(`td[data-row="${row}"][data-column="${column}"]`)?.textContent || "";
          cells.push(options.normalizeNumbers ? normalizeCellForUsCopy(value, column) : value);
        }
        rows.push(cells.join("\t"));
      }
      return rows.join("\n");
    });

    return blocks.join("\n\n");
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

  function visibleGridText(container) {
    return Array.from(container.querySelectorAll("tbody tr"))
      .map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent).join("\t"))
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
    return rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] || ""));
  }

  function gridModelFromSourceRows(sourceRows, headerEnabled, numberFormat) {
    const columnCount = sourceRows[0]?.length || 0;
    const columns = headerEnabled && sourceRows.length
      ? sourceRows[0]
      : Array.from({ length: columnCount }, (_, index) => excelColumnName(index));
    const bodyRows = headerEnabled ? sourceRows.slice(1) : sourceRows;
    const widthRows = [columns, ...bodyRows];
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
    root.querySelectorAll(".table-viewer, table[data-copy-ready], .code-viewer, .mermaid-viewer, .source-view").forEach((element) => {
      element.classList.toggle("is-wrapped", wrapEnabled);
    });
    root.querySelectorAll(".wrap-toggle-input").forEach((input) => {
      input.checked = wrapEnabled;
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
    button.textContent = normalized;
    button.title = `Number parsing: ${normalized}. Press U to switch Auto/VN/US.`;
    button.setAttribute("aria-label", `Number format ${normalized}`);
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
    button.textContent = enabled ? "Header" : "A-Z";
    button.title = enabled ? "First row is header. Press H to switch." : "Generated headers A-Z. Press H to switch.";
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
      Array.from(row.children).map((cell) => cell.textContent.replace(/\s+/g, " ").trim())
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
    const icon = type === "download" ? "↓" : "⧉";
    button.innerHTML = `<span class="button-icon" aria-hidden="true">${icon}</span><span>${label}</span>`;
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
    detectKind,
    parseDelimited,
    getActiveGridText,
    renderDataGrid,
    renderDataGridRows,
    selectAllActiveGrid,
    setWrapEnabled,
    tableToDelimited,
    toggleHeaderRow,
    toggleNumberFormat,
    toggleWrap
  };
})();
