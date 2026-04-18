import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';

import { rimraf } from 'rimraf';

const TEX_NAME = 'kookio_thesis';
const TEX_FILE = `${TEX_NAME}.tex`;

const TEMP_GLOBS = [
  '*.pdf', '*.aux', '*.log', '*.out', '*.toc', '*.run.xml',
  '*.nav', '*.snm', '*.fls', '*.fdb_latexmk',
  '*.acn', '*.glo', '*.ist', '*.gls-abr', '*.gls',
  '*.glo-abr', '*.glg-abr', '*.glg',
];
const BIB_GLOBS = ['*.bcf', '*.blg', '*.bbl'];

const isTTY = output.isTTY;
const color = {
  green:  isTTY ? '\x1b[0;32m' : '',
  yellow: isTTY ? '\x1b[1;33m' : '',
  blue:   isTTY ? '\x1b[0;34m' : '',
  bold:   isTTY ? '\x1b[1m'    : '',
  reset:  isTTY ? '\x1b[0m'    : '',
};

const log = {
  info:  (msg: string) => console.log(`${color.blue}[INFO]${color.reset}  ${msg}`),
  ok:    (msg: string) => console.log(`${color.green}[OK]${color.reset}    ${msg}`),
  warn:  (msg: string) => console.error(`${color.yellow}[WARN]${color.reset}  ${msg}`),
  error: (msg: string) => console.error(`\x1b[0;31m[ERROR]\x1b[0m ${msg}`),
};

const showHelp = (): void => {
  const { bold: b, reset: r } = color;
  console.log(`${b}build.ts${r} - Compile LaTeX thesis

${b}USAGE${r}
  tsx build.ts <lang> [--delete | --draft | --full | --help]

${b}OPTIONS${r}
  --delete   Delete auxiliary files only
  --draft    Compile without bibliography (faster)
  --full     Compile with bibliography (default)
  --help     Show this help message

${b}EXAMPLES${r}
  tsx build.ts ro
  tsx build.ts ro --draft
  tsx build.ts ro --delete
`);
};

const timestamp = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
};

const checkTool = (name: string): Promise<boolean> =>
  new Promise((res) => {
    const p = spawn(name, ['--version'], { stdio: 'ignore' });
    p.on('error', () => res(false));
    p.on('exit', () => res(true));
  });

const run = (cmd: string, args: string[]): Promise<void> =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('error', rej);
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited with code ${code}`))));
  });

const main = async (): Promise<void> => {
  const [lang, flag = ''] = process.argv.slice(2);

  if (!lang || lang === '--help') {
    showHelp();
    return;
  }

  switch (flag) {
    case '--delete':
    case '--draft':
    case '--full':
    case '':         break;
    default:
      log.error(`Unknown option: ${flag}`);
      process.exit(1);
  }

  const mode = flag === '--draft' ? 'draft' : flag === '--delete' ? 'delete' : 'full';

  if (!existsSync(lang)) {
    log.error(`Language folder '${lang}' not found.`);
    process.exit(1);
  }

  const distPath = resolve(process.cwd(), 'dist');
  const pdfName  = `${TEX_NAME}_${lang}.pdf`;

  process.chdir(lang);

  if (!existsSync(TEX_FILE)) {
    log.error(`'${TEX_FILE}' not found in '${lang}/'.`);
    process.exit(1);
  }

  if (!(await checkTool('lualatex'))) {
    log.error("'lualatex' not found in PATH.");
    process.exit(1);
  }
  if (mode === 'full' && !(await checkTool('biber'))) {
    log.error("'biber' not found in PATH.");
    process.exit(1);
  }

  log.info('Deleting generated files...');
  await rimraf(TEMP_GLOBS, { glob: true });
  if (mode === 'full' || mode === 'delete') {
    await rimraf(BIB_GLOBS, { glob: true });
  }

  if (mode === 'delete') {
    log.ok('Done deleting.');
    return;
  }

  log.info(`Compiling '${lang}' (mode: ${mode})...`);
  await run('lualatex', [TEX_FILE]);

  if (mode === 'full') {
    await run('makeglossaries', [TEX_NAME]);
    await run('biber', [TEX_NAME]);
    await run('lualatex', [TEX_FILE]);
  }

  mkdirSync(distPath, { recursive: true });

  const destPdf = resolve(distPath, pdfName);
  if (existsSync(destPdf)) {
    copyFileSync(destPdf, resolve(distPath, `${TEX_NAME}_${lang}_backup_${timestamp()}.pdf`));
  }

  renameSync(`${TEX_NAME}.pdf`, destPdf);
  log.ok(`PDF saved as: dist/${pdfName}`);
};

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
