// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

import type { Config } from './types.js';

export class ConfigurationError extends Error {}

export type GetInput = (name: string) => string;

function integer(input: string, fallback: number, name: string, min: number, max: number): number {
  if (!input) return fallback;
  if (!/^\d+$/.test(input)) throw new ConfigurationError(`${name} must be a whole number.`);
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigurationError(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

function globs(value: string): string[] {
  const values = value.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  if (values.length > 100 || values.some(s => s.length > 500 || s.startsWith('!'))) {
    throw new ConfigurationError('Use at most 100 include/exclude globs, each at most 500 characters. Use exclude instead of negated globs.');
  }
  return values;
}

export function readConfig(input: GetInput): Config {
  const provider = input('provider').trim();
  if (provider !== 'gemini' && provider !== 'openai') {
    throw new ConfigurationError('Set provider to gemini or openai.');
  }
  const model = input('model').trim();
  if (!model || model.length > 200 || !/^[\w./:-]+$/.test(model)) {
    throw new ConfigurationError('Set model to an explicit model ID supported by your selected provider.');
  }
  const contextMode = input('context-mode').trim() || 'diff';
  if (contextMode !== 'diff' && contextMode !== 'repository') {
    throw new ConfigurationError('Set context-mode to diff or repository.');
  }
  const apiKey = input('api-key').trim();
  const githubToken = input('github-token').trim();
  if (apiKey && !githubToken) {
    throw new ConfigurationError('github-token is required when reviewing a PR. Use github.token.');
  }
  return {
    provider, model, apiKey, githubToken, contextMode,
    include: globs(input('include')), exclude: globs(input('exclude')),
    maxContextChars: integer(input('max-context-chars'), 60_000, 'max-context-chars', 1_000, 1_000_000),
    maxOutputTokens: integer(input('max-output-tokens'), 4096, 'max-output-tokens', 256, 32_768),
  };
}
