import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, eligible, excerptsForChange, rankRelatedFiles } from '../src/context.js';
import { config, context, pr, repository } from './helpers.js';

test('excludes credentials, dependencies, lockfiles and binary files regardless of include', () => {
  for (const path of ['.env', 'config/.env.production', 'id_ed25519', 'config/credentials.json', 'config/secrets.yaml',
    'tls/private.key', 'service-account.json', '.aws/config', 'secrets/token.txt', 'app-credentials.json',
    '.npmrc', 'package-lock.json', 'pnpm-lock.yaml', 'Cargo.lock', 'node_modules/a.ts', 'vendor/a.py', 'dist/b.js', 'icon.png', '../secret']) {
    assert.equal(eligible(path, { include: ['**/*'], exclude: [] }), false, path);
  }
  for (const path of ['app.py', 'agent.ts', 'pipeline.go', 'prompts/system.md', 'prompt.txt', 'settings.yaml', '.github/workflows/review.yml']) {
    assert.equal(eligible(path, config), true, path);
  }
  assert.equal(eligible('docs/prompt.md', { include: ['src/**'], exclude: [] }), false);
  assert.equal(eligible('src/private.ts', { include: ['src/**'], exclude: ['**/private.*'] }), false);
});

test('builds line-accurate before/after hunks with 20 surrounding lines', () => {
  const before = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
  const after = [...before]; after[49] = 'new line';
  const hunks = excerptsForChange(before.join('\n'), after.join('\n'))!;
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0]![0]!.startLine, 30);
  assert.equal(hunks[0]![0]!.lines.length, 41);
  assert.deepEqual(hunks[0]![0]!.changedLines, [50]);
  assert.deepEqual(hunks[0]![1]!.changedLines, [50]);
});

test('added and removed files use the correct side and do not fetch nonexistent sources', async () => {
  const calls: Array<[string, string]> = [];
  const source = repository({ readSource: async (path, sha) => { calls.push([path, sha]); return { text: 'one\ntwo\n' }; } });
  const built = await buildContext(source, { ...pr, changedFiles: 2 }, [{ path: 'add.py', status: 'added' }, { path: 'remove.go', status: 'removed' }], config);
  assert.deepEqual(calls, [['add.py', pr.headSha], ['remove.go', pr.mergeBaseSha]]);
  assert.equal(built.context.files[0]!.excerpts[0]!.side, 'after');
  assert.equal(built.context.files[1]!.excerpts[0]!.side, 'before');
});

test('renames compare the old path at the merge base and the new path at the head', async () => {
  const calls: Array<[string, string]> = [];
  const source = repository({ readSource: async (path, sha) => { calls.push([path, sha]); return { text: sha === pr.mergeBaseSha ? 'old\n' : 'new\n' }; } });
  const built = await buildContext(source, pr, [{ path: 'new.ts', previousPath: 'old.ts', status: 'renamed' }], config);
  assert.deepEqual(calls, [['old.ts', pr.mergeBaseSha], ['new.ts', pr.headSha]]);
  assert.equal(built.context.files[0]!.previousPath, 'old.ts');
});

test('an excluded old name cannot be reintroduced through a rename', async () => {
  const source = repository({ readSource: async () => { throw new Error('must not fetch'); } });
  const built = await buildContext(source, pr, [{ path: 'public.txt', previousPath: '.env', status: 'renamed' }], config);
  assert.deepEqual(built.coverage.excludedFiles, ['public.txt']);
  assert.deepEqual(built.context.files, []);
});

test('oversized hunks are omitted explicitly and do not exceed the serialized budget', async () => {
  const source = repository({ readSource: async (_path, sha) => ({ text: sha === pr.mergeBaseSha ? 'short\n' : 'x'.repeat(5000) }) });
  const built = await buildContext(source, pr, [{ path: 'large.py', status: 'modified' }], { ...config, maxContextChars: 1000 });
  assert.ok(JSON.stringify(built.context).length <= 1000);
  assert.equal(built.coverage.omittedFiles.length, 1);
  assert.equal(built.context.files.length, 0);
});

test('reduces optional surrounding context before dropping a changed hunk', async () => {
  const before = [...Array.from({ length: 20 }, () => 'z'.repeat(50)), 'old', ...Array.from({ length: 20 }, () => 'z'.repeat(50))].join('\n');
  const source = repository({ readSource: async (_path, sha) => ({ text: sha === pr.mergeBaseSha ? before : before.replace('old', 'new') }) });
  const built = await buildContext(source, pr, [{ path: 'code.rs', status: 'modified' }], { ...config, maxContextChars: 1000 });
  assert.equal(built.coverage.reviewedFiles.length, 1);
  assert.ok(built.coverage.contextChars <= 1000);
  assert.equal(built.coverage.omittedFiles.length, 0);
  assert.equal(built.context.files[0]!.excerpts[0]!.startLine, 21);
});

