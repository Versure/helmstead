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

/** A commit after the reviewed one may only touch spec files (the build sets `status: built` last). */
export function onlySpecFiles(files) {
  return files.every((f) => /^docs\/specs\/[^/]+\.md$/.test(f));
}
