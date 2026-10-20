import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  normalizeDistributionName,
  parsePyproject,
  readWorkspaceMembers,
  requirementName,
} from './pyproject.ts';

describe('normalizeDistributionName', () => {
  it.each([
    ['bar-kit', 'bar-kit'],
    ['Bar_Kit', 'bar-kit'],
    ['bar.__kit', 'bar-kit'],
  ])('normalizes %s to %s', (name, expected) => {
    expect(normalizeDistributionName(name)).toBe(expected);
  });
});

describe('requirementName', () => {
  it.each([
    ['busylib==2.6.0', 'busylib'],
    ['Bar_Kit [extra] >= 1', 'bar-kit'],
    ["requests; python_version < '3.11'", 'requests'],
    ['x', 'x'],
  ])('reads the name of %s', (requirement, expected) => {
    expect(requirementName(requirement)).toBe(expected);
  });

  it('returns undefined for text without a name', () => {
    expect(requirementName('  >=1.0')).toBeUndefined();
  });
});

describe('parsePyproject', () => {
  it('collects dependencies, optional dependencies, and dependency groups', () => {
    const info = parsePyproject(
      `
[project]
name = "Count_Down"
dependencies = ["bar-kit", "busylib==2.6.0"]

[project.optional-dependencies]
media = ["pillow==12.0.0"]

[dependency-groups]
dev = ["pytest==9.1.1", { include-group = "lint" }]
lint = ["ruff==0.17.0"]
`,
      'apps/countdown/pyproject.toml',
    );

    expect(info).toEqual({
      name: 'count-down',
      moduleName: 'count_down',
      requirements: ['bar-kit', 'busylib', 'pillow', 'pytest', 'ruff'],
    });
  });

  it('honours a uv_build module-name override', () => {
    const info = parsePyproject(
      `
[project]
name = "bar-kit"

[tool.uv.build-backend]
module-name = "kit"
`,
      'libs/bar-kit-py/pyproject.toml',
    );

    expect(info.moduleName).toBe('kit');
    expect(info.requirements).toEqual([]);
  });

  it('requires a project name', () => {
    expect(() =>
      parsePyproject('[tool.uv]\n', 'libs/x/pyproject.toml'),
    ).toThrow('libs/x/pyproject.toml must set [project].name.');
  });
});

describe('readWorkspaceMembers', () => {
  it('reads the members without ./ prefixes or trailing slashes', () => {
    const root = mkdtempSync(join(tmpdir(), 'pyproject-'));
    const file = join(root, 'pyproject.toml');
    writeFileSync(
      file,
      '[tool.uv.workspace]\nmembers = ["./apps/countdown", "libs/bar-kit-py/"]\n',
    );

    expect(readWorkspaceMembers(file)).toEqual([
      'apps/countdown',
      'libs/bar-kit-py',
    ]);
  });

  it('explains a missing workspace root', () => {
    const missing = join(tmpdir(), 'no-such-dir', 'pyproject.toml');

    expect(() => readWorkspaceMembers(missing)).toThrow(
      /need a uv workspace root/,
    );
  });
});
