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
  return JSON.parse(await readFile(new URL('../tests/fixtures/reviews.json', import.meta.url), 'utf8')) as Fixture[];
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
