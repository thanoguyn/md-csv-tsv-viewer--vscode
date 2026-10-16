# MD/CSV/TSV/JSONL Viewer for VS Code

A VS Code extension for rendered Markdown, interactive CSV/TSV tables, and native-editor CSV/TSV/JSONL row previews.

## Supported File Formats

- Markdown: `.md`, `.markdown`, `.mdown`, `.mkd`
- Data Tables: `.csv`, `.tsv`
- JSON Lines: `.jsonl`, `.ndjson`

Markdown, CSV, and TSV open with `MD Viewer`. JSONL and NDJSON deliberately open in VS Code's native code editor.

## Installation from VSIX

1. Open VS Code.
2. Run the command `Extensions: Install from VSIX...`.
3. Select the `mdviewer-vscode-0.1.12.vsix` file.
4. Reload VS Code if prompted.

After installation, Markdown/CSV/TSV launch in the custom viewer while JSONL/NDJSON retain the normal VS Code editing interface.

## Viewer Modes

- `1` — Default Viewer; from JSONL Table Viewer, return to the native code editor and open Row Preview beside it.
- `2`, `E`, or `S` — Raw Edit using VS Code's default text editor.
- `3` — WYSIWYG editor for Markdown, or Table view for JSONL/NDJSON.
- All edits utilize VS Code's document model, maintaining dirty state, undo/redo history, and saving with `Cmd+S` / `Ctrl+S`.
- You can always use the `Open as Text` command to switch back to VS Code's native text editor.

## General Features

- Default viewer for Markdown, CSV, and TSV; JSONL/NDJSON use VS Code's native editor by default.
- Toggle full width mode using the `Full width` button or the `F` key.
- Icon-based toolbar; hover or focus to view feature titles and keyboard shortcuts.
- Toggle light/dark theme using the theme button or the `M` key.
- Toggle GitHub-style Markdown theme using the style button or the `G` key.
- Open changes from Source Control in VS Code's built-in text diff editor while regular files continue to use MD Viewer.
- Browser-like search using `Cmd+F` or `Ctrl+F`.
- Copy currently viewed content with `C`.
- Copy source content with `Shift+C`.
- Select all viewer content or table data with `Cmd+A` or `Ctrl+A`.
- Save a copy of source file using the `Save copy` button or the `D` key.
- Export to PDF using the `PDF` button or the `P` key.
- Toggle toolbar visibility with `Ctrl+B`.
- Toast notifications for copy, save, and operation success/failure status

## Markdown Viewer

- Renders GFM/CommonMark using `marked`, including nested lists, task lists, Setext headings, reference links/images, autolinks, code fences (backticks or `~~~`), and inline HTML.
- Rendered HTML is sanitized with `DOMPurify`; VS Code webview Content Security Policy (CSP) acts as an extra layer of protection.
- Supports Mermaid diagrams.
- Mermaid rendering is debounced and discards stale renders on rapid content updates; diagrams automatically match the viewer's active theme.
- Interactive table support in Markdown.
- Sticky Table of Contents (TOC) pinned to the right of the content when space allows.
- Toggle TOC using the `TOC` button or the `T` key.
- TOC automatically updates based on scroll position and auto-expands child headings (up to 3 levels).
- Raw Edit opens VS Code's default text editor; no internal text editor panel.
- WYSIWYG editing with block menus and Markdown-style input rules for headings, lists, quotes, and code blocks.
- Hover over headings to display copy and select action icons.
- Click the heading copy icon to copy the entire Markdown section.
- `Shift+Click` the heading copy icon to append to previous clipboard content.
- Click the heading select icon to highlight all child content under the heading.
- Code blocks and Mermaid diagrams feature toolbar icons for word wrap and copy; hover shows titles and shortcuts, `Shift+Click` appends.
- Markdown tables support copying full table, copying table body, exporting to CSV/TSV, and editing in grid mode.
- Double-click a Markdown table cell or click `Grid` to edit; changes write back directly to the corresponding Markdown table in the source file.

## CSV/TSV Viewer

- CSV and TSV files open in an interactive grid view.
- From the native text editor, click the `{}` editor-title button or press `Cmd/Ctrl+Alt+J` to open a JSONC Row Preview beside the source; moving the cursor updates it automatically.
- The CSV/TSV Row Preview maps values to the first-row column names. The header row itself is previewed as an array.
- Click the Table Viewer title button or press `Cmd/Ctrl+Alt+V` to reopen the full table as a normal tab in the current editor group.
- Automatically parses file data into tables.
- Toggle word wrap with `W`.
- Toggle first row as header with `H`.
- Switch number parsing formats (`Auto`, `VN`, `US`) with `U`.
- Column sorting capabilities.
- Filter row support for per-column filtering.
- Select cells, rows, columns, or rectangular cell ranges.
- Double-click a cell to edit; double-click a column header to rename.
- Paste multi-row/multi-column data from Excel into selected cells, automatically expanding the grid if necessary.
- Right-click cell or column header to insert/delete columns before or after.
- Right-click cell or row number to insert/delete rows above or below.
- `Cmd/Ctrl+Click` multiple non-adjacent columns and copy to paste into Excel as a contiguous block.
- Hold `Shift` when selecting rows to expand selection.
- Copy selection, full table, or table body.
- `Shift+Click` copy actions to append to previous clipboard content.
- Grid context menu offers standard copy and US-formatted number copy.
- Export tables directly to CSV or TSV.

## JSONL/NDJSON Viewer

