const assert = require("node:assert/strict");
const test = require("node:test");
const { formatDelimitedRow, parseDelimitedLine } = require("../tabularRowPreviewCore");

test("parses quoted CSV and escaped quotes", () => {
  assert.deepEqual(
    parseDelimitedLine('1,"Ada, Lovelace","first ""programmer"""', ","),
    { values: ["1", "Ada, Lovelace", 'first "programmer"'], unterminatedQuote: false }
  );
});

test("formats a CSV cursor row as a header-keyed JSONC preview", () => {
  assert.equal(
    formatDelimitedRow("sample.csv", 1, "id,name,active", '2,"Grace Hopper",true', ","),
    '// sample.csv:2\n{\n  "id": "2",\n  "name": "Grace Hopper",\n  "active": "true"\n}'
  );
});

test("formats TSV headers and duplicate column names safely", () => {
  assert.equal(
    formatDelimitedRow("sample.tsv", 1, "name\tname\t", "Ada\tLovelace\t36", "\t"),
    '// sample.tsv:2\n{\n  "name": "Ada",\n  "name_2": "Lovelace",\n  "Column 3": "36"\n}'
  );
});
