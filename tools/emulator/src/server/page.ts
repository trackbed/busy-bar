// The emulator's page: HTML, CSS, and its TypeScript served as JavaScript.
// Node strips the types, the same way apps in this repository run from
// source, so the page needs no bundler or build step.

import { readdir, readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join } from 'node:path';

/** One file of the page, ready to send. */
export interface PageFile {
  readonly contentType: string;
  readonly body: string;
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
};

/**
 * Load every page file in `directory`, keyed by its URL path. `index.html`
 * answers `/`, and TypeScript modules keep their `.ts` names so their
 * relative imports resolve unchanged in the browser.
 */
export async function loadPage(
  directory: string,
): Promise<Map<string, PageFile>> {
  const files = new Map<string, PageFile>();
  for (const name of await readdir(directory)) {
    const contentType = TYPES[extname(name)];
    if (contentType === undefined || name.endsWith('.test.ts')) {
      continue;
    }
    const source = await readFile(join(directory, name), 'utf8');
    const body = name.endsWith('.ts') ? stripTypeScriptTypes(source) : source;
    files.set(name === 'index.html' ? '/' : `/${name}`, { contentType, body });
  }
  return files;
}
