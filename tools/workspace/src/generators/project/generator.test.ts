import { execFileSync, spawnSync } from 'node:child_process';
import type { Tree } from '@nx/devkit';
import { installPackagesTask, readJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addUvWorkspaceMember, projectGenerator } from './generator.ts';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn<(...args: unknown[]) => void>(),
  spawnSync: vi.fn<(...args: unknown[]) => void>(),
}));
vi.mock('@nx/devkit', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  installPackagesTask: vi.fn<(...args: unknown[]) => void>(),
}));

const ROOT_PYPROJECT = `# uv workspace root.

[tool.uv.workspace]
# Listed one by one.
members = ["libs/bar-kit-py", "apps/countdown"]

[tool.ruff]
target-version = "py314"
`;

/** What `uv run python -c ...` reports for the module-name probe. */
function probeResult(
  status: number | null,
  stderr = '',
): ReturnType<typeof spawnSync> {
  return { pid: 0, output: [], stdout: '', stderr, status, signal: null };
}

interface Tsconfig {
  references: { path: string }[];
}

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
}

interface ProjectJson {
  name: string;
  tags: string[];
}

describe('projectGenerator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    tree.write(
      'tsconfig.json',
      JSON.stringify({ files: [], references: [{ path: './libs/bar-kit' }] }),
    );
    tree.write('pyproject.toml', ROOT_PYPROJECT);
    vi.mocked(spawnSync).mockReturnValue(probeResult(0));
  });

  it('creates a TypeScript app that draws with bar-kit', () => {
    projectGenerator(tree, {
      name: 'weather-station',
      language: 'ts',
      skipInstall: true,
    });

    expect(
      readJson<ProjectJson>(tree, 'apps/weather-station/project.json'),
    ).toMatchObject({ name: 'weather-station', tags: ['type:app', 'lang:ts'] });
    expect(
      readJson<PackageJson>(tree, 'apps/weather-station/package.json'),
    ).toEqual({
      name: '@busy-bar-apps/weather-station',
      version: '0.0.1',
      private: true,
      type: 'module',
      dependencies: { '@busy-bar-apps/bar-kit': 'workspace:0.0.1' },
    });
    expect(tree.read('apps/weather-station/src/render.ts', 'utf8')).toContain(
      "text: 'WEATHER STATION'",
    );
    expect(tree.read('apps/weather-station/src/main.ts', 'utf8')).toContain(
      "name: 'weather-station'",
    );
    expect(readJson<Tsconfig>(tree, 'tsconfig.json').references).toEqual([
      { path: './libs/bar-kit' },
      { path: './apps/weather-station' },
    ]);
  });

  it('creates a TypeScript lib with a public entry point', () => {
    tree.write('tsconfig.json', JSON.stringify({ files: [] }));
    projectGenerator(tree, {
      name: 'weather-api',
      language: 'ts',
      type: 'lib',
      skipInstall: true,
    });

    expect(
      readJson<ProjectJson>(tree, 'libs/weather-api/project.json').tags,
    ).toEqual(['type:lib', 'lang:ts']);
    expect(tree.read('libs/weather-api/src/index.ts', 'utf8')).toContain(
      "export { weatherApi } from './weather-api.ts';",
    );
    expect(tree.exists('libs/weather-api/src/weather-api.test.ts')).toBe(true);
    expect(readJson<Tsconfig>(tree, 'tsconfig.json').references).toEqual([
      { path: './libs/weather-api' },
    ]);
  });

  it('creates a Python app and adds it to the uv workspace', () => {
    projectGenerator(tree, {
      name: 'weather-station',
      language: 'python',
      skipInstall: true,
    });

    expect(
      readJson<ProjectJson>(tree, 'apps/weather-station/project.json').tags,
    ).toEqual(['type:app', 'lang:python']);
    expect(tree.read('apps/weather-station/pyproject.toml', 'utf8')).toContain(
      'bar-kit = { workspace = true }',
    );
    expect(
      tree.exists('apps/weather-station/src/weather_station/__main__.py'),
    ).toBe(true);
    expect(
      tree.read('apps/weather-station/tests/test_render.py', 'utf8'),
    ).toContain('from weather_station.render import render');
    expect(tree.read('pyproject.toml', 'utf8')).toContain(
      'members = [\n  "apps/countdown",\n  "apps/weather-station",\n  "libs/bar-kit-py",\n]',
    );
  });

  it('creates a Python lib without app wiring', () => {
    projectGenerator(tree, {
      name: 'weather-api',
      language: 'python',
      type: 'lib',
      skipInstall: true,
    });

    expect(tree.exists('libs/weather-api/src/weather_api/__init__.py')).toBe(
      true,
    );
    expect(tree.exists('libs/weather-api/tests/test_weather_api.py')).toBe(
      true,
    );
    expect(tree.read('libs/weather-api/pyproject.toml', 'utf8')).not.toContain(
      'bar-kit',
    );
  });

  it('links a new TypeScript project with yarn install', async () => {
    await projectGenerator(tree, { name: 'weather-station', language: 'ts' })();

    expect(installPackagesTask).toHaveBeenCalledExactlyOnceWith(tree, true);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('relocks the uv workspace after a new Python project', async () => {
    await projectGenerator(tree, {
      name: 'weather-station',
      language: 'python',
    })();

    expect(execFileSync).toHaveBeenCalledExactlyOnceWith('uv', ['lock'], {
      cwd: tree.root,
      stdio: 'inherit',
    });
    expect(installPackagesTask).not.toHaveBeenCalled();
  });

  it('skips the install when asked to', async () => {
    await projectGenerator(tree, {
      name: 'weather-station',
      language: 'ts',
      skipInstall: true,
    })();
    await projectGenerator(tree, {
      name: 'weather-api',
      language: 'python',
      type: 'lib',
      skipInstall: true,
    })();

    expect(installPackagesTask).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('rejects names that are not kebab-case', () => {
    expect(() =>
      projectGenerator(tree, { name: 'Weather_Station', language: 'ts' }),
    ).toThrow('Project names are kebab-case');
  });

  it('refuses to overwrite an existing project', () => {
    tree.write('apps/weather-station/README.md', '# Taken\n');

    expect(() =>
      projectGenerator(tree, { name: 'weather-station', language: 'ts' }),
    ).toThrow('apps/weather-station already exists');
  });

  it('refuses a name another directory already uses', () => {
    tree.write('libs/weather-station/README.md', '# Taken\n');

    expect(() =>
      projectGenerator(tree, { name: 'weather-station', language: 'python' }),
    ).toThrow('libs/weather-station already exists');
  });

  it('rejects a TypeScript library named after a reserved word', () => {
    expect(() =>
      projectGenerator(tree, { name: 'new', language: 'ts', type: 'lib' }),
    ).toThrow('"new" is a reserved word in JavaScript.');
  });

  it('rejects a Python project named after a keyword', () => {
    expect(() =>
      projectGenerator(tree, { name: 'pass', language: 'python' }),
    ).toThrow('"pass" is a keyword in Python.');
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('rejects a Python name that would be shadowed by an existing module', () => {
    vi.mocked(spawnSync).mockReturnValue(probeResult(1));

    expect(() =>
      projectGenerator(tree, { name: 'calendar', language: 'python' }),
    ).toThrow('Python already has a module named calendar');
    expect(spawnSync).toHaveBeenCalledExactlyOnceWith(
      'uv',
      [
        'run',
        '--quiet',
        'python',
        '-c',
        'import importlib.util, sys; sys.exit(importlib.util.find_spec(sys.argv[1]) is not None)',
        'calendar',
      ],
      { cwd: tree.root, encoding: 'utf8' },
    );
    expect(tree.exists('apps/calendar')).toBe(false);
  });

  it('explains when uv cannot check the module name', () => {
    vi.mocked(spawnSync).mockReturnValue(probeResult(null, 'uv: not found'));

    expect(() =>
      projectGenerator(tree, { name: 'weather-station', language: 'python' }),
    ).toThrow('Could not check the module name with uv');
  });
});

describe('addUvWorkspaceMember', () => {
  it('keeps the members sorted and the comments intact', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write(
      'pyproject.toml',
      '# Root.\n\n[tool.uv.workspace]\nmembers = [\n  "libs/b",\n  "apps/a", # first app\n]\n',
    );

    addUvWorkspaceMember(tree, 'apps/c');

    expect(tree.read('pyproject.toml', 'utf8')).toBe(
      '# Root.\n\n[tool.uv.workspace]\nmembers = [\n  "apps/a",\n  "apps/c",\n  "libs/b",\n]\n',
    );
  });

  it('requires a members list', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('pyproject.toml', '[tool.ruff]\n');

    expect(() => {
      addUvWorkspaceMember(tree, 'apps/c');
    }).toThrow('must declare [tool.uv.workspace].members');
  });

  it('requires a root pyproject.toml', () => {
    expect(() => {
      addUvWorkspaceMember(createTreeWithEmptyWorkspace(), 'apps/c');
    }).toThrow('must declare [tool.uv.workspace].members');
  });
});
