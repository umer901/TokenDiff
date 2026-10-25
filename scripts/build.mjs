import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
});
for (const file of result.outputFiles) {
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
