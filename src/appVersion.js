import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function readAppVersion({ cwd = process.cwd(), runGit = defaultRunGit } = {}) {
  try {
    const raw = String(await runGit(['describe', '--tags', '--always', '--dirty'], cwd)).trim();
    if (!raw) throw new Error('Git returned an empty version.');
    const dirty = raw.endsWith('-dirty');
    return {
      version: dirty ? raw.slice(0, -'-dirty'.length) : raw,
      dirty,
      source: raw.startsWith('v') ? 'git-tag' : 'git-commit'
    };
  } catch {
    return { version: 'unknown', dirty: false, source: 'unavailable' };
  }
}

async function defaultRunGit(args, cwd) {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true });
  return stdout;
}
