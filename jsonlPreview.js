const vscode = require("vscode");
const { formatJsonlLine, readLineFromDisk } = require("./jsonlPreviewCore");

const PREVIEW_SCHEME = "jsonl-preview";
const PREVIEW_URI = vscode.Uri.parse(`${PREVIEW_SCHEME}:/JSONL Row Preview.jsonc`);

class JsonlPreviewProvider {
  constructor() {
    this.changeEmitter = new vscode.EventEmitter();
    this.onDidChange = this.changeEmitter.event;
    this.content = '// Place the cursor on a row in a .jsonl file and run "JSONL: Preview Row".';
  }

  update(document, lineNumber) {
    this.updateFromText(vscode.workspace.asRelativePath(document.uri, false), lineNumber, document.lineAt(lineNumber).text);
  }

  updateFromText(sourceLabel, lineNumber, lineText) {
    this.content = formatJsonlLine(sourceLabel, lineNumber, lineText);
    this.changeEmitter.fire(PREVIEW_URI);
  }

  provideTextDocumentContent() {
    return this.content;
  }

  dispose() {
    this.changeEmitter.dispose();
  }
}

function registerJsonlPreview(context) {
  const provider = new JsonlPreviewProvider();
  let lastTarget;
  let debounce;

  const isJsonlUri = (uri) => /\.(jsonl|ndjson)$/i.test(uri.path);
  const isJsonlDocument = (document) => isJsonlUri(document.uri) || document.languageId === "jsonl" || document.languageId === "ndjson";
  const isPreviewVisible = () => vscode.window.visibleTextEditors.some((editor) => editor.document.uri.scheme === PREVIEW_SCHEME);
  const syncPreviewContext = () => {
    vscode.commands.executeCommand("setContext", "jsonlViewer.previewActive", isPreviewVisible());
  };

  const activeJsonlTabUri = () => {
    const groups = vscode.window.tabGroups;
    const candidates = [groups.activeTabGroup.activeTab, ...groups.all.map((group) => group.activeTab)];
    for (const tab of candidates) {
      if (tab && tab.input instanceof vscode.TabInputText && isJsonlUri(tab.input.uri)) return tab.input.uri;
    }
    return undefined;
  };

  const resolveTarget = (resource) => {
    const active = vscode.window.activeTextEditor;
    if (active && isJsonlDocument(active.document)) {
      return { uri: active.document.uri, line: active.selection.active.line };
    }
    if (resource instanceof vscode.Uri && isJsonlUri(resource)) return { uri: resource, line: 0 };
    const visible = vscode.window.visibleTextEditors.find((editor) => isJsonlDocument(editor.document));
    if (visible) return { uri: visible.document.uri, line: visible.selection.active.line };
    const tabUri = activeJsonlTabUri();
    return tabUri ? { uri: tabUri, line: 0 } : undefined;
  };

  const renderRow = async (target) => {
    if (target.line < 0) return { ok: false };
    const key = target.uri.toString();
    let document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === key);
    if (!document) {
      try {
        document = await vscode.workspace.openTextDocument(target.uri);
      } catch (error) {
        document = undefined;
      }
    }

    if (document) {
      if (target.line >= document.lineCount) return { ok: false, lineCount: document.lineCount };
      provider.update(document, target.line);
      return { ok: true };
    }

    if (target.uri.scheme !== "file") return { ok: false };
    try {
      const text = await readLineFromDisk(target.uri.fsPath, target.line);
      provider.updateFromText(vscode.workspace.asRelativePath(target.uri, false), target.line, text);
      return { ok: true };
    } catch (error) {
      if (error instanceof RangeError) return { ok: false };
      throw error;
    }
  };

  const openPreviewDocument = async () => {
    const document = await vscode.workspace.openTextDocument(PREVIEW_URI);
    await vscode.languages.setTextDocumentLanguage(document, "jsonc");
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
      preview: true
    });
    syncPreviewContext();
  };

  const previewTarget = async (target) => {
    try {
      const result = await renderRow(target);
      if (!result.ok) {
        const detail = result.lineCount === undefined ? "" : ` (file has ${result.lineCount} rows)`;
        vscode.window.showWarningMessage(`Row ${target.line + 1} is out of range${detail}.`);
        return;
      }
      lastTarget = target;
      await openPreviewDocument();
    } catch (error) {
      vscode.window.showErrorMessage(`JSONL Viewer: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const stepRow = async (delta) => {
    const resolved = resolveTarget();
    let target = resolved;
    if (lastTarget && (!resolved || resolved.uri.toString() === lastTarget.uri.toString())) {
      target = { uri: lastTarget.uri, line: lastTarget.line + delta };
    }
    if (!target) {
      vscode.window.showInformationMessage("Open a .jsonl or .ndjson file to preview a row.");
      return;
    }
    if (target.line < 0) {
      vscode.window.showWarningMessage("Already at the first row.");
      return;
    }
    await previewTarget(target);
  };

  const goToRow = async () => {
    const base = lastTarget || resolveTarget();
    if (!base) {
      vscode.window.showInformationMessage("Open a .jsonl or .ndjson file to preview a row.");
      return;
    }
    const input = await vscode.window.showInputBox({
      prompt: `Row number to preview in ${vscode.workspace.asRelativePath(base.uri, false)}`,
      value: String(lastTarget?.uri.toString() === base.uri.toString() ? lastTarget.line + 1 : 1),
      validateInput: (value) => Number.isInteger(Number(value)) && Number(value) >= 1
        ? undefined
        : "Enter a positive integer row number."
    });
    if (input !== undefined) await previewTarget({ uri: base.uri, line: Number(input) - 1 });
  };

  const selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (!isJsonlDocument(event.textEditor.document) || !isPreviewVisible()) return;
    if (!vscode.workspace.getConfiguration("jsonlViewer").get("followCursor", true)) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const line = event.textEditor.selection.active.line;
      provider.update(event.textEditor.document, line);
      lastTarget = { uri: event.textEditor.document.uri, line };
    }, 100);
  });

  syncPreviewContext();
  context.subscriptions.push(
    provider,
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, provider),
    vscode.window.onDidChangeVisibleTextEditors(syncPreviewContext),
    vscode.commands.registerCommand("jsonlViewer.previewLine", async (resource) => {
      const target = resolveTarget(resource);
      if (!target) {
        vscode.window.showInformationMessage("Open a .jsonl or .ndjson file to preview a row.");
        return;
      }
      await previewTarget(target);
    }),
    vscode.commands.registerCommand("jsonlViewer.previewNextRow", () => stepRow(1)),
    vscode.commands.registerCommand("jsonlViewer.previewPreviousRow", () => stepRow(-1)),
    vscode.commands.registerCommand("jsonlViewer.previewGoToRow", goToRow),
    selectionListener,
    new vscode.Disposable(() => clearTimeout(debounce))
  );
}

module.exports = {
  PREVIEW_SCHEME,
  PREVIEW_URI,
  JsonlPreviewProvider,
  formatJsonlLine,
  readLineFromDisk,
  registerJsonlPreview
};
