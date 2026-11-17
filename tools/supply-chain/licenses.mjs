// The offline licence check of spec 003 (criteria 3-6). It reads package-lock.json and the NuGet restore output
// (obj/project.assets.json plus each package's .nuspec in the global packages folder), sorts every package into the
// `shipped` or `tooling` tier and checks its declared SPDX licence against dependency-policy.json.
// Run it with `node tools/supply-chain/cli.mjs licenses`; verify.mjs runs it on every run.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './policy.mjs';
import { satisfiesRange } from './semver.mjs';
import { parseSpdx, spdxAllowed } from './spdx.mjs';

/**
 * @typedef {'shipped' | 'tooling'} Tier
 * @typedef {{
 *   ecosystem: 'npm' | 'nuget',
 *   name: string,
 *   version: string,
 *   license: string | undefined,
 *   tier: Tier,
 *   path: string[],
 * }} PackageRecord
 */

// ---------------------------------------------------------------- npm

/**
 * Every package in a lockfileVersion 2 or 3 lock file, except the root workspace package and linked workspace
 * packages. `dev: true` makes a package tooling; everything else ships.
 * @returns {PackageRecord[]}
 */
export function collectNpm(lock) {
  const packages = lock.packages;
  if (!packages || typeof packages !== 'object') {
    throw new Error(
      'package-lock.json has no "packages" map; lockfileVersion 2 or later is required.',
    );
  }
  const rootName = packages['']?.name ?? lock.name ?? '(root)';
  const parents = npmParents(packages);

  return Object.entries(packages)
    .filter(
      ([location, entry]) => location.includes('node_modules/') && !entry.link,
    )
    .map(([location, entry]) => {
      const name = entry.name ?? nameFromLocation(location);
      return {
        ecosystem: 'npm',
        name,
        version: entry.version ?? '(unknown)',
        license: npmLicense(entry.license),
        tier: entry.dev === true ? 'tooling' : 'shipped',
        path: npmPath(location, parents, packages, rootName),
      };
    });
}

function npmLicense(license) {
  if (typeof license === 'string') return license;
  // Old manifests used { "type": "MIT" }; the type is still the declared licence.
  if (license && typeof license.type === 'string') return license.type;
  return undefined;
}

function nameFromLocation(location) {
  return location.slice(
    location.lastIndexOf('node_modules/') + 'node_modules/'.length,
  );
}

/** Resolves a dependency the way Node does: the nearest node_modules folder up from the requiring package. */
function resolveNpm(fromLocation, name, packages) {
  let base = fromLocation;
  for (;;) {
    const candidate = base
      ? `${base}/node_modules/${name}`
      : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return undefined;
    const index = base.lastIndexOf('/node_modules/');
    base = index < 0 ? '' : base.slice(0, index);
  }
}

/** Breadth-first from the root, so each package gets the shortest path that pulls it in. */
function npmParents(packages) {
  const parents = new Map([['', null]]);
  const queue = [''];
  while (queue.length > 0) {
    const location = queue.shift();
    const entry = packages[location];
    const names = Object.keys({
      ...entry.dependencies,
      ...entry.optionalDependencies,
      ...entry.peerDependencies,
      ...(location === '' ? entry.devDependencies : {}),
    });
    for (const name of names) {
      const target = resolveNpm(location, name, packages);
      if (target && !parents.has(target)) {
        parents.set(target, location);
        queue.push(target);
      }
    }
  }
  return parents;
}

function npmPath(location, parents, packages, rootName) {
  if (!parents.has(location)) {
    // Not reachable from the root (for example an optional platform package): fall back to the folder nesting.
    return [
      rootName,
      ...location.split(/(?:^|\/)node_modules\//).filter(Boolean),
    ];
  }
  const chain = [];
  for (let at = location; at; at = parents.get(at)) {
    chain.unshift(packages[at].name ?? nameFromLocation(at));
  }
  return [rootName, ...chain];
}

// ---------------------------------------------------------------- NuGet

/** Test projects are the `*.Tests` projects and the fixture projects under `tests/fixtures/`. */
export function isTestProject(projectName, projectPath) {
  return (
    /\.Tests$/.test(projectName) ||
    /[\\/]tests[\\/]fixtures[\\/]/.test(projectPath ?? '')
  );
}

/** The project.assets.json of every project under `apps/core` that has been restored. */
export function findAssetsFiles(root = path.join(REPO_ROOT, 'apps/core')) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        ['bin', 'node_modules', '.git'].includes(entry.name)
      )
        continue;
      const full = path.join(dir, entry.name);
      if (entry.name === 'obj') {
        const assets = path.join(full, 'project.assets.json');
        if (existsSync(assets)) found.push(assets);
      } else {
        walk(full);
      }
    }
  };
  walk(root);
  return found.sort();
}

