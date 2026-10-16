const vscode = require("vscode");
const path = require("path");
const { registerJsonlPreview } = require("./jsonlPreview");
const { registerDelimitedRowPreview } = require("./tabularRowPreview");

const VIEW_TYPE = "mdviewer.viewer";
const JSONL_TABLE_VIEW_TYPE = "mdviewer.jsonlTableViewer";

function activate(context) {
  const provider = new MdViewerEditorProvider(context);
  const providerOptions = {
    supportsMultipleEditorsPerDocument: true,
    webviewOptions: {
      retainContextWhenHidden: true
    }
  };

  registerJsonlPreview(context);
  registerDelimitedRowPreview(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, providerOptions),
    vscode.window.registerCustomEditorProvider(JSONL_TABLE_VIEW_TYPE, provider, providerOptions),
    vscode.commands.registerCommand("mdviewer.openView", async (uri) => {
      await openView(uri);
    }),
    vscode.commands.registerCommand("mdviewer.openTablePreview", async (uri) => {
      await openView(uri);
    }),
    vscode.commands.registerCommand("mdviewer.openEdit", async (uri) => {
      await openEdit(uri);
    })
  );
}

async function openView(uri) {
  const target = uri || vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    vscode.window.showWarningMessage("Open a supported MD Viewer file first.");
    return;
  }

  const viewType = /\.(jsonl|ndjson)$/i.test(target.path) ? JSONL_TABLE_VIEW_TYPE : VIEW_TYPE;
  await vscode.commands.executeCommand("vscode.openWith", target, viewType, {
    preview: false,
    viewColumn: vscode.window.activeTextEditor?.viewColumn
  });
}

async function openEdit(uri, viewColumn) {
  const target = uri || vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    vscode.window.showWarningMessage("No document is available to edit.");
    return;
  }

  const document = await vscode.workspace.openTextDocument(target);
  return vscode.window.showTextDocument(document, {
    preview: false,
    viewColumn: viewColumn || vscode.ViewColumn.Active
  });
}

class MdViewerEditorProvider {
  constructor(context) {
    this.context = context;
  }

