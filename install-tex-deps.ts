import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { color, log, checkTool, run, runCapture } from './utils.js';

const REQ_FILE = 'tex-requirements.txt';

const showHelp = (): void => {
  const { bold: b, reset: r } = color;
  console.log(`${b}install-tex-deps.ts${r} - Install TeX Live dependencies for thesis compilation

${b}USAGE${r}
  tsx install-tex-deps.ts [--check | --update | --help]

${b}OPTIONS${r}
  --check    Verify installed packages without installing anything
  --update   Update tlmgr and all currently installed packages
  --help     Show this help message

${b}EXAMPLES${r}
  tsx install-tex-deps.ts            # install missing packages (default)
  tsx install-tex-deps.ts --check    # report missing packages only
  tsx install-tex-deps.ts --update   # update tlmgr + installed packages
`);
};

const parseRequirements = (path: string): string[] => {
  const content = readFileSync(path, 'utf8');
  const packages: string[] = [];
  for (const rawLine of content.split('\n')) {
    // Strip inline comments and surrounding whitespace
    const line = rawLine.split('#')[0].trim();
    if (line.length === 0) continue;
    packages.push(line);
  }
  return packages;
};

const getInstalledPackages = async (): Promise<Set<string>> => {
  // Single tlmgr call is far faster than N individual `tlmgr info` queries
  const { code, stdout } = await runCapture('tlmgr', ['list', '--only-installed']);
  if (code !== 0) {
    throw new Error('Could not query installed packages via tlmgr');
  }
  const installed = new Set<string>();
  // Output format: "i package-name: Description"
  for (const line of stdout.split('\n')) {
    const match = line.match(/^i\s+([a-z0-9_-]+):/i);
    if (match) installed.add(match[1]);
  }
  return installed;
};

type Mode = 'install' | 'check' | 'update';

const main = async (): Promise<void> => {
  const [flag = ''] = process.argv.slice(2);

  if (flag === '--help' || flag === '-h') {
    showHelp();
    return;
  }

  switch (flag) {
    case '--check':
    case '--update':
    case '':         break;
    default:
      log.error(`Unknown option: ${flag}`);
      process.exit(1);
  }

  const mode: Mode = flag === '--check' ? 'check' : flag === '--update' ? 'update' : 'install';

  const reqPath = resolve(process.cwd(), REQ_FILE);

  if (!existsSync(reqPath)) {
    log.error(`'${REQ_FILE}' not found in '${process.cwd()}'.`);
    process.exit(1);
  }

  if (!(await checkTool('tlmgr'))) {
    log.error("'tlmgr' not found in PATH.");
    log.error('Install TeX Live first:');
    log.error('  macOS:          brew install --cask mactex');
    log.error('  Ubuntu/Debian:  sudo apt install texlive-base');
    log.error('  Windows:        MikTeX auto-installs packages on first compile');
    process.exit(1);
  }

  if (!(await checkTool('biber'))) {
    log.warn("'biber' not found in PATH (will be installed via tlmgr if listed).");
  }

  const packages = parseRequirements(reqPath);
  log.info(`Identified ${packages.length} packages in ${REQ_FILE}.`);

  if (mode === 'update') {
    log.info('Updating tlmgr self...');
    await run('tlmgr', ['update', '--self']);
    log.info('Updating all installed packages...');
    await run('tlmgr', ['update', '--all']);
    log.ok('Update complete.');
    return;
  }

  log.info('Querying installed packages...');
  const installed = await getInstalledPackages();

  if (mode === 'check') {
    log.info('Checking package status (check mode, no changes will be made)...');
    const missing: string[] = [];
    for (const pkg of packages) {
      if (installed.has(pkg)) {
        console.log(`  ${color.green}✓${color.reset} ${pkg}`);
      } else {
        console.log(`  ${color.red}✗${color.reset} ${pkg} (missing)`);
        missing.push(pkg);
      }
    }
    console.log('');
    if (missing.length === 0) {
      log.ok('All packages are installed.');
    } else {
      log.warn(`${missing.length} package(s) missing. Run without --check to install them.`);
      process.exit(1);
    }
    return;
  }

  // mode === 'install'
  log.info('Updating tlmgr...');
  try {
    await run('tlmgr', ['update', '--self']);
  } catch {
    log.warn('tlmgr self-update failed (continuing with installation).');
  }

  log.info('Installing missing packages...');
  let installedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  for (const pkg of packages) {
    if (installed.has(pkg)) {
      console.log(`  → ${pkg} (already installed)`);
      skippedCount++;
    } else {
      console.log(`  → ${pkg} (installing...)`);
      try {
        await run('tlmgr', ['install', pkg]);
        installedCount++;
      } catch {
        log.warn(`${pkg}: installation failed (may be part of an already-present bundle)`);
        failedCount++;
      }
    }
  }

  console.log('');
  log.ok(`Done. Installed: ${installedCount}, skipped: ${skippedCount}, failed: ${failedCount}.`);
  log.info('Verify with: lualatex --version && biber --version');
};

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
