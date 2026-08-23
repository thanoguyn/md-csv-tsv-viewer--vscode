const vscode = require("vscode");
const path = require("path");

const VIEW_TYPE = "mdviewer.viewer";

function activate(context) {
  const provider = new MdViewerEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }),
    vscode.commands.registerCommand("mdviewer.openView", async (uri) => {
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

  await vscode.commands.executeCommand("vscode.openWith", target, VIEW_TYPE, {
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
  await vscode.window.showTextDocument(document, {
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
    let pendingDiskRefresh = null;
    const scheduleDiskRefresh = () => {
      if (pendingDiskRefresh) clearTimeout(pendingDiskRefresh);
      pendingDiskRefresh = setTimeout(async () => {
        pendingDiskRefresh = null;
        await postDocumentFromDisk(webviewPanel.webview, document.uri, document.languageId);
      }, 75);
    };

    disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) return;
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
      } else if (message?.type === "focusViewer") {
        webviewPanel.reveal(webviewPanel.viewColumn, false);
        await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
      } else if (message?.type === "saveCopy") {
        await saveCopy(document, message);
      } else if (message?.type === "exportPdf") {
        await exportPdf(document, message);
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
      meta: document.uri.fsPath || document.uri.toString(),
      kind: detectKind(document.uri.fsPath || document.uri.toString(), document.languageId),
      filename: filenameFromUri(document.uri)
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
          <button id="openEdit" type="button" title="Open as text editor (E)">Edit</button>
          <label class="switch-control toolbar-switch" title="Toggle full width">
            <input id="toggleFullWidth" type="checkbox">
            <span>Full width</span>
          </label>
          <label class="switch-control toolbar-switch" title="Toggle source view">
            <input id="toggleSource" type="checkbox">
            <span>Source</span>
          </label>
          <label class="switch-control toolbar-switch" title="Toggle table of contents">
            <input id="toggleToc" type="checkbox">
            <span>TOC</span>
          </label>
          <button id="downloadDocument" type="button" title="Save a copy">Save copy</button>
          <button id="downloadPdf" type="button" title="Export current preview as PDF">PDF</button>
          <button id="showHelp" type="button" title="Show help">Help</button>
          <button id="toggleTheme" type="button" title="Toggle theme">Theme</button>
        </div>
      </header>

      <main id="dropZone" class="workspace">
        <article id="preview" class="markdown-body" hidden></article>
        <section id="dataGrid" class="data-grid-view" hidden></section>
        <section id="sourceView" class="source-view" hidden>
          <pre><code id="sourceCode"></code></pre>
        </section>
      </main>
    </div>

    <script nonce="${nonce}">
      window.__MD_VIEWER_INITIAL__ = ${safeJson(initialDocument)};
      window.__MD_VIEWER_ASSETS__ = ${safeJson(assets)};
      window.__MD_VIEWER_BASE_URI__ = ${safeJson(webviewBaseUriForDocument(webview, document.uri))};
    </script>
    <script nonce="${nonce}" src="${media("markdown.js")}"></script>
    <script nonce="${nonce}" src="${media("tabular.js")}"></script>
    <script nonce="${nonce}" src="${media("vendor", "mermaid", "mermaid.min.js")}"></script>
    <script nonce="${nonce}" src="${media("markdownEnhancer.js")}"></script>
    <script nonce="${nonce}" src="${media("vscodeViewer.js")}"></script>
  </body>
</html>`;
  }
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
    meta: documentInfo.uri.fsPath || documentInfo.uri.toString(),
    kind: detectKind(documentInfo.uri.fsPath || documentInfo.uri.toString(), documentInfo.languageId),
    filename: filenameFromUri(documentInfo.uri)
  });
}

function localResourceRootsForDocument(uri) {
  if (uri.scheme !== "file" || !uri.fsPath) return [];
  return [vscode.Uri.file(path.dirname(uri.fsPath))];
}

function webviewBaseUriForDocument(webview, uri) {
  if (uri.scheme !== "file" || !uri.fsPath) return "";
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
  if (/\.(md|markdown|mdown|mkd)$/.test(normalizedSource) || normalizedLanguage === "markdown") return "markdown";
  return "markdown";
}

function filenameFromUri(uri) {
  return uri.path.split("/").filter(Boolean).pop() || "document";
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
