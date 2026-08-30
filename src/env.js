import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function loadDotEnv(filePath = path.resolve(process.cwd(), '.env')) {
  if (!existsSync(filePath)) {
    return;
  }

  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimEnvValue(trimmed.slice(separatorIndex + 1).trim());
    if (key && !Object.hasOwn(process.env, key)) {
      process.env[key] = value;
    }
  }
}

function trimEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
