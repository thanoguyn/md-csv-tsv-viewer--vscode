const assert = require("node:assert/strict");
const test = require("node:test");
const { jsonlLineAt, jsonlLineStarts, jsonlTableRows, parseJsonl, previewText } = require("../media/jsonl.js");

test("parses JSONL values and reports invalid source lines", () => {
  const parsed = parseJsonl('{"id":1}\n\nnot-json\n[1,2]\n');

  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.invalidCount, 1);
  assert.equal(parsed.emptyLines, 1);
  assert.deepEqual(parsed.records.map((record) => record.line), [1, 3, 4]);
  assert.match(parsed.records[1].error, /Unexpected token|not valid JSON/i);
});

test("builds a CSV-like table and flattens nested objects", () => {
  const rows = jsonlTableRows([
    '{"id":1,"user":{"name":"Ada","active":true},"tags":["a","b"]}',
    '{"id":2,"user":{"name":"Lin"},"meta":null}',
    'false',
    '{bad}'
  ].join("\n"));

  assert.deepEqual(rows[0], ["$line", "id", "user.name", "user.active", "tags", "meta", "$value", "$error", "$raw"]);
  assert.deepEqual(rows[1].slice(0, 5), ["1", "1", "Ada", "true", '["a","b"]']);
  assert.equal(rows[2][2], "Lin");
  assert.equal(rows[2][5], "null");
  assert.equal(rows[3][6], "false");
  assert.match(rows[4][7], /Unexpected token|property name|JSON/i);
  assert.equal(rows[4][8], "{bad}");
});

test("keeps metadata columns when JSON objects use reserved names", () => {
  const rows = jsonlTableRows('{"$line":"from-data","$error":false}');

  assert.deepEqual(rows[0], ["$line", "data.$line", "data.$error"]);
  assert.deepEqual(rows[1], ["1", "from-data", "false"]);
});

test("previews one source row as pretty printed, editor-style JSON", () => {
  const source = '{"id":1}\n\n{"id":2,"tags":["a","b"]}\n';
  const starts = jsonlLineStarts(source);

  assert.equal(starts.length, 3);
  assert.equal(jsonlLineAt(source, starts, 2), "");
  assert.equal(previewText(source, starts, 2, "sample.jsonl").status, "Empty line");
  assert.equal(
    previewText(source, starts, 3, "sample.jsonl").displayText,
    '// sample.jsonl:3\n{\n  "id": 2,\n  "tags": [\n    "a",\n    "b"\n  ]\n}'
  );
});

test("empty JSONL input does not report a physical empty record", () => {
  assert.equal(parseJsonl("").emptyLines, 0);
  assert.deepEqual(jsonlTableRows(""), [["$line"]]);
});
