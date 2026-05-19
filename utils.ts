import { spawn } from 'node:child_process';
import { stdout as output } from 'node:process';

const isTTY = output.isTTY;

export const color = {
  green:  isTTY ? '\x1b[0;32m' : '',
  red:    isTTY ? '\x1b[0;31m' : '',
  yellow: isTTY ? '\x1b[1;33m' : '',
  blue:   isTTY ? '\x1b[0;34m' : '',
  bold:   isTTY ? '\x1b[1m'    : '',
  reset:  isTTY ? '\x1b[0m'    : '',
};

export const log = {
  info:  (msg: string) => console.log(`${color.blue}[INFO]${color.reset}  ${msg}`),
  ok:    (msg: string) => console.log(`${color.green}[OK]${color.reset}    ${msg}`),
  warn:  (msg: string) => console.error(`${color.yellow}[WARN]${color.reset}  ${msg}`),
  error: (msg: string) => console.error(`${color.red}[ERROR]${color.reset} ${msg}`),
};

export const checkTool = (name: string): Promise<boolean> =>
  new Promise((res) => {
    const p = spawn(name, ['--version'], { stdio: 'ignore' });
    p.on('error', () => res(false));
    p.on('exit', () => res(true));
  });

export const run = (cmd: string, args: string[]): Promise<void> =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('error', rej);
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited with code ${code}`))));
  });

export const runCapture = (cmd: string, args: string[]): Promise<{ code: number; stdout: string }> =>
  new Promise((res) => {
    const p = spawn(cmd, args);
    let stdout = '';
    p.stdout?.on('data', (d) => (stdout += d.toString()));
    p.stderr?.on('data', (d) => (stdout += d.toString()));
    p.on('error', () => res({ code: 1, stdout }));
    p.on('exit', (code) => res({ code: code ?? 1, stdout }));
  });
