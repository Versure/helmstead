#!/usr/bin/env node
// Classifies the files changed on a branch into the risk categories of risk-paths.json.
// The result is a floor: reviewers and the PR body can raise the risk, never lower it.
//
// Usage: node scripts/sdlc/classify-risk.mjs [--base <ref>] [--head <ref>] [--json]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const config = JSON.parse(readFileSync(path.join(here, 'risk-paths.json'), 'utf8'));

export function globToRegExp(glob) {
  let re = '';
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { braces++; re += '(?:'; }
    else if (c === '}' && braces > 0) { braces--; re += ')'; }
    else if (c === ',' && braces > 0) re += '|';
    else re += c.replace(/[.+^$()|[\]\\{}]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

const matcher = (globs) => {
  const res = globs.map(globToRegExp);
  return (file) => res.some((r) => r.test(file));
};

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

export function changedFiles(base, head) {
  return git('diff', '--name-only', '--no-renames', `${base}...${head}`).split('\n').filter(Boolean);
}

export function changedLines(base, head) {
  const ignored = matcher(config.sizeIgnore);
  let total = 0;
  for (const line of git('diff', '--numstat', '--no-renames', `${base}...${head}`).split('\n')) {
    const [added, deleted, file] = line.split('\t');
    if (!file || ignored(file) || added === '-') continue;
    total += Number(added) + Number(deleted);
  }
  return total;
}

export function classify(files, lines = 0) {
  const categories = {};
  for (const [key, cat] of Object.entries(config.categories)) {
    const hit = files.filter(matcher(cat.paths));
    if (hit.length) categories[key] = hit;
  }
  if (lines > config.maxAutoMergeLines) {
    categories.size = [`${lines} changed lines (limit for auto-merge: ${config.maxAutoMergeLines})`];
  }
  return { risk: Object.keys(categories).length ? 'high' : 'low', categories, files, lines };
}

export function title(key) {
  return config.categories[key]?.title ?? (key === 'size' ? 'Size' : key);
}

function defaultBase() {
  try {
    git('rev-parse', '--verify', '--quiet', 'origin/main');
    return 'origin/main';
  } catch {
    return 'main';
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const base = opt('--base', defaultBase());
  const head = opt('--head', 'HEAD');
  const result = classify(changedFiles(base, head), changedLines(base, head));

  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Risk: ${result.risk.toUpperCase()} (${result.files.length} files, ${result.lines} lines vs ${base})`);
    for (const [key, hits] of Object.entries(result.categories)) {
      console.log(`\n${title(key)}:`);
      for (const f of hits) console.log(`  - ${f}`);
    }
  }
}
