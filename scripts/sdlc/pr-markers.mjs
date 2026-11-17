// Reads the markers /build ends a PR description with (docs/sdlc.md §4, .claude/skills/build/SKILL.md §6).
//
// Markers count only as whole lines in the trailing block of the description: the run of lines at the
// very end that are each a single `<!-- key: value -->` comment (or blank). Text anywhere else - the
// findings ledger, quoted code, a reviewer's claim - can never act as a marker, however it is written.

const MARKER_LINE = /^<!--\s*([a-z-]+):?\s*([^<>]*?)\s*-->$/i;

/** Returns the trailing markers as a list of { key, value }, in the order they appear. */
export function trailingMarkers(body) {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n');
  const markers = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line === '') continue;
    const m = line.match(MARKER_LINE);
    if (!m) break;
    markers.unshift({ key: m[1].toLowerCase(), value: m[2] });
  }
  return markers;
}

/** The commit the AI review passed, from `<!-- ai-review: pass <sha> -->`, or null. */
export function aiReviewPassSha(body) {
  for (const { key, value } of trailingMarkers(body)) {
    const m = key === 'ai-review' && value.match(/^pass\s+([0-9a-f]{7,40})$/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/**
 * What may follow the reviewed commit: nothing, or the build's last commit, which only flips one spec's
 * `status:` line from `approved` to `built`. Takes the output of `git diff -U0 --no-renames <sha> <head>`.
 */
export function onlyStatusBuilt(diff) {
  const text = String(diff ?? '');
  if (text.trim() === '') return true;
  const blocks = text.split(/^(?=diff --git )/m).filter((b) => b.trim() !== '');
  // Exactly one file, a plain spec path (quoted paths, renames and new or deleted files fail).
  if (blocks.length !== 1) return false;
  const lines = blocks[0].replace(/\n$/, '').split('\n');
  const file = lines[0].match(/^diff --git a\/(docs\/specs\/[^/\s"]+\.md) b\/\1$/);
  if (!file) return false;
  const firstHunk = lines.findIndex((l) => l.startsWith('@@ '));
  if (firstHunk < 0) return false;
  // Header lines before the first hunk may only be the index and the file names: no mode changes.
  const header = lines.slice(1, firstHunk);
  if (!header.every((l) => /^(index [0-9a-f]+\.\.[0-9a-f]+( \d+)?|--- a\/\S+|\+\+\+ b\/\S+)$/.test(l))) return false;
  const removed = [];
  const added = [];
  for (const line of lines.slice(firstHunk)) {
    if (line.startsWith('@@ ')) continue;
    if (line.startsWith('-')) removed.push(line.slice(1));
    else if (line.startsWith('+')) added.push(line.slice(1));
    else if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    else return false; // -U0 has no context lines
  }
  return (
    removed.length === 1 &&
    added.length === 1 &&
    /^status:\s*approved\b/.test(removed[0]) &&
    /^status:\s*built\b/.test(added[0])
  );
}

/**
 * Only a PR from a branch in this repository, opened by someone with write access, can pass on the AI
 * review alone. A fork PR, or an author GitHub does not list as owner, member or collaborator, waits for
 * the owner whatever its description says.
 */
export function trustedAuthor(pr, repo) {
  const sameRepo = pr?.head?.repo?.full_name === repo;
  const association = String(pr?.author_association ?? '').toUpperCase();
  return sameRepo && ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(association);
}
