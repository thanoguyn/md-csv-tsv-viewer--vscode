const assert = require("node:assert/strict");
const test = require("node:test");
const manifest = require("../package.json");

test("keeps CSV/TSV tables and JSONL text editors as the default views", () => {
  const associations = manifest.contributes.configurationDefaults["workbench.editorAssociations"];

  assert.equal(associations["*.csv"], "mdviewer.viewer");
  assert.equal(associations["*.tsv"], "mdviewer.viewer");
  assert.equal(associations["*.jsonl"], "default");
  assert.equal(associations["*.ndjson"], "default");
});

test("contributes row preview and normal table-view commands for tabular text editors", () => {
  const commands = manifest.contributes.commands;
  const keybindings = manifest.contributes.keybindings;
  const titleMenu = manifest.contributes.menus["editor/title"];

  assert.ok(commands.some((item) => item.command === "tabularViewer.previewRow"));
  assert.ok(commands.some((item) => item.command === "mdviewer.openTablePreview"));
  assert.ok(keybindings.some((item) => (
    item.command === "mdviewer.openView"
    && item.key === "ctrl+alt+v"
    && item.mac === "cmd+alt+v"
    && item.when.includes("csv|tsv|jsonl|ndjson")
  )));
  assert.ok(keybindings.some((item) => (
    item.command === "tabularViewer.previewRow"
    && item.key === "ctrl+alt+j"
    && item.mac === "cmd+alt+j"
    && item.when.includes("csv|tsv")
  )));
  assert.ok(titleMenu.some((item) => (
    item.command === "tabularViewer.previewRow"
    && item.when.includes("csv|tsv")
  )));
  assert.ok(titleMenu.some((item) => (
    item.command === "mdviewer.openTablePreview"
    && item.when.includes("csv|tsv|jsonl|ndjson")
  )));
  assert.ok(!keybindings.some((item) => item.key === "ctrl+alt+t" || item.mac === "cmd+alt+t"));
});
