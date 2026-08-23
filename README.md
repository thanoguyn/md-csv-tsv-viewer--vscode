# MD/CSV/TSV Viewer for VS Code

A VS Code extension to view and edit Markdown, CSV, and TSV files using a Viewer/WYSIWYG custom editor and Raw Edit via VS Code's default text editor.

## Supported File Formats

- Markdown: `.md`, `.markdown`, `.mdown`, `.mkd`
- Data Tables: `.csv`, `.tsv`

The above file formats are configured by default to open with `MD Viewer` via `workbench.editorAssociations`.

## Installation from VSIX

1. Open VS Code.
2. Run the command `Extensions: Install from VSIX...`.
3. Select the `mdviewer-vscode-0.1.8.vsix` file.
4. Reload VS Code if prompted.

After installation, opening any supported file or using Quick Open will launch it in the default viewer.

## Three Modes

- `1` — Default Viewer.
- `2`, `E`, or `S` — Raw Edit using VS Code's default text editor.
- `3` — WYSIWYG editor for Markdown to edit rendered content directly.
- All edits utilize VS Code's document model, maintaining dirty state, undo/redo history, and saving with `Cmd+S` / `Ctrl+S`.
- You can always use the `Open as Text` command to switch back to VS Code's native text editor.

## General Features

- Default viewer for Markdown, CSV, and TSV files.
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

## Search

- `Cmd+F` on macOS or `Ctrl+F` on Windows/Linux opens the search bar.
- Type keywords to highlight all matches in the active viewer.
- Press `Enter` to jump to the next match.
- Press `Shift+Enter` to jump to the previous match.
- Press `Escape` to close the search bar.
- Search works in Markdown preview and CSV/TSV grid; Raw/WYSIWYG modes use native editor/webview search capabilities.

## Export PDF

- Click the `PDF` button or press `P`.
- `Print-friendly PDF` button or `Shift+P` toggles between A4 white-background print layout and current theme appearance.
- PDF is generated from the current preview DOM using `html2canvas` and `jsPDF`.
- Markdown Viewer/WYSIWYG and CSV/TSV grids are exported according to the current view layout.
- UI elements like toolbars, TOC, copy buttons, filter rows, and search highlights are automatically excluded from the PDF output.

## Keyboard Shortcuts

| Shortcut | Description |
| --- | --- |
| `1` / `3` | Toggle Viewer / WYSIWYG editor |
| `Cmd+E` / `Ctrl+E` | Return from WYSIWYG Edit to Viewer |
| `2` / `E` / `S` | Open Raw Edit using default VS Code editor |
| `Cmd+Alt+V` | macOS: Reopen viewer from text editor |
| `Ctrl+Alt+V` | Windows/Linux: Reopen viewer from text editor |
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
| `MD Viewer: Open as Text` | Open current file using default text editor |

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