  async resolveCustomTextEditor(document, webviewPanel) {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
        ...localResourceRootsForDocument(document.uri)
      ]
    };

    webviewPanel.webview.html = this.htmlForWebview(webviewPanel.webview, document);

    const disposables = [];
    let applyingWebviewEditCount = 0;
    let pendingDiskRefresh = null;
    const applyWebviewEdit = async (text, save = false) => {
      const nextText = String(text ?? "");
      applyingWebviewEditCount += 1;
      try {
        const applied = await updateDocument(document, nextText);
        if (applied && save) await document.save();
        return applied;
      } finally {
        applyingWebviewEditCount = Math.max(0, applyingWebviewEditCount - 1);
      }
    };
    const scheduleDiskRefresh = () => {
      if (pendingDiskRefresh) clearTimeout(pendingDiskRefresh);
      pendingDiskRefresh = setTimeout(async () => {
        pendingDiskRefresh = null;
        await postDocumentFromDisk(webviewPanel.webview, document.uri, document.languageId);
      }, 75);
    };

    disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) return;
      // Replacing the WYSIWYG HTML with its own edit echo resets the browser
      // selection. Other editor instances still receive this document change.
      if (applyingWebviewEditCount > 0) return;
      postDocument(webviewPanel.webview, event.document);
    }));

    const fileWatcher = createDocumentWatcher(document.uri);
    if (fileWatcher) {
      disposables.push(
        fileWatcher,
        fileWatcher.onDidChange(scheduleDiskRefresh),
        fileWatcher.onDidCreate(scheduleDiskRefresh)
      );
    }

    webviewPanel.onDidDispose(() => {
      if (pendingDiskRefresh) clearTimeout(pendingDiskRefresh);
      disposables.forEach((disposable) => disposable.dispose());
    });

    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "openEdit") {
        await openEdit(document.uri, webviewPanel.viewColumn);
      } else if (message?.type === "openJsonlPreview") {
        await openEdit(document.uri, webviewPanel.viewColumn);
        await vscode.commands.executeCommand("jsonlViewer.previewLine", document.uri);
      } else if (message?.type === "focusViewer") {
        webviewPanel.reveal(webviewPanel.viewColumn, false);
        await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
      } else if (message?.type === "saveCopy") {
        await saveCopy(document, message);
      } else if (message?.type === "exportPdf") {
        await exportPdf(document, message);
      } else if (message?.type === "updateDocument") {
        await applyWebviewEdit(message.text);
      } else if (message?.type === "saveDocument") {
        await applyWebviewEdit(message.text, true);
      } else if (message?.type === "info") {
        vscode.window.showInformationMessage(String(message.message || ""));
      } else if (message?.type === "error") {
        vscode.window.showErrorMessage(String(message.message || "MD Viewer error"));
      }
    });
  }

  htmlForWebview(webview, document) {
    const nonce = randomNonce();
    const media = (...parts) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", ...parts));
    const initialDocument = {
      text: document.getText(),
      meta: displayMeta(document.uri),
      kind: detectKind(document.uri.fsPath || document.uri.toString(), document.languageId),
      filename: filenameFromUri(document.uri),
      readonly: !isEditableDocument(document)
    };
    const assets = {
      html2canvas: String(media("vendor", "pdf", "html2canvas.min.js")),
      jspdf: String(media("vendor", "pdf", "jspdf.umd.min.js"))
    };

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">
    <title>MD Viewer</title>
    <link rel="stylesheet" href="${media("viewer.css")}">
  </head>
  <body>
    <div class="app-shell">
      <header class="toolbar">
        <div class="toolbar-title">
          <h1>MD Viewer</h1>
          <p id="documentMeta"></p>
        </div>
        <div class="actions">
          <div class="mode-switch" role="radiogroup" aria-label="View mode">
            <button id="modeViewer" class="toolbar-icon-button mode-button" type="button" role="radio" aria-checked="true" data-mode="viewer" data-tooltip="Viewer" data-shortcut="1 / ⌘/Ctrl+E in Edit">${toolbarIcon("eye")}</button>
            <button id="modeRaw" class="toolbar-icon-button mode-button" type="button" role="radio" aria-checked="false" data-mode="external" data-tooltip="Open in VS Code text editor" data-shortcut="2 / E">${toolbarIcon("code")}</button>
            <button id="modeTable" class="toolbar-icon-button mode-button" type="button" role="radio" aria-checked="false" data-mode="table" data-tooltip="JSONL table view" data-shortcut="3" hidden>${toolbarIcon("grid")}</button>
            <button id="modeWysiwyg" class="toolbar-icon-button mode-button" type="button" role="radio" aria-checked="false" data-mode="wysiwyg" data-tooltip="WYSIWYG editor" data-shortcut="3">${toolbarIcon("edit")}</button>
          </div>
          <span class="toolbar-divider" aria-hidden="true"></span>
          <button id="toggleFullWidth" class="toolbar-icon-button" type="button" aria-pressed="false" data-tooltip="Full width" data-shortcut="F">${toolbarIcon("expand")}</button>
          <button id="toggleToc" class="toolbar-icon-button" type="button" aria-pressed="false" data-tooltip="Table of contents" data-shortcut="T">${toolbarIcon("list")}</button>
          <button id="toggleGithubStyle" class="toolbar-icon-button" type="button" aria-pressed="false" data-tooltip="GitHub Markdown style" data-shortcut="G">${toolbarIcon("style")}</button>
          <button id="downloadDocument" class="toolbar-icon-button" type="button" data-tooltip="Save a copy" data-shortcut="D">${toolbarIcon("download")}</button>
          <button id="togglePrintPdf" class="toolbar-icon-button" type="button" aria-pressed="true" data-tooltip="Print-friendly PDF" data-shortcut="Shift+P">${toolbarIcon("print")}</button>
          <button id="downloadPdf" class="toolbar-icon-button" type="button" data-tooltip="Export PDF" data-shortcut="P">${toolbarIcon("file")}</button>
          <button id="showHelp" class="toolbar-icon-button" type="button" data-tooltip="Help" data-shortcut="?">${toolbarIcon("help")}</button>
          <button id="toggleTheme" class="toolbar-icon-button" type="button" data-tooltip="Toggle theme" data-shortcut="M">${toolbarIcon("theme")}</button>
        </div>
      </header>

      <main id="dropZone" class="workspace">
        <article id="preview" class="markdown-body" hidden></article>
        <section id="jsonlView" class="jsonl-view" hidden></section>
        <section id="dataGrid" class="data-grid-view" hidden></section>
        <section id="wysiwygView" class="wysiwyg-view" hidden>
          <div class="wysiwyg-toolbar" role="toolbar" aria-label="Rich text formatting">
            <button type="button" data-format="bold" data-tooltip="Bold" data-shortcut="⌘/Ctrl+B"><strong>B</strong></button>
            <button type="button" data-format="italic" data-tooltip="Italic" data-shortcut="⌘/Ctrl+I"><em>I</em></button>
            <button id="wysiwygBlockMenuButton" class="wysiwyg-block-menu-button" type="button" data-block-menu="true" data-tooltip="Block type" data-shortcut="—">P⌄</button>
            <button type="button" data-format="insertUnorderedList" data-tooltip="Bullet list" data-shortcut="—">${toolbarIcon("bullets")}</button>
            <button type="button" data-format="insertOrderedList" data-tooltip="Numbered list" data-shortcut="—">${toolbarIcon("numbers")}</button>
            <button type="button" data-format="createLink" data-tooltip="Link" data-shortcut="⌘/Ctrl+K">${toolbarIcon("link")}</button>
          </div>
          <article id="wysiwygEditor" class="markdown-body wysiwyg-editor" contenteditable="true" role="textbox" aria-multiline="true"></article>
        </section>
      </main>
    </div>

    <script nonce="${nonce}">
      window.__MD_VIEWER_INITIAL__ = ${safeJson(initialDocument)};
      window.__MD_VIEWER_ASSETS__ = ${safeJson(assets)};
      window.__MD_VIEWER_BASE_URI__ = ${safeJson(webviewBaseUriForDocument(webview, document.uri))};
    </script>
    <script nonce="${nonce}" src="${media("vendor", "markdown", "marked.umd.js")}"></script>
    <script nonce="${nonce}" src="${media("vendor", "markdown", "purify.min.js")}"></script>
    <script nonce="${nonce}" src="${media("markdown.js")}"></script>
    <script nonce="${nonce}" src="${media("tabular.js")}"></script>
    <script nonce="${nonce}" src="${media("jsonl.js")}"></script>
    <script nonce="${nonce}" src="${media("vendor", "mermaid", "mermaid.min.js")}"></script>
    <script nonce="${nonce}" src="${media("markdownEnhancer.js")}"></script>
    <script nonce="${nonce}" src="${media("vscodeViewer.js")}"></script>
  </body>
</html>`;
  }
}

async function updateDocument(document, nextText) {
  if (!isEditableDocument(document)) {
    vscode.window.showWarningMessage("This side of the diff is read-only.");
    return false;
  }

  const text = String(nextText ?? "");
  if (text === document.getText()) return true;

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) vscode.window.showErrorMessage("MD Viewer could not apply the edit.");
  return applied;
}

function isEditableDocument(document) {
  return document.uri.scheme !== "git" && !document.isClosed;
}

function toolbarIcon(name) {
  const paths = {
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    code: '<path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/>',
    edit: '<path d="M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    expand: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/><path d="m3 8 6-6M21 8l-6-6M3 16l6 6M21 16l-6 6"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    file: '<path d="M6 2h8l4 4v16H6Z"/><path d="M14 2v5h5M9 13h6M9 17h6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.5 2.1c-.8.4-1.3 1-1.3 1.9M12 17h.01"/>',
    theme: '<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/>',
    bullets: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    numbers: '<path d="M10 6h10M10 12h10M10 18h10M4 5h1v3M4 11h2l-2 3h2M4 17h2l-2 2h2"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"/>',
    style: '<path d="M4 20c2.8 0 4.5-1.2 4.5-3.5 0-1.4-1-2.5-2.5-2.5S3.5 15.2 3.5 17c0 1 .2 2 .5 3Z"/><path d="m8 14 8.8-8.8a2.1 2.1 0 0 1 3 3L11 17"/><path d="m14.5 7.5 3 3"/>',
    print: '<path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7Z"/><path d="M17 11h.01"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.help}</svg>`;
}