test('source failures and incomplete file lists are visible coverage limitations', async () => {
  const built = await buildContext(repository({ readSource: async () => ({ reason: 'Binary content.' }) }), { ...pr, changedFiles: 3001 }, [{ path: 'a.py', status: 'modified' }], config, true);
  assert.equal(built.coverage.omittedFiles[0]!.reason, 'Binary content.');
  assert.equal(built.coverage.limitations.length, 1);
});

test('repository mode ranks explicit references first and deterministically breaks ties', () => {
  const input = structuredClone(context);
  input.files[0]!.path = 'src/pipeline.ts';
  input.files[0]!.excerpts[1]!.lines.push('import { fetchData } from "../lib/fetcher";');
  const files = ['src/z.ts', 'lib/fetcher.ts', 'src/a.ts', '.env', 'vendor/fetcher.ts'].map(path => ({ path, size: 10 }));
  const result = rankRelatedFiles(files, input, config).map(f => f.path);
  assert.equal(result[0], 'lib/fetcher.ts');
  assert.ok(result.indexOf('src/a.ts') < result.indexOf('src/z.ts'));
  assert.equal(result.includes('.env'), false);
});

test('default diff mode never discovers or fetches unrelated repository context', async () => {
  await buildContext(repository({ listRepositoryFiles: async () => { throw new Error('not allowed'); } }), pr, [{ path: 'pipeline.ts', status: 'modified' }], config);
});

test('repository mode adds at most 20 files and reports tree/candidate limitations', async () => {
  const source = repository({
    listRepositoryFiles: async () => ({ files: Array.from({ length: 25 }, (_, i) => ({ path: `src/helper${i}.ts`, size: 20 })), truncated: true }),
    readSource: async (path, sha) => ({ text: path.includes('helper') ? 'export const helper = 1;' : sha === pr.mergeBaseSha ? 'old' : 'new' }),
  });
  const built = await buildContext(source, pr, [{ path: 'src/pipeline.ts', status: 'modified' }], { ...config, contextMode: 'repository' });
  assert.equal(built.coverage.supportingFiles.length, 20);
  assert.equal(built.coverage.limitations.length, 2);
  assert.ok(built.context.files.slice(1).every(f => f.role === 'supporting' && f.excerpts[0]!.changedLines.length === 0));
});

test('omitted changed files do not return as supporting files', async () => {
  const source = repository({
    listRepositoryFiles: async () => ({ files: [{ path: 'src/unreadable.ts', size: 10 }], truncated: false }),
    readSource: async (path, sha) => path.includes('unreadable') ? { reason: 'Unavailable' } : { text: sha === pr.mergeBaseSha ? 'old' : 'new' },
  });
  const built = await buildContext(source, { ...pr, changedFiles: 2 }, [{ path: 'src/main.ts', status: 'modified' }, { path: 'src/unreadable.ts', status: 'modified' }], { ...config, contextMode: 'repository' });
  assert.equal(built.coverage.supportingFiles.length, 0);
  assert.equal(built.coverage.omittedFiles.length, 1);
});

test('repository mode supplies distant referenced helpers on both revisions before other files', async () => {
  const { loadFixtures, fixtureContext } = await import('../scripts/fixtures.js');
  const fixture = (await loadFixtures()).find(f => f.id === 'python-pipeline-tripled-tool-output')!;
  const diff = await fixtureContext(fixture, config);
  assert.equal(diff.context.files[0]!.excerpts.some(e => e.lines.some(l => l.includes('def model_tool_output'))), false);
  const built = await fixtureContext(fixture, { ...config, contextMode: 'repository' });
  for (const side of ['before', 'after']) {
    const helper = built.context.files[0]!.excerpts.find(e => e.side === side && e.lines.some(l => l.includes('def model_tool_output')));
    assert.ok(helper);
    assert.ok(helper.lines.some(l => l.includes('return json.dumps')));
    assert.deepEqual(helper.changedLines, []);
  }
  const { serializeContext } = await import('../src/context-format.js');
  assert.equal(built.coverage.contextChars, serializeContext(built.context).length);
  assert.ok(built.coverage.contextChars <= config.maxContextChars);
  const repeated = await fixtureContext(fixture, { ...config, contextMode: 'repository' });
  assert.equal(serializeContext(built.context), serializeContext(repeated.context));
});

