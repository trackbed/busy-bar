// Build the app catalogue: run every app's `preview` target, draw each scene
// with the emulator, and write dist/catalogue/index.html.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createProjectGraphAsync, workspaceRoot } from '@nx/devkit';

import {
  FIRMWARE_COMMIT,
  openFirmwareAssets,
  screenshotDraw,
} from '@busy-bar-apps/emulator';

import { appProjects, runPreview } from './apps.ts';
import { catalogueApp } from './catalogue.ts';
import { CatalogueError } from './error.ts';
import { cataloguePage } from './page.ts';
import { parsePreview } from './preview.ts';

const outDir = join(workspaceRoot, 'dist', 'catalogue');

try {
  const projects = appProjects(
    await createProjectGraphAsync({ exitOnError: true }),
  );
  const [assets, outputs] = await Promise.all([
    openFirmwareAssets(),
    Promise.all(projects.map((project) => runPreview(project, workspaceRoot))),
  ]);
  const now = Date.now();
  const apps = await Promise.all(
    projects.map((project, index) =>
      catalogueApp(
        project,
        parsePreview(project.name, outputs[index] ?? ''),
        (body, at) => screenshotDraw(assets, body, at),
        now,
      ),
    ),
  );
  const page = cataloguePage({
    apps,
    style: await readFile(join(import.meta.dirname, 'page.css'), 'utf8'),
    firmwareCommit: FIRMWARE_COMMIT,
    rootHref: relative(outDir, workspaceRoot),
  });
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'index.html'), page);
  console.log(`App catalogue: ${join(outDir, 'index.html')}`);
} catch (error) {
  if (!(error instanceof CatalogueError)) {
    throw error;
  }
  console.error(error.message);
  process.exitCode = 1;
}
