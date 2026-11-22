/** Adapt common TeX delimiters for remark-math without changing TeX bodies.
 * Code fences, indented code and inline code remain byte-for-byte intact.
 */
export function normalizeMathDelimiters(text: string): string {
  const output: string[] = [];
  let index = 0;
  while (index < text.length) {
    if (index === 0 || text[index - 1] === "\n") {
      const newline = text.indexOf("\n", index);
      const lineEnd = newline < 0 ? text.length : newline + 1;
      const line = text.slice(index, lineEnd).replace(/\r?\n$/, "");
      const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fence) {
        const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*\\r?$`);
        let end = lineEnd;
        while (end < text.length) {
          const next = text.indexOf("\n", end);
          const nextEnd = next < 0 ? text.length : next + 1;
          const candidate = text.slice(end, nextEnd).replace(/\r?\n$/, "");
          end = nextEnd;
          if (closing.test(candidate)) break;
        }
        output.push(text.slice(index, end)); index = end; continue;
      }
      if (/^(?: {4}|\t)/.test(line)) {
        output.push(text.slice(index, lineEnd)); index = lineEnd; continue;
      }
    }
    if (text[index] === "`") {
      let length = 1;
      while (text[index + length] === "`") length++;
      const marker = "`".repeat(length);
      let end = text.indexOf(marker, index + length);
      while (end >= 0 && (text[end - 1] === "`" || text[end + length] === "`")) end = text.indexOf(marker, end + length);
      if (end >= 0) {
        output.push(text.slice(index, end + length)); index = end + length; continue;
      }
    }
    if (text[index] === "$" && !escaped(text, index)) {
      const marker = text[index + 1] === "$" ? "$$" : "$";
      const end = findDelimiter(text, marker, index + marker.length);
      if (end >= 0) {
        output.push(text.slice(index, end + marker.length)); index = end + marker.length; continue;
      }
    }
    if (text[index] === "\\") {
      if (text[index + 1] === "\\") { output.push("\\\\"); index += 2; continue; }
      const display = text[index + 1] === "[";
      if (display || text[index + 1] === "(") {
        const closing = display ? "\\]" : "\\)";
        const end = findDelimiter(text, closing, index + 2);
        if (end >= 0) {
          const body = text.slice(index + 2, end);
          output.push(display ? `\n$$\n${body}\n$$\n` : `$${body}$`);
          index = end + 2; continue;
        }
      }
      const environment = text.slice(index).match(/^\\begin\{(align\*?|aligned|alignedat|alignat\*?|gather\*?|gathered|equation\*?|cases|[pbBvV]?matrix\*?|smallmatrix|array|split)\}/);
      if (environment) {
        const name = environment[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const tokens = new RegExp(`\\\\(begin|end)\\{${name}\\}`, "g");
        tokens.lastIndex = index;
        let depth = 0, match: RegExpExecArray | null, end = -1;
        while ((match = tokens.exec(text))) {
          depth += match[1] === "begin" ? 1 : -1;
          if (depth === 0) { end = tokens.lastIndex; break; }
        }
        if (end >= 0) {
          output.push(`\n$$\n${text.slice(index, end)}\n$$\n`); index = end; continue;
        }
      }
    }
    output.push(text[index]); index++;
  }
  return output.join("");
}

function escaped(text: string, index: number) {
  let count = 0;
  for (let before = index - 1; before >= 0 && text[before] === "\\"; before--) count++;
  return count % 2 === 1;
}

function findDelimiter(text: string, marker: string, from: number) {
  let index = text.indexOf(marker, from);
  while (index >= 0) {
    if (!escaped(text, index) && (marker !== "$" || (text[index - 1] !== "$" && text[index + 1] !== "$"))) return index;
    index = text.indexOf(marker, index + marker.length);
  }
  return -1;
}
