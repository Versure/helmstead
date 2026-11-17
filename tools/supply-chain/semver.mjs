// The small part of semantic versioning that exception ranges need: `*`, an exact version, or a space-separated
// set of comparators (`>=1.0.0 <2.0.0`) that must all hold. NuGet versions with a fourth part compare by it too.

/** @returns {boolean} whether `version` satisfies `range` */
export function satisfiesRange(version, range) {
  const trimmed = range.trim();
  if (trimmed === '*') return true;
  return trimmed.split(/\s+/).every((comparator) => {
    const match = /^(<=|>=|<|>|=)?(.+)$/.exec(comparator);
    if (!match) return false;
    const [, operator = '=', bound] = match;
    const order = compareVersions(version, bound);
    switch (operator) {
      case '<':
        return order < 0;
      case '<=':
        return order <= 0;
      case '>':
        return order > 0;
      case '>=':
        return order >= 0;
      default:
        return order === 0;
    }
  });
}

/** @returns {number} negative, zero or positive, like a sort comparator */
export function compareVersions(a, b) {
  const [coreA, preA] = split(a);
  const [coreB, preB] = split(b);
  for (let i = 0; i < Math.max(coreA.length, coreB.length); i++) {
    const diff = (coreA[i] ?? 0) - (coreB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // A pre-release sorts before its release.
  if (preA === preB) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA < preB ? -1 : 1;
}

function split(version) {
  const withoutBuild = version.split('+')[0];
  const dash = withoutBuild.indexOf('-');
  const core = dash < 0 ? withoutBuild : withoutBuild.slice(0, dash);
  const pre = dash < 0 ? undefined : withoutBuild.slice(dash + 1);
  return [core.split('.').map((part) => Number.parseInt(part, 10) || 0), pre];
}
