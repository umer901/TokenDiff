import { readFile } from 'node:fs/promises';
import { buildContext } from '../src/context.js';
import type { Config, Finding, SourceRepository } from '../src/types.js';

export interface Fixture {
  id: string;
  path: string;
  before: string;
  after: string;
  expectedCategories: Finding['category'][];
}

export async function loadFixtures(): Promise<Fixture[]> {
  const files = await Promise.all(['reviews.json', 'pipelines.json', 'architecture.json'].map(name => readFile(new URL(`../tests/fixtures/${name}`, import.meta.url), 'utf8')));
  return files.flatMap(text => JSON.parse(text) as Fixture[]);
}

export async function fixtureContext(fixture: Fixture, config: Config) {
  const repository: SourceRepository = {
    readSource: async (_path, sha) => ({ text: sha === 'before' ? fixture.before : fixture.after }),
    listRepositoryFiles: async () => ({ files: [], truncated: false }),
  };
  return buildContext(repository, {
    owner: 'fixture', repo: 'fixture', number: 1, baseSha: 'before', mergeBaseSha: 'before', headSha: 'after', changedFiles: 1, url: '',
  }, [{ path: fixture.path, status: 'modified' }], config);
}