test('same-file helpers obey budget, preserve changed code, and report omissions', async () => {
  const before = 'def encode(value):\n    return "' + 'x'.repeat(3000) + '"\n' + '\n'.repeat(50) + 'result = encode(value)\n';
  const after = before.replace('result = encode(value)', 'result = encode(value) * 3');
  const source = repository({ readSource: async (_path, sha) => ({ text: sha === pr.mergeBaseSha ? before : after }) });
  const built = await buildContext(source, pr, [{ path: 'code.py', status: 'modified' }], { ...config, contextMode: 'repository', maxContextChars: 1000 });
  assert.equal(built.coverage.reviewedFiles.length, 1);
  assert.ok(built.coverage.contextChars <= 1000);
  assert.ok(built.context.files[0]!.excerpts.some(e => e.changedLines.length));
  assert.ok(built.coverage.omittedFiles.some(o => /Referenced helper encode/.test(o.reason)));
});

test('same-file references use renamed before source and prioritize helpers over related files', async () => {
  const sourceText = 'def encode(value):\n    return str(value)\n' + '\n'.repeat(45) + 'output = encode(value)\n';
  const calls: string[] = [];
  const source = repository({
    readSource: async (path, sha) => {
      calls.push(path);
      return { text: path === 'src/other.py' ? 'x'.repeat(5000) : sha === pr.mergeBaseSha ? sourceText : sourceText.replace('output = encode(value)', 'output = encode(value) * 3') };
    },
    listRepositoryFiles: async () => ({ files: [{ path: 'src/other.py', size: 5000 }], truncated: false }),
  });
  const built = await buildContext(source, pr, [{ path: 'src/new.py', previousPath: 'src/old.py', status: 'renamed' }], { ...config, contextMode: 'repository', maxContextChars: 5000 });
  assert.deepEqual(calls.slice(0, 2), ['src/old.py', 'src/new.py']);
  assert.ok(built.context.files[0]!.excerpts.some(e => e.side === 'before' && e.lines.includes('def encode(value):')));
  assert.ok(built.coverage.omittedFiles.some(o => o.path === 'src/other.py'));
});

test('helper selection is bounded and keeps changed hunks ahead of dependency context', async () => {
  const helpers = Array.from({ length: 22 }, (_, i) => `def helper_${i}():\n    return "ok"\n`).join('\n');
  const calls = Array.from({ length: 22 }, (_, i) => `helper_${i}()`).join(' + ');
  const before = helpers + '\n'.repeat(45) + `result = ${calls}\n`;
  const source = repository({ readSource: async (path, sha) => ({ text: path === 'z.py'
    ? sha === pr.mergeBaseSha ? 'old' : 'new'
    : sha === pr.mergeBaseSha ? before : before.replace('result = ', 'result = "prefix" + ') }) });
  const built = await buildContext(source, { ...pr, changedFiles: 2 }, [{ path: 'a.py', status: 'modified' }, { path: 'z.py', status: 'modified' }], { ...config, contextMode: 'repository' });
  assert.deepEqual(built.coverage.reviewedFiles, ['a.py', 'z.py']);
  assert.equal(built.context.files[0]!.excerpts.filter(e => !e.changedLines.length && e.lines[0]?.startsWith('def helper_')).length, 40);
  assert.ok(built.coverage.omittedFiles.some(o => /20-definition/.test(o.reason)));
});

test('long definitions are explicitly truncated and single-line brace helpers do not absorb following functions', async () => {
  const { sameFileDependencies } = await import('../src/dependencies.js');
  const input = structuredClone(context).files[0]!;
  input.excerpts = [{ side: 'after', startLine: 200, lines: ['const output = encode(data);'], changedLines: [200] }];
  const before = 'function encode(data) { return JSON.stringify(data); }\nfunction unrelated() { return "unused"; }';
  const deps = sameFileDependencies(input, before, before);
  assert.equal(deps.length, 1);
  assert.equal(deps[0]!.excerpts[0]!.lines.length, 1);
  const python = 'def encode(data):\n' + '    result = data\n'.repeat(150);
  const long = sameFileDependencies(input, python, python)[0]!;
  assert.equal(long.truncated, true);
  assert.equal(long.excerpts[0]!.lines.length, 120);
});
