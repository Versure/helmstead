#!/usr/bin/env node
// The supply-chain checks of spec 003, for verify.mjs, CI and people:
//   node tools/supply-chain/cli.mjs policy                       validate dependency-policy.json
//   node tools/supply-chain/cli.mjs licenses                     offline licence check (npm + restored NuGet)
//   node tools/supply-chain/cli.mjs vulnerabilities              online: npm audit + dotnet list package --vulnerable
//   node tools/supply-chain/cli.mjs vulnerabilities --npm-audit <file> --dotnet-list <file>
//                                                                the same check on saved JSON output
//   node tools/supply-chain/cli.mjs gitleaks-path                print the path of the pinned gitleaks (downloads it)
//   node tools/supply-chain/cli.mjs secrets --log-opts <opts>    scan commits with the pinned gitleaks
// Exit code 0 means the check passed; anything else means it failed or could not run.
import { checkRepositoryLicenses } from './licenses.mjs';
import { loadPolicy } from './policy.mjs';

const [command, ...rest] = process.argv.slice(2);

const commands = {
  policy: async () => {
    loadPolicy();
    console.log('dependency-policy.json is valid.');
    return 0;
  },
  licenses: async () => {
    const { checked, failures } = checkRepositoryLicenses(loadPolicy());
    if (failures.length > 0) {
      console.error(
        `Licence check failed: ${failures.length} of ${checked} packages are not allowed.\n`,
      );
      console.error(failures.join('\n\n'));
      return 1;
    }
    console.log(`Licence check passed: ${checked} packages (npm and NuGet).`);
    return 0;
  },
  vulnerabilities: async () => {
    const { runVulnerabilityCheck } = await import('./advisories.mjs');
    return runVulnerabilityCheck(
      loadPolicy(),
      option('--npm-audit'),
      option('--dotnet-list'),
    );
  },
  'gitleaks-path': async () => {
    const { ensureGitleaks } = await import('./gitleaks.mjs');
    console.log(await ensureGitleaks());
    return 0;
  },
  secrets: async () => {
    const { scanHistory } = await import('./gitleaks.mjs');
    return scanHistory({
      logOpts: option('--log-opts'),
      report: option('--report'),
    });
  },
};

function option(name) {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
}

const run = commands[command];
if (!run) {
  console.error(
    `Unknown command "${command ?? ''}". Use one of: ${Object.keys(commands).join(', ')}.`,
  );
  process.exit(2);
}
try {
  process.exit(await run());
} catch (error) {
  // A check that cannot run fails; it never reads as passed.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
