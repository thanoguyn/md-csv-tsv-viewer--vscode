function parseDelimitedLine(line, delimiter) {
  const values = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value);
  return { values, unterminatedQuote: quoted };
}

function uniqueColumnNames(headerValues, columnCount) {
  const names = [];
  const counts = new Map();

  for (let index = 0; index < columnCount; index += 1) {
    const base = String(headerValues[index] || "").trim() || `Column ${index + 1}`;
    const count = (counts.get(base) || 0) + 1;
    counts.set(base, count);
    names.push(count === 1 ? base : `${base}_${count}`);
  }

  return names;
}

function formatDelimitedRow(sourceLabel, lineNumber, headerLine, lineText, delimiter) {
  const sourceHeader = `// ${sourceLabel}:${lineNumber + 1}`;
  if (!lineText.trim()) return `${sourceHeader}\n// (empty line)`;

  const parsedRow = parseDelimitedLine(lineText, delimiter);
  const warning = parsedRow.unterminatedQuote ? "\n// Warning: unterminated quoted value" : "";
  if (lineNumber === 0) {
    return `${sourceHeader}\n// Header row${warning}\n${JSON.stringify(parsedRow.values, null, 2)}`;
  }

  const parsedHeader = parseDelimitedLine(headerLine, delimiter);
  const columnCount = Math.max(parsedHeader.values.length, parsedRow.values.length);
  const names = uniqueColumnNames(parsedHeader.values, columnCount);
  const record = Object.fromEntries(names.map((name, index) => [name, parsedRow.values[index] ?? ""]));
  return `${sourceHeader}${warning}\n${JSON.stringify(record, null, 2)}`;
}

module.exports = { formatDelimitedRow, parseDelimitedLine, uniqueColumnNames };
