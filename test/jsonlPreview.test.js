const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { formatJsonlLine, readLineFromDisk } = require("../jsonlPreviewCore");

test("formats the selected JSONL row as JSONC preview content", () => {
  assert.equal(
    formatJsonlLine("sample.jsonl", 1, '{"id":2,"tags":["a","b"]}'),
    '// sample.jsonl:2\n{\n  "id": 2,\n  "tags": [\n    "a",\n    "b"\n  ]\n}'
  );
  assert.equal(formatJsonlLine("sample.jsonl", 3, "  "), "// sample.jsonl:4\n// (empty line)");
  assert.match(formatJsonlLine("sample.jsonl", 2, "{bad}"), /Invalid JSON/);
});

test("streams one requested row from disk without loading the file", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mdviewer-jsonl-"));
  const filename = path.join(directory, "sample.jsonl");
  fs.writeFileSync(filename, '{"id":1}\r\n\r\n{"id":3}\r\n');
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  assert.equal(await readLineFromDisk(filename, 0), '{"id":1}');
  assert.equal(await readLineFromDisk(filename, 1), "");
  assert.equal(await readLineFromDisk(filename, 2), '{"id":3}');
  await assert.rejects(readLineFromDisk(filename, 99), RangeError);
});