- JSONL/NDJSON opens in VS Code's native code editor, matching the source extension's workflow.
- Click the `{}` editor-title button or press `Cmd/Ctrl+Alt+J` to open a read-only, pretty-printed JSONC preview beside the source editor.
- Click the Table Viewer title button or press `Cmd/Ctrl+Alt+V` to open the full JSONL table as a normal tab in the current editor group; `{}` remains dedicated to the active-row preview.
- Moving the source cursor to another line updates the preview automatically after a short debounce.
- Invalid or empty lines show a diagnostic comment and preserve the original source line.
- Use `Cmd/Ctrl+Alt+]`, `Cmd/Ctrl+Alt+[`, or `JSONL: Preview Row by Number…` for explicit navigation.
- Run `MD Viewer: Open in MD Viewer` when a full Table Viewer is needed; pressing `1` there returns to native code + side preview.
- Table mode combines object keys into columns, flattens nested objects to dotted paths such as `user.name`, and preserves arrays as JSON cell values.
- Invalid rows remain visible in Table mode through `$error` and `$raw` columns.
- JSONL Table mode is intentionally read-only so editing cannot silently change JSON types or nested structure; Raw Edit remains available with `2`, `E`, or `S`.
- The JSONL viewer is based on the row-preview approach from [austinulfers/jsonl-viewer](https://github.com/austinulfers/jsonl-viewer); its MIT license is included under `media/vendor/jsonl-viewer/`.

## Search

- `Cmd+F` on macOS or `Ctrl+F` on Windows/Linux opens the search bar.
- Type keywords to highlight all matches in the active viewer.
- Press `Enter` to jump to the next match.
- Press `Shift+Enter` to jump to the previous match.
- Press `Escape` to close the search bar.
- Search uses VS Code's native editor for JSONL source/row preview and works in Markdown plus the currently rendered CSV/TSV/JSONL table window.

## Large data files

- CSV, TSV, and JSONL tables automatically use virtual rows when `row count × column count > 20,000`.
- Only the visible viewport plus 24 overscan rows on each side is present in the DOM; scrolling renders the next window on demand.
- Selection and copy operations read from the full data model, including rows outside the rendered window.
- Native JSONL Row Preview renders only the selected line. For files above VS Code's text-model limit, explicit Previous/Next/Go to Row commands stream the requested line directly from disk.
- Table parsing, sorting, filtering, and exporting still operate on an in-memory model. Virtual rows avoid a huge DOM, but opening the optional Table Viewer still requires VS Code to expose the full text document.

## Export PDF

- Click the `PDF` button or press `P`.
- `Print-friendly PDF` button or `Shift+P` toggles between A4 white-background print layout and current theme appearance.
- PDF is generated from the current preview DOM using `html2canvas` and `jsPDF`.
- Markdown Viewer/WYSIWYG and CSV/TSV grids are exported according to the current view layout.
- UI elements like toolbars, TOC, copy buttons, filter rows, and search highlights are automatically excluded from the PDF output.

## Keyboard Shortcuts

| Shortcut | Description |
| --- | --- |
| `1` / `3` | Viewer / Markdown WYSIWYG or JSONL Table mode |
| `Cmd+E` / `Ctrl+E` | Return from WYSIWYG Edit to Viewer |
| `2` / `E` / `S` | Open Raw Edit using default VS Code editor |
| `Cmd+Alt+V` | macOS: Reopen viewer from text editor |
| `Ctrl+Alt+V` | Windows/Linux: Reopen viewer from text editor |
| `Cmd/Ctrl+Alt+J` | Open CSV/TSV/JSONL Row Preview beside the native editor |
| `Cmd/Ctrl+Alt+]` | Preview the next JSONL source row |
| `Cmd/Ctrl+Alt+[` | Preview the previous JSONL source row |
| `Cmd+F` / `Ctrl+F` | Open search bar |
| `Enter` (in search) | Next search match |
| `Shift+Enter` (in search) | Previous search match |
| `Escape` | Close search bar, help modal, or context menu |
| `Cmd+A` / `Ctrl+A` | Select all content in viewer or grid |
| `Ctrl+B` | Toggle toolbar visibility |
| `F` | Toggle full width mode |
| `T` | Toggle TOC in Markdown preview |
| `M` | Toggle light/dark theme |
| `G` | Toggle GitHub-style Markdown theme |
| `?` | Open help modal |
| `W` | Toggle line wrapping for code, tables, or grid |
| `U` | Switch number parsing format (`Auto` / `VN` / `US`) |
| `H` | Toggle first row as header in CSV/TSV |
| `D` | Save copy of source file |
| `P` | Export PDF |
| `Shift+P` | Toggle PDF print-friendly / current appearance mode |
| `C` | Copy currently viewed content |
| `Shift+C` | Copy source content |
| `Shift+Click` copy | Append to previous clipboard content |

## VS Code Commands

| Command | Description |
| --- | --- |
| `MD Viewer: Open in MD Viewer` | Open current file using MD Viewer |
| `MD Viewer: Open Table Viewer` | Open CSV/TSV/JSONL as a normal table tab |
| `CSV/TSV: Preview Row` | Open/update the CSV/TSV Row Preview beside the native editor |
| `MD Viewer: Open as Text` | Open current file using default text editor |
| `JSONL: Preview Row` | Open/update the side preview for the cursor row |
| `JSONL: Preview Next Row` | Step the preview to the next row |
| `JSONL: Preview Previous Row` | Step the preview to the previous row |
| `JSONL: Preview Row by Number…` | Jump the preview to a 1-based source row |

## Development

Install dependencies:

```sh
npm install
```

Run lint / syntax checks:

```sh
npm run lint
```

Package VSIX:

```sh
npx --yes @vscode/vsce package
```

## Debug extension:

1. Open this workspace in VS Code.
2. Press `F5`.
3. A VS Code Extension Development Host window will launch to test the extension.

## License

MIT. See file `LICENSE`.
