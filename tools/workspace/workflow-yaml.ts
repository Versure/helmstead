/**
 * Reads the subset of YAML the workflows in .github/workflows use: block mappings, block sequences, flow sequences
 * of plain scalars, `|` block scalars, quoted and plain scalars, and comments. Anything else throws, so a workflow
 * written in a form this reader does not know fails its test instead of being misread. Spec 003 adds no YAML
 * dependency for this; the workspace tests only need to read workflows the repository writes itself.
 */
export type YamlValue = string | YamlValue[] | { [key: string]: YamlValue };

interface Line {
  indent: number;
  text: string;
  number: number;
}

export function parseWorkflowYaml(source: string): YamlValue {
  const raw = source.replace(/\r\n/g, '\n').split('\n');
  const lines: Line[] = [];
  raw.forEach((text, index) => {
    const stripped = stripComment(text);
    if (stripped.trim() === '') return;
    lines.push({
      indent: stripped.length - stripped.trimStart().length,
      text: stripped.trim(),
      number: index + 1,
    });
  });
  let position = 0;

  function fail(line: Line | undefined, message: string): never {
    throw new Error(`workflow YAML line ${line?.number ?? 'end'}: ${message}`);
  }

  function blockScalar(parentIndent: number, startLine: number): string {
    // Read the raw lines (comments and blank lines are content here) that are indented deeper than the key.
    const out: string[] = [];
    let blockIndent: number | undefined;
    let index = startLine;
    for (; index < raw.length; index++) {
      const text = raw[index];
      if (text.trim() === '') {
        out.push('');
        continue;
      }
      const indent = text.length - text.trimStart().length;
      if (indent <= parentIndent) break;
      blockIndent ??= indent;
      out.push(text.slice(blockIndent));
    }
    while (position < lines.length && lines[position].number <= index)
      position++;
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return `${out.join('\n')}\n`;
  }

  function parseNode(indent: number): YamlValue {
    const line = lines[position];
    if (!line || line.indent < indent) return '';
    return line.text.startsWith('- ') || line.text === '-'
      ? parseSequence(line.indent)
      : parseMapping(line.indent);
  }

  function parseSequence(indent: number): YamlValue[] {
    const items: YamlValue[] = [];
    while (
      position < lines.length &&
      lines[position].indent === indent &&
      lines[position].text.startsWith('-')
    ) {
      const line = lines[position];
      const rest = line.text.slice(1).trim();
      if (rest === '') {
        position++;
        items.push(parseNode(indent + 1));
      } else if (
        /^[\w.$-]+:(\s|$)/.test(rest) ||
        /^["'][^"']+["']:(\s|$)/.test(rest)
      ) {
        // "- key: value" starts a mapping whose keys sit at the column of "key".
        lines[position] = { ...line, indent: indent + 2, text: rest };
        items.push(parseMapping(indent + 2));
      } else {
        position++;
        items.push(scalar(rest, line));
      }
    }
    return items;
  }

  function parseMapping(indent: number): { [key: string]: YamlValue } {
    const map: { [key: string]: YamlValue } = {};
    while (position < lines.length && lines[position].indent === indent) {
      const line = lines[position];
      const match = /^("[^"]*"|'[^']*'|[^:\s][^:]*?):(?:\s+(.*))?$/.exec(
        line.text,
      );
      if (!match) fail(line, `expected "key: value", got "${line.text}"`);
      const key = unquote(match[1]);
      const value = match[2]?.trim() ?? '';
      position++;
      if (value === '|' || value === '|-' || value === '>') {
        if (value === '>') fail(line, 'folded scalars (>) are not supported');
        const text = blockScalar(indent, line.number);
        map[key] = value === '|-' ? text.replace(/\n$/, '') : text;
      } else if (value === '') {
        const next = lines[position];
        // A sequence may sit at the same indent as its key.
        map[key] =
          next &&
          (next.indent > indent ||
            (next.indent === indent && next.text.startsWith('- ')))
            ? parseNode(next.indent)
            : '';
      } else {
        map[key] = scalar(value, line);
      }
    }
    if (position < lines.length && lines[position].indent > indent) {
      fail(lines[position], 'unexpected indentation');
    }
    return map;
  }

  function scalar(value: string, line: Line): YamlValue {
    if (value.startsWith('[')) {
      if (!value.endsWith(']'))
        fail(line, 'multi-line flow sequences are not supported');
      const inner = value.slice(1, -1).trim();
      return inner === ''
        ? []
        : inner.split(',').map((item) => unquote(item.trim()));
    }
    if (value.startsWith('{')) {
      if (value === '{}') return {};
      fail(line, 'flow mappings are not supported');
    }
    if (/^[&*!]/.test(value))
      fail(line, 'anchors, aliases and tags are not supported');
    return unquote(value);
  }

  const result = parseNode(0);
  if (position < lines.length) fail(lines[position], 'unexpected content');
  return result;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value) as string;
  }
  return value;
}

/** Removes a comment that is not inside quotes. */
function stripComment(text: string): string {
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      // A quote only opens a quoted scalar at the start of a value.
      if (i === 0 || /[\s:[,-]/.test(text[i - 1])) quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text;
}
