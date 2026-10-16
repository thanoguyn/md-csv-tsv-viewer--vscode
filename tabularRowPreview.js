const vscode = require("vscode");
const { readLineFromDisk } = require("./jsonlPreviewCore");
const { formatDelimitedRow } = require("./tabularRowPreviewCore");

const PREVIEW_SCHEME = "tabular-row-preview";
const PREVIEW_URI = vscode.Uri.parse(`${PREVIEW_SCHEME}:/CSV TSV Row Preview.jsonc`);

class DelimitedRowPreviewProvider {
  constructor() {
    this.changeEmitter = new vscode.EventEmitter();
    this.onDidChange = this.changeEmitter.event;
    this.content = '// Place the cursor on a row in a .csv or .tsv file and run "CSV/TSV: Preview Row".';
  }

  update(sourceLabel, lineNumber, headerLine, lineText, delimiter) {
    this.content = formatDelimitedRow(sourceLabel, lineNumber, headerLine, lineText, delimiter);
    this.changeEmitter.fire(PREVIEW_URI);
  }

  provideTextDocumentContent() {
    return this.content;
  }

  dispose() {
    this.changeEmitter.dispose();
  }
}

function registerDelimitedRowPreview(context) {
  const provider = new DelimitedRowPreviewProvider();
  let debounce;

  const isDelimitedUri = (uri) => /\.(csv|tsv)$/i.test(uri.path);
  const isDelimitedDocument = (document) => isDelimitedUri(document.uri) || document.languageId === "csv" || document.languageId === "tsv";
  const isPreviewVisible = () => vscode.window.visibleTextEditors.some((editor) => editor.document.uri.scheme === PREVIEW_SCHEME);
  const delimiterFor = (uri, languageId = "") => uri.path.toLowerCase().endsWith(".tsv") || languageId === "tsv" ? "\t" : ",";

  const resolveTarget = (resource) => {
    const active = vscode.window.activeTextEditor;
    if (active && isDelimitedDocument(active.document)) {
      return { uri: active.document.uri, line: active.selection.active.line };
    }
    if (resource instanceof vscode.Uri && isDelimitedUri(resource)) return { uri: resource, line: 0 };
    const visible = vscode.window.visibleTextEditors.find((editor) => isDelimitedDocument(editor.document));
    return visible ? { uri: visible.document.uri, line: visible.selection.active.line } : undefined;
  };

  const renderRow = async (target) => {
    if (target.line < 0) return false;
    const key = target.uri.toString();
    let document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === key);
    if (!document) {
      try {
        document = await vscode.workspace.openTextDocument(target.uri);
      } catch (error) {
        document = undefined;
      }
    }

    const sourceLabel = vscode.workspace.asRelativePath(target.uri, false);
    if (document) {
      if (target.line >= document.lineCount) return false;
      provider.update(
        sourceLabel,
        target.line,
        document.lineAt(0).text,
        document.lineAt(target.line).text,
        delimiterFor(target.uri, document.languageId)
      );
      return true;
    }

    if (target.uri.scheme !== "file") return false;
    const [headerLine, lineText] = await Promise.all([
      readLineFromDisk(target.uri.fsPath, 0),
      target.line === 0 ? readLineFromDisk(target.uri.fsPath, 0) : readLineFromDisk(target.uri.fsPath, target.line)
    ]);
    provider.update(sourceLabel, target.line, headerLine, lineText, delimiterFor(target.uri));
    return true;
  };

  const openPreview = async (target) => {
    try {
      if (!await renderRow(target)) {
        vscode.window.showWarningMessage(`Row ${target.line + 1} is out of range.`);
        return;
      }
      const document = await vscode.workspace.openTextDocument(PREVIEW_URI);
      await vscode.languages.setTextDocumentLanguage(document, "jsonc");
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
        preview: true
      });
    } catch (error) {
      vscode.window.showErrorMessage(`CSV/TSV Row Preview: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (!isDelimitedDocument(event.textEditor.document) || !isPreviewVisible()) return;
    if (!vscode.workspace.getConfiguration("tabularViewer").get("followCursor", true)) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const document = event.textEditor.document;
      const line = event.textEditor.selection.active.line;
      provider.update(
        vscode.workspace.asRelativePath(document.uri, false),
        line,
        document.lineAt(0).text,
        document.lineAt(line).text,
        delimiterFor(document.uri, document.languageId)
      );
    }, 100);
  });

  context.subscriptions.push(
    provider,
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, provider),
    vscode.commands.registerCommand("tabularViewer.previewRow", async (resource) => {
      const target = resolveTarget(resource);
      if (!target) {
        vscode.window.showInformationMessage("Open a .csv or .tsv file to preview a row.");
        return;
      }
      await openPreview(target);
    }),
    selectionListener,
    new vscode.Disposable(() => clearTimeout(debounce))
  );
}

module.exports = {
  DelimitedRowPreviewProvider,
  PREVIEW_SCHEME,
  PREVIEW_URI,
  formatDelimitedRow,
  registerDelimitedRowPreview
};
