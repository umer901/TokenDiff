// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Release checks require Node 24 or newer.');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
if (pkg.version !== lock.version || pkg.version !== lock.packages[''].version) throw new Error('Package and lockfile versions differ.');
if (pkg.license !== 'GPL-3.0-or-later' || lock.packages[''].license !== pkg.license) throw new Error('Project license metadata must agree.');
if (!pkg.private) throw new Error('This is a GitHub Action; keep accidental npm publication disabled.');
const action = await readFile('action.yml', 'utf8');
if (!/^  using: node24$/m.test(action) || !/^  main: dist\/index.cjs$/m.test(action)) throw new Error('Check the Action runtime and bundled entry point.');
const required = ['LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md',
  'docs/releasing.md', 'docs/optimization-knowledge.md', 'examples/tokendiff.yml',
  'dist/index.cjs', 'dist/index.cjs.LEGAL.txt', 'dist/THIRD_PARTY_NOTICES.md'];
for (const path of required) if (!(await stat(path)).size) throw new Error(`Release file is empty: ${path}`);
const license = await readFile('LICENSE', 'utf8');
if (!license.includes('GNU GENERAL PUBLIC LICENSE') || !license.includes('Version 3, 29 June 2007')) throw new Error('Expected the full GPLv3 license text.');

const roots = ['src', 'scripts', 'tests', 'docs', 'examples', '.github', 'dist'];
const files = ['README.md', 'NOTICE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'action.yml', 'package.json'];
for (const root of roots) {
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) files.push(join(entry.parentPath, entry.name));
  }
}
// A limited accidental-secret check, not a substitute for reviewing staged files.
const secrets = [
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['provider key', /\b(?:AIza[A-Za-z0-9_-]{35}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}|AQ\.[A-Za-z0-9_-]{40,})\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
for (const path of files) {
  const text = await readFile(path, 'utf8');
  for (const [label, pattern] of secrets) {
    if (pattern.test(text)) throw new Error(`Possible ${label} in ${path}. Inspect locally; its value is intentionally not logged.`);
  }
}
console.log(`Release files and metadata verified for v${pkg.version}; ${files.length} files checked for common credential patterns.`);
console.log('This check does not publish, run Git, verify repository history, or replace the hosted release smoke test.');
