import type {
  ProjectGraph,
  ProjectGraphDependency,
  ProjectGraphProjectNode,
} from '@nx/devkit';
import { DependencyType } from '@nx/devkit';
import { describe, expect, it } from 'vitest';

import type { ProjectRules } from './project-check.ts';
import {
  packageJsonPinProblems,
  projectProblems,
  pyprojectPinProblems,
} from './project-check.ts';

const RULES: ProjectRules = {
  typeTags: ['type:app', 'type:lib', 'type:tooling'],
  langTags: ['lang:ts', 'lang:python'],
  depConstraints: [
    { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:lib'] },
    { sourceTag: 'lang:ts', onlyDependOnLibsWithTags: ['lang:ts'] },
    { sourceTag: 'lang:python', onlyDependOnLibsWithTags: ['lang:python'] },
  ],
  requiredTargets: { 'lang:ts': ['lint', 'test'], 'type:app': ['start'] },
  rootTargets: ['lint'],
};

function node(
  name: string,
  tags: string[],
  targets: string[],
  root = `apps/${name}`,
): ProjectGraphProjectNode {
  return {
    name,
    type: 'lib',
    data: {
      root,
      tags,
      targets: Object.fromEntries(targets.map((target) => [target, {}])),
    },
  };
}

function edge(source: string, target: string): ProjectGraphDependency {
  return { source, target, type: DependencyType.static };
}

function graph(
  nodes: ProjectGraphProjectNode[],
  edges: ProjectGraphDependency[] = [],
): ProjectGraph {
  return {
    nodes: Object.fromEntries(nodes.map((each) => [each.name, each])),
    dependencies: Object.fromEntries(
      nodes.map((each) => [
        each.name,
        edges.filter((dependency) => dependency.source === each.name),
      ]),
    ),
  };
}

const CLOCK = node('clock', ['type:app', 'lang:ts'], ['lint', 'test', 'start']);
const KIT = node('bar-kit', ['type:lib', 'lang:ts'], ['lint', 'test']);
const KIT_PY = node('bar-kit-py', ['type:lib', 'lang:python'], []);
const ROOT = node('repo', ['type:tooling', 'lang:ts'], ['lint'], '.');

describe('projectProblems', () => {
  it('passes a workspace that follows every rule', () => {
    expect(
      projectProblems(
        graph([CLOCK, KIT, KIT_PY, ROOT], [edge('clock', 'bar-kit')]),
        RULES,
      ),
    ).toStrictEqual([]);
  });

  it('needs exactly one tag of each family', () => {
    const untagged: ProjectGraphProjectNode = {
      name: 'untagged',
      type: 'lib',
      data: { root: 'libs/untagged' },
    };
    const twice = node(
      'twice',
      ['type:lib', 'type:app', 'lang:ts'],
      ['lint', 'test', 'start'],
    );

    expect(projectProblems(graph([untagged, twice]), RULES)).toStrictEqual([
      'untagged must have exactly one of type:app, type:lib, type:tooling; it has none.',
      'untagged must have exactly one of lang:ts, lang:python; it has none.',
      'twice must have exactly one of type:app, type:lib, type:tooling; it has type:lib, type:app.',
    ]);
  });

  it('needs the targets each tag requires, and the root its own', () => {
    const app = node('clock', ['type:app', 'lang:ts'], ['lint']);
    const root = node('repo', ['type:tooling', 'lang:ts'], [], '.');

    expect(projectProblems(graph([app, root]), RULES)).toStrictEqual([
      'clock has no start, test target; check the Nx plugin configuration in nx.json.',
      'repo has no lint target; check the Nx plugin configuration in nx.json.',
    ]);
  });

  it('rejects an app depending on an app, or on another language', () => {
    const other = node('countdown', ['type:app', 'lang:python'], ['start']);

    expect(
      projectProblems(
        graph(
          [CLOCK, KIT_PY, other],
          [edge('clock', 'countdown'), edge('clock', 'bar-kit-py')],
        ),
        RULES,
      ),
    ).toStrictEqual([
      'clock (type:app) may only depend on projects tagged type:lib, but depends on countdown (type:app, lang:python).',
      'clock (lang:ts) may only depend on projects tagged lang:ts, but depends on countdown (type:app, lang:python).',
      'clock (lang:ts) may only depend on projects tagged lang:ts, but depends on bar-kit-py (type:lib, lang:python).',
    ]);
  });

  it('ignores edges between external packages and to them', () => {
    const workspace = graph([CLOCK], [edge('clock', 'npm:vitest')]);

    expect(
      projectProblems(
        {
          ...workspace,
          dependencies: {
            ...workspace.dependencies,
            'npm:vitest': [edge('npm:vitest', 'npm:vite')],
          },
        },
        RULES,
      ),
    ).toStrictEqual([]);
  });

  it('treats a dependency without tags as allowed by none of them', () => {
    const bare: ProjectGraphProjectNode = {
      name: 'bare',
      type: 'lib',
      data: { root: 'libs/bare' },
    };

    expect(
      projectProblems(graph([CLOCK, bare], [edge('clock', 'bare')]), RULES),
    ).toContain(
      'clock (type:app) may only depend on projects tagged type:lib, but depends on bare ().',
    );
  });
});

describe('packageJsonPinProblems', () => {
  it('accepts exact versions, workspace versions, and npm aliases', () => {
    const manifest = JSON.stringify({
      dependencies: {
        '@busy-bar-apps/bar-kit': 'workspace:0.0.1',
        convex: '1.47.0',
      },
      devDependencies: {
        '@typescript/native': 'npm:typescript@7.0.2',
        typescript: 'npm:@typescript/typescript6@6.0.2',
        prerelease: '2.0.0-beta.1',
      },
    });

    expect(packageJsonPinProblems('package.json', manifest)).toStrictEqual([]);
  });

  it('rejects ranges, tags, and loose workspace versions', () => {
    const manifest = JSON.stringify({
      dependencies: { caret: '^1.2.3', tilde: '~1.2.3' },
      devDependencies: { latest: 'latest', star: 'workspace:*' },
      resolutions: { 'undici@npm:7.29.0': 'npm:undici@>=7.29.1' },
    });

    expect(
      packageJsonPinProblems('apps/clock/package.json', manifest),
    ).toStrictEqual([
      'apps/clock/package.json dependencies pins caret to "^1.2.3"; use one exact version, such as "1.2.3".',
      'apps/clock/package.json dependencies pins tilde to "~1.2.3"; use one exact version, such as "1.2.3".',
      'apps/clock/package.json devDependencies pins latest to "latest"; use one exact version, such as "1.2.3".',
      'apps/clock/package.json devDependencies pins star to "workspace:*"; use one exact version, such as "1.2.3".',
      'apps/clock/package.json resolutions pins undici@npm:7.29.0 to "npm:undici@>=7.29.1"; use one exact version, such as "1.2.3".',
    ]);
  });

  it('reports a manifest that is not an object', () => {
    expect(packageJsonPinProblems('package.json', '[]')).toStrictEqual([
      'package.json is not a JSON object.',
    ]);
  });
});

describe('pyprojectPinProblems', () => {
  const MEMBERS = new Set(['bar-kit', 'countdown']);

  it('checks the dependency groups of a workspace root without a project', () => {
    expect(
      pyprojectPinProblems(
        'pyproject.toml',
        '[dependency-groups]\ndev = ["mypy==2.4.0", "ruff>=0.17"]\n',
        MEMBERS,
      ),
    ).toStrictEqual([
      'pyproject.toml requires "ruff>=0.17"; pin it with ==, such as "name==1.2.3", or name a workspace member alone.',
    ]);
  });

  it('accepts == pins and bare workspace members, and skips the build system', () => {
    const source = `
[project]
name = "countdown"
dependencies = ["bar-kit", "Bar_Kit", "busylib==2.6.1", "httpx[http2]==0.28.1 ; python_version >= '3.14'"]

[project.optional-dependencies]
cli = ["rich==14.0.0"]

[dependency-groups]
dev = ["pytest==9.1.1", { include-group = "lint" }]
lint = ["ruff==0.17.0"]

[build-system]
requires = ["uv_build>=0.13.7,<0.14"]
`;

    expect(
      pyprojectPinProblems('apps/countdown/pyproject.toml', source, MEMBERS),
    ).toStrictEqual([]);
  });

  it('rejects ranges and unpinned packages', () => {
    const source = `
[project]
name = "countdown"
dependencies = ["busylib>=2.6", "httpx", "busylib==2.*"]

[dependency-groups]
dev = ["mypy~=2.4"]
`;

    expect(
      pyprojectPinProblems('pyproject.toml', source, MEMBERS),
    ).toStrictEqual([
      'pyproject.toml requires "busylib>=2.6"; pin it with ==, such as "name==1.2.3", or name a workspace member alone.',
      'pyproject.toml requires "httpx"; pin it with ==, such as "name==1.2.3", or name a workspace member alone.',
      'pyproject.toml requires "busylib==2.*"; pin it with ==, such as "name==1.2.3", or name a workspace member alone.',
      'pyproject.toml requires "mypy~=2.4"; pin it with ==, such as "name==1.2.3", or name a workspace member alone.',
    ]);
  });
});
