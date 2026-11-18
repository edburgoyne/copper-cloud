// Convert Pyodide's mixed Python/JavaScript exception string into a compact,
// student-facing traceback while retaining the original diagnostic separately.
const explanations = {
  SyntaxError: "Python could not understand the structure of this code. Check spelling, brackets, colons, and quotes.",
  IndentationError: "The spacing at the start of a line may be incorrect. Python blocks need consistent indentation.",
  TabError: "This block mixes tabs and spaces. Use spaces consistently (four spaces is recommended).",
  NameError: "A variable or function name may be misspelled or not defined before it is used.",
  ModuleNotFoundError: "This program imports a library that is not available in Game Studio. Remove that import or use a supported library.",
  ImportError: "Game Studio could not load this library or one of its features. Check the supported API list.",
  TypeError: "This operation received a value of the wrong type. Check the values passed to the function.",
  AttributeError: "This object does not have that property or method. Check the object name and supported Pygame APIs.",
  IndexError: "The program tried to use an item outside a list or sequence. Check the index and its length.",
  KeyError: "The program requested a key that is not present in this dictionary.",
  ZeroDivisionError: "The program tried to divide by zero. Check the divisor before dividing.",
  ValueError: "A function received a value it could not use. Check the value and its allowed range.",
  NotImplementedError: "This feature is outside Game Studio's supported Pygame subset.",
};

export function formatPythonError(error, source) {
  const raw = String(error?.message ?? error ?? "Python error").replace(/^PythonError:\s*/, "");
  const lines = raw.split(/\r?\n/);
  const locationMatches = [...raw.matchAll(/File ["']main\.py["'], line (\d+)/g)];
  const lineNumber = locationMatches.length ? Number(locationMatches.at(-1)[1]) : null;
  const sourceLines = String(source).split(/\r?\n/);
  const sourceLine = lineNumber && lineNumber <= sourceLines.length
    ? sourceLines[lineNumber - 1]
    : null;
  const terminal = lines.findLast((line) => /^[A-Za-z_][\w.]*:\s*/.test(line.trim()))?.trim() || "Python error";
  const separator = terminal.indexOf(":");
  const errorType = separator > 0 ? terminal.slice(0, separator) : "PythonError";

  const traceback = ["Traceback (most recent call last):"];
  for (let index = 0; index < lines.length; index += 1) {
    const location = lines[index].match(/File ["']main\.py["'], line (\d+)/);
    if (!location) continue;
    traceback.push(lines[index].trimStart());
    const sourceText = lines[index + 1];
    if (sourceText && /^\s{4,}\S/.test(sourceText) && !sourceText.includes("File ")) {
      traceback.push(sourceText);
      if (/^\s*\^+\s*$/.test(lines[index + 2] || "")) traceback.push(lines[index + 2]);
    } else {
      const frameLine = sourceLines[Number(location[1]) - 1];
      if (frameLine) traceback.push(`    ${frameLine}`);
    }
  }
  if (traceback.length === 1) {
    traceback.push(`  File "main.py", line ${lineNumber ?? "?"}, in <module>`);
    if (sourceLine !== null) traceback.push(`    ${sourceLine}`);
  }
  traceback.push(terminal);

  return {
    errorType,
    explanation: explanations[errorType] || "Python could not finish this program. Read the traceback and check the highlighted line.",
    lineNumber,
    sourceLine,
    traceback: traceback.join("\n").slice(0, 12000),
    technical: String(error?.stack || raw).slice(0, 24000),
  };
}

// The browser combines this module's source with the self-contained data: worker.
globalThis.studio_format_python_error = formatPythonError;
