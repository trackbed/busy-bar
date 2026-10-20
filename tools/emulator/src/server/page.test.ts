import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadPage } from './page.ts';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'emulator-page-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function put(files: Readonly<Record<string, string>>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(([name, body]) =>
      writeFile(join(directory, name), body),
    ),
  );
}

describe('loadPage', () => {
  it('serves index.html at the root and other files by name', async () => {
    await put({
      'index.html': '<!doctype html><title>Emulator</title>',
      'help.html': '<p>Help</p>',
      'style.css': 'body { color: red; }',
    });

    const page = await loadPage(directory);

    expect(Object.fromEntries(page)).toStrictEqual({
      '/': {
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><title>Emulator</title>',
      },
      '/help.html': {
        contentType: 'text/html; charset=utf-8',
        body: '<p>Help</p>',
      },
      '/style.css': {
        contentType: 'text/css; charset=utf-8',
        body: 'body { color: red; }',
      },
    });
  });

  it('serves TypeScript as JavaScript under its own name', async () => {
    await put({
      'app.ts': "import { x } from './x.ts';\nconst answer: number = x;\n",
    });

    const page = await loadPage(directory);

    // Node strips the types and keeps every other character in place, so
    // the browser resolves the same relative import.
    expect(page.get('/app.ts')).toStrictEqual({
      contentType: 'text/javascript; charset=utf-8',
      body: "import { x } from './x.ts';\nconst answer         = x;\n",
    });
  });

  it('skips tests, other files, and folders', async () => {
    await put({
      'app.test.ts': 'it("works", () => {});',
      'notes.md': '# Notes',
      'logo.png': 'not served',
    });
    await mkdir(join(directory, 'assets'));

    expect((await loadPage(directory)).size).toBe(0);
  });
});