async function saveCopy(document, message) {
  const filename = safeFilename(message.filename || filenameFromUri(document.uri) || "document.md");
  const target = await vscode.window.showSaveDialog({
    defaultUri: defaultUriForCopy(document.uri, filename)
  });

  if (!target) return;

  const bytes = Buffer.from(String(message.text ?? document.getText()), "utf8");
  await vscode.workspace.fs.writeFile(target, bytes);
  vscode.window.showInformationMessage(`Saved ${filename}`);
}

async function exportPdf(document, message) {
  const filename = ensureExtension(safeFilename(message.filename || filenameFromUri(document.uri) || "document.pdf"), "pdf");
  const target = await vscode.window.showSaveDialog({
    defaultUri: defaultUriForCopy(document.uri, filename),
    filters: {
      "PDF files": ["pdf"]
    }
  });

  if (!target) return;

  const pdfBase64 = String(message.pdfBase64 || "");
  if (!pdfBase64) {
    vscode.window.showErrorMessage("No PDF data was generated.");
    return;
  }

  const pdf = Buffer.from(pdfBase64, "base64");
  await vscode.workspace.fs.writeFile(target, pdf);
  vscode.window.showInformationMessage(`Saved ${filename}`);
}

function postDocument(webview, document) {
  postDocumentText(webview, {
    uri: document.uri,
    languageId: document.languageId,
    text: document.getText()
  });
}