/**
 * Every NuGet package, direct and transitive, of the given restored projects. A package used by any non-test
 * project ships; one reached only from test projects is tooling.
 * @param {string[]} assetsFiles paths of project.assets.json files
 * @param {string[]} [packageFolders] where the .nuspec files are; defaults to the folders the restore recorded
 * @returns {PackageRecord[]}
 */
export function collectNuget(assetsFiles, packageFolders) {
  /** @type {Map<string, PackageRecord & { shippedPath?: string[], toolingPath?: string[] }>} */
  const byKey = new Map();

  for (const file of assetsFiles) {
    const assets = JSON.parse(readFileSync(file, 'utf8'));
    const projectName =
      assets.project?.restore?.projectName ??
      path.basename(path.dirname(path.dirname(file)));
    const test = isTestProject(
      projectName,
      assets.project?.restore?.projectPath,
    );
    const folders = packageFolders ?? Object.keys(assets.packageFolders ?? {});

    for (const [target, libraries] of Object.entries(assets.targets ?? {})) {
      const framework = target.split('/')[0];
      const direct = Object.entries(
        assets.project?.frameworks?.[framework]?.dependencies ?? {},
      )
        .filter(([, dependency]) => dependency.target !== 'Project')
        .map(([name]) => name);
      const paths = nugetPaths(projectName, libraries, direct);

      for (const [key, library] of Object.entries(libraries)) {
        if (library.type !== 'package') continue;
        const [name, version] = splitKey(key);
        const id = `${name.toLowerCase()}/${version.toLowerCase()}`;
        let record = byKey.get(id);
        if (!record) {
          record = {
            ecosystem: 'nuget',
            name,
            version,
            license: nuspecLicense(
              folders,
              assets.libraries?.[key]?.path ?? id,
              name,
            ),
            tier: 'tooling',
            path: [],
          };
          byKey.set(id, record);
        }
        const found = paths.get(name.toLowerCase()) ?? [projectName, name];
        if (!test) {
          record.tier = 'shipped';
          record.shippedPath ??= found;
        } else {
          record.toolingPath ??= found;
        }
      }
    }
  }

  return [...byKey.values()].map(({ shippedPath, toolingPath, ...record }) => ({
    ...record,
    path: (record.tier === 'shipped' ? shippedPath : toolingPath) ?? [],
  }));
}

function splitKey(key) {
  const slash = key.indexOf('/');
  return [key.slice(0, slash), key.slice(slash + 1)];
}

/** Breadth-first from the project's direct references through the resolved graph of one target. */
function nugetPaths(projectName, libraries, direct) {
  const byName = new Map(
    Object.entries(libraries).map(([key, library]) => [
      splitKey(key)[0].toLowerCase(),
      { key, library },
    ]),
  );
  const paths = new Map();
  const queue = [];
  // Project references bring their packages in too; start from them as well, after the direct packages.
  const projectRefs = Object.entries(libraries)
    .filter(([, library]) => library.type === 'project')
    .map(([key]) => splitKey(key)[0]);
  for (const name of [...direct, ...projectRefs]) {
    const lower = name.toLowerCase();
    if (byName.has(lower) && !paths.has(lower)) {
      paths.set(lower, [
        projectName,
        byName.get(lower).library.type === 'project'
          ? name
          : splitKey(byName.get(lower).key)[0],
      ]);
      queue.push(lower);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependency of Object.keys(
      byName.get(current).library.dependencies ?? {},
    )) {
      const lower = dependency.toLowerCase();
      if (byName.has(lower) && !paths.has(lower)) {
        paths.set(lower, [
          ...paths.get(current),
          splitKey(byName.get(lower).key)[0],
        ]);
        queue.push(lower);
      }
    }
  }
  return paths;
}

