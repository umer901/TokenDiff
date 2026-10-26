// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

import { build } from 'esbuild';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const result = await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outfile: 'dist/index.cjs',
  write: false,
  minify: true,
  legalComments: 'external',
  sourcemap: false,
  logLevel: 'warning',
  metafile: true,
  banner: { js: '/*! TokenDiff | Copyright (C) 2026 TokenDiff contributors | GPL-3.0-or-later\nSource: https://github.com/umer901/TokenDiff | See LICENSE and dist/THIRD_PARTY_NOTICES.md. */' },
});
const packageRoots = new Set(Object.keys(result.metafile.inputs).flatMap(path => {
  const parts = path.split('/');
  const index = parts.lastIndexOf('node_modules');
  if (index < 0) return [];
  const count = parts[index + 1].startsWith('@') ? 3 : 2;
  return [parts.slice(0, index + count).join('/')];
}));
const notices = ['# Bundled third-party notices', '',
  'Generated from the packages actually included by esbuild. TokenDiff is GPL-3.0-or-later; these dependencies retain their own licenses.', ''];
for (const root of [...packageRoots].sort()) {
  const pkg = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
  const licenses = (await readdir(root, { recursive: true })).filter(name =>
    !name.split(/[\\/]/).includes('node_modules') && /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i.test(basename(name))).sort();
  notices.push(`## ${pkg.name}@${pkg.version}`, '', `Declared license: ${pkg.license ?? 'see text below'}`, '');
  if (!licenses.length) {
    const readme = await readFile(`${root}/README.md`, 'utf8').catch(() => '');
    const section = readme.match(/(?:^|\n)(?:#{1,6} )?License\r?\n(?:[-=]+\r?\n)?([\s\S]+)/i)?.[1];
    if (!section || !/copyright/i.test(section)) throw new Error(`No third-party license text found for ${pkg.name}; inspect it before distributing the bundle.`);
    notices.push('### License section from README.md', '', section.trim(), '');
  }
  for (const license of licenses) notices.push(`### ${license}`, '', await readFile(`${root}/${license}`, 'utf8'), '');
}
const files = [...result.outputFiles, { path: resolve('dist/THIRD_PARTY_NOTICES.md'), contents: Buffer.from(notices.join('\n')) }];
for (const file of files) {
  if (process.argv.includes('--check')) {
    const existing = await readFile(file.path).catch(() => null);
    if (!existing?.equals(Buffer.from(file.contents))) {
      throw new Error(`Bundle is missing or stale: ${file.path}. Run npm run build.`);
    }
  } else {
    await mkdir(resolve('dist'), { recursive: true });
    await writeFile(file.path, file.contents);
  }
}
console.log(process.argv.includes('--check') ? 'Bundle matches source.' : 'Built dist/index.cjs.');
