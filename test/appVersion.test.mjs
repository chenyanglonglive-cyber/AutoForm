import assert from 'node:assert/strict';
import test from 'node:test';
import { readAppVersion } from '../src/appVersion.js';

test('uses the current Git tag and exposes uncommitted changes', async () => {
  const version = await readAppVersion({ runGit: async () => 'v1.2.3-dirty\n' });
  assert.deepEqual(version, { version: 'v1.2.3', dirty: true, source: 'git-tag' });
});

test('uses a commit reference when no tag is reachable', async () => {
  const version = await readAppVersion({ runGit: async () => 'a1b2c3d\n' });
  assert.deepEqual(version, { version: 'a1b2c3d', dirty: false, source: 'git-commit' });
});

test('returns a safe fallback when Git is unavailable', async () => {
  const version = await readAppVersion({ runGit: async () => { throw new Error('Git unavailable'); } });
  assert.deepEqual(version, { version: 'unknown', dirty: false, source: 'unavailable' });
});