async function postDocumentFromDisk(webview, uri, languageId) {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    postDocumentText(webview, {
      uri,
      languageId,
      text: Buffer.from(bytes).toString("utf8")
    });
  } catch (error) {
    vscode.window.showWarningMessage(`MD Viewer could not refresh ${filenameFromUri(uri)}.`);
  }
}

function postDocumentText(webview, documentInfo) {
  webview.postMessage({
    type: "documentUpdate",
    text: documentInfo.text,
    meta: displayMeta(documentInfo.uri),
    kind: detectKind(documentInfo.uri.fsPath || documentInfo.uri.toString(), documentInfo.languageId),
    filename: filenameFromUri(documentInfo.uri),
    readonly: documentInfo.uri.scheme === "git"
  });
}

function localResourceRootsForDocument(uri) {
  if (!uri.fsPath) return [];
  return [vscode.Uri.file(path.dirname(uri.fsPath))];
}

function webviewBaseUriForDocument(webview, uri) {
  if (!uri.fsPath) return "";
  const directoryPath = path.dirname(uri.fsPath);
  const directoryUri = vscode.Uri.file(directoryPath.endsWith(path.sep) ? directoryPath : `${directoryPath}${path.sep}`);
  const baseUri = String(webview.asWebviewUri(directoryUri));
  return baseUri.endsWith("/") ? baseUri : `${baseUri}/`;
}

function createDocumentWatcher(uri) {
  if (uri.scheme !== "file" || !uri.fsPath) return null;

  const dirname = path.dirname(uri.fsPath);
  const basename = path.basename(uri.fsPath);
  return vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(dirname), escapeGlob(basename)),
    false,
    false,
    true
  );
}

function escapeGlob(value) {
  return String(value).replace(/[\\{}[\]*?]/g, (match) => `\\${match}`);
}

function detectKind(source, languageId) {
  const normalizedSource = String(source || "").toLowerCase().split(/[?#]/)[0];
  const normalizedLanguage = String(languageId || "").toLowerCase();

  if (normalizedSource.endsWith(".csv") || normalizedLanguage === "csv") return "csv";
  if (normalizedSource.endsWith(".tsv") || normalizedLanguage === "tsv") return "tsv";
  if (/\.(jsonl|ndjson)$/.test(normalizedSource) || normalizedLanguage === "jsonl" || normalizedLanguage === "ndjson") return "jsonl";
  if (/\.(md|markdown|mdown|mkd)$/.test(normalizedSource) || normalizedLanguage === "markdown") return "markdown";
  return "markdown";
}

function filenameFromUri(uri) {
  return uri.path.split("/").filter(Boolean).pop() || "document";
}

function displayMeta(uri) {
  const location = uri.fsPath || uri.toString();
  if (uri.scheme !== "git") return location;

  try {
    const revision = JSON.parse(uri.query || "{}").ref;
    return `${location} · Git ${revision || "revision"} · read-only`;
  } catch (error) {
    return `${location} · Git revision · read-only`;
  }
}

function defaultUriForCopy(uri, filename) {
  const path = uri.path || "";
  const slash = path.lastIndexOf("/");
  const nextPath = slash >= 0 ? `${path.slice(0, slash + 1)}${filename}` : `/${filename}`;
  return uri.with({ path: nextPath });
}

function safeFilename(value) {
  return String(value || "document")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "document";
}

function ensureExtension(filename, extension) {
  return new RegExp(`\\.${extension}$`, "i").test(filename) ? filename : `${filename}.${extension}`;
}

function randomNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += chars[Math.floor(Math.random() * chars.length)];
  }
  return nonce;
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