/** The SPDX expression of a package, or undefined when its nuspec only has a licenseUrl or a licence file. */
function nuspecLicense(folders, libraryPath, name) {
  for (const folder of folders) {
    const directory = path.join(folder, libraryPath);
    const nuspec = path.join(directory, `${name.toLowerCase()}.nuspec`);
    const file = existsSync(nuspec)
      ? nuspec
      : existsSync(directory)
        ? readdirSync(directory)
            .filter((f) => f.endsWith('.nuspec'))
            .map((f) => path.join(directory, f))[0]
        : undefined;
    if (!file) continue;
    const xml = readFileSync(file, 'utf8');
    const match = /<license\b([^>]*)>([^<]*)<\/license>/i.exec(xml);
    if (!match) return undefined;
    const type = /\btype\s*=\s*["']([^"']*)["']/i.exec(match[1])?.[1];
    return type?.toLowerCase() === 'expression'
      ? decodeXml(match[2].trim())
      : undefined;
  }
  throw new Error(
    `No .nuspec for ${name} under ${libraryPath} in ${folders.join(', ') || '(no package folders)'}. Run dotnet restore first.`,
  );
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------- the check

/**
 * @param {PackageRecord[]} records
 * @param {import('./policy.mjs').Policy} policy
 * @returns {PackageRecord[]} the packages whose licence is not allowed for their tier and have no exception
 */
export function checkLicenses(records, policy) {
  return records.filter((record) => {
    const allowed = allowedFor(record.tier, policy);
    if (spdxAllowed(parseSpdx(record.license), allowed)) return false;
    return !policy.licenseExceptions.some(
      (exception) =>
        exception.ecosystem === record.ecosystem &&
        sameName(record.ecosystem, exception.package, record.name) &&
        satisfiesRange(record.version, exception.versionRange),
    );
  });
}

function sameName(ecosystem, a, b) {
  // NuGet package IDs are case-insensitive; npm names are not.
  return ecosystem === 'nuget' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function allowedFor(tier, policy) {
  return tier === 'shipped'
    ? policy.licenses.shipped
    : [...policy.licenses.shipped, ...policy.licenses.tooling];
}

/** One failure, with everything needed to judge it and the exact entry to add if it is acceptable. */
export function formatLicenseFailure(record, policy) {
  const found =
    record.license === undefined
      ? 'none declared'
      : parseSpdx(record.license)
        ? `"${record.license}"`
        : `"${record.license}" (not an SPDX expression)`;
  const entry = {
    ecosystem: record.ecosystem,
    package: record.name,
    versionRange: record.version,
    reason: '<why this licence is acceptable, and where you checked it>',
  };
  return [
    `${record.ecosystem} package ${record.name}@${record.version} (${record.tier}): licence ${found} is not allowed.`,
    `  Pulled in by: ${record.path.join(' > ')}`,
    `  Allowed for ${record.tier}: ${allowedFor(record.tier, policy).join(', ')}`,
    `  If it is acceptable, add this to "licenseExceptions" in dependency-policy.json. That is a high-risk change the owner reviews:`,
    `    ${JSON.stringify(entry)}`,
  ].join('\n');
}

/** Runs the whole check against the repository. @returns {{ checked: number, failures: string[] }} */
export function checkRepositoryLicenses(
  policy,
  { root = REPO_ROOT, assetsFiles } = {},
) {
  const lock = JSON.parse(
    readFileSync(path.join(root, 'package-lock.json'), 'utf8'),
  );
  const files = assetsFiles ?? findAssetsFiles(path.join(root, 'apps/core'));
  if (files.length === 0) {
    throw new Error(
      'No restored .NET project found (apps/core/**/obj/project.assets.json). Run `dotnet restore apps/core/Helmstead.Core.slnx` first.',
    );
  }
  const records = [...collectNpm(lock), ...collectNuget(files)];
  return {
    checked: records.length,
    failures: checkLicenses(records, policy).map((record) =>
      formatLicenseFailure(record, policy),
    ),
  };
}
