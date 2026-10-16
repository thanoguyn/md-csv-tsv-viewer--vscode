const fs = require("fs");
const readline = require("readline");

function formatJsonlLine(sourceLabel, lineNumber, lineText) {
  const header = `// ${sourceLabel}:${lineNumber + 1}`;
  const trimmed = lineText.trim();
  if (!trimmed) return `${header}\n// (empty line)`;

  try {
    return `${header}\n${JSON.stringify(JSON.parse(trimmed), null, 2)}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `${header}\n// Invalid JSON: ${message}\n\n${lineText}`;
  }
}

function readLineFromDisk(fsPath, lineNumber) {
  return new Promise((resolve, reject) => {
    if (!Number.isInteger(lineNumber) || lineNumber < 0) {
      reject(new RangeError(`Invalid line number: ${lineNumber}`));
      return;
    }

    const stream = fs.createReadStream(fsPath, { encoding: "utf8" });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let index = 0;
    let settled = false;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
      lines.close();
      stream.destroy();
    };

    lines.on("line", (text) => {
      if (index === lineNumber) finish(() => resolve(text));
      index += 1;
    });
    lines.on("close", () => {
      finish(() => reject(new RangeError(`Line ${lineNumber} is out of range (file has ${index} lines)`)));
    });
    lines.on("error", (error) => finish(() => reject(error)));
    stream.on("error", (error) => finish(() => reject(error)));
  });
}

module.exports = { formatJsonlLine, readLineFromDisk };
