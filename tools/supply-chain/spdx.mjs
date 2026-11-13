// Parses and evaluates SPDX licence expressions (https://spdx.github.io/spdx-spec/v2.3/SPDX-license-expressions/).
// `A OR B` is allowed when either side is, `A AND B` only when both are. A `+` suffix or a `WITH` exception makes a
// different licence, which is allowed only when it is listed exactly. Identifiers compare case-insensitively.

/**
 * @typedef {{ type: 'license', id: string } | { type: 'and' | 'or', left: SpdxNode, right: SpdxNode }} SpdxNode
 */

/** @returns {SpdxNode | undefined} the parsed expression, or undefined when it is not a valid SPDX expression */
export function parseSpdx(expression) {
  if (typeof expression !== 'string') return undefined;
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let position = 0;
  const peek = () => tokens[position];
  const keyword = (word) => peek()?.toUpperCase() === word;

  function parseOr() {
    let left = parseAnd();
    while (left && keyword('OR')) {
      position++;
      const right = parseAnd();
      if (!right) return undefined;
      left = { type: 'or', left, right };
    }
    return left;
  }
  function parseAnd() {
    let left = parsePrimary();
    while (left && keyword('AND')) {
      position++;
      const right = parsePrimary();
      if (!right) return undefined;
      left = { type: 'and', left, right };
    }
    return left;
  }
  function parsePrimary() {
    const token = peek();
    if (token === undefined || token === ')') return undefined;
    if (token === '(') {
      position++;
      const inner = parseOr();
      if (!inner || peek() !== ')') return undefined;
      position++;
      return inner;
    }
    if (['AND', 'OR', 'WITH'].includes(token.toUpperCase())) return undefined;
    if (!/^(LicenseRef-|DocumentRef-)?[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(token))
      return undefined;
    position++;
    let id = token;
    if (keyword('WITH')) {
      position++;
      const exception = peek();
      if (!exception || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(exception))
        return undefined;
      position++;
      id = `${token} WITH ${exception}`;
    }
    return { type: 'license', id };
  }

  const tree = parseOr();
  return tree && position === tokens.length ? tree : undefined;
}

/** @returns {boolean} whether the expression is satisfied by the allowed identifiers */
export function spdxAllowed(node, allowed) {
  if (!node) return false;
  const set = new Set(allowed.map((id) => id.toLowerCase()));
  const evaluate = (n) => {
    switch (n.type) {
      case 'license':
        return set.has(n.id.toLowerCase());
      case 'and':
        return evaluate(n.left) && evaluate(n.right);
      case 'or':
        return evaluate(n.left) || evaluate(n.right);
    }
  };
  return evaluate(node);
}
