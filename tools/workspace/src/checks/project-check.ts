// The rules `nx run repo:check-projects` enforces, as pure functions of the
// project graph and the dependency manifests, so they can be tested with a
// hand-built graph. scripts/check-projects.mjs reads the real graph and the
// files and passes them in.

import type { ProjectGraph } from '@nx/devkit';
import { parse } from 'smol-toml';

import {
  normalizeDistributionName,
  requirementName,
} from '../plugins/pyproject.ts';

/** What a project must look like, keyed by tag. */
export interface ProjectRules {
  /** The layer tags; every project has exactly one. */
  readonly typeTags: readonly string[];
  /** The language tags; every project has exactly one. */
  readonly langTags: readonly string[];
  /** Which tags a project with `sourceTag` may depend on (project-boundaries.mjs). */
  readonly depConstraints: readonly {
    readonly sourceTag: string;
    readonly onlyDependOnLibsWithTags: readonly string[];
  }[];
  /**
   * Targets a tag requires, because `nx run-many` and `nx affected` silently
   * skip a project that lacks one.
   */
  readonly requiredTargets: Readonly<Record<string, readonly string[]>>;
  /** Targets the workspace-root project needs for its own scripts. */
  readonly rootTargets: readonly string[];
}

/** Every way the graph breaks the tag, target, and dependency rules. */
export function projectProblems(
  graph: ProjectGraph,
  rules: ProjectRules,
): string[] {
  const problems: string[] = [];

  for (const [name, node] of Object.entries(graph.nodes)) {
    const tags = node.data.tags ?? [];
    for (const family of [rules.typeTags, rules.langTags]) {
      const matches = tags.filter((tag) => family.includes(tag));
      if (matches.length !== 1) {
        problems.push(
          `${name} must have exactly one of ${family.join(', ')}; it has ${matches.length === 0 ? 'none' : matches.join(', ')}.`,
        );
      }
    }

    const required =
      node.data.root === '.'
        ? rules.rootTargets
        : tags.flatMap((tag) => rules.requiredTargets[tag] ?? []);
    const missing = required.filter(
      (target) => node.data.targets?.[target] === undefined,
    );
    if (missing.length > 0) {
      problems.push(
        `${name} has no ${missing.join(', ')} target; check the Nx plugin configuration in nx.json.`,
      );
    }
  }

  for (const [source, dependencies] of Object.entries(graph.dependencies)) {
    const sourceTags = graph.nodes[source]?.data.tags ?? [];
    for (const { target } of dependencies) {
      const targetNode = graph.nodes[target];
      if (targetNode === undefined) {
        continue; // An npm or PyPI package, not a workspace project.
      }
      const targetTags = targetNode.data.tags ?? [];
      for (const {
        sourceTag,
        onlyDependOnLibsWithTags,
      } of rules.depConstraints) {
        if (
          sourceTags.includes(sourceTag) &&
          !onlyDependOnLibsWithTags.some((tag) => targetTags.includes(tag))
        ) {
          problems.push(
            `${source} (${sourceTag}) may only depend on projects tagged ${onlyDependOnLibsWithTags.join(' or ')}, but depends on ${target} (${targetTags.join(', ')}).`,
          );
        }
      }
    }
  }

  return problems;
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i;
const PACKAGE_JSON_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'resolutions',
] as const;

/**
 * Every dependency in a package.json that is not one exact version: a plain
 * version, `workspace:` with a version, or an `npm:` alias with a version.
 */
export function packageJsonPinProblems(path: string, source: string): string[] {
  const manifest: unknown = JSON.parse(source);
  if (!isTable(manifest)) {
    return [`${path} is not a JSON object.`];
  }
  return PACKAGE_JSON_FIELDS.flatMap((field) => {
    const entries = manifest[field];
    return isTable(entries)
      ? Object.entries(entries).flatMap(([name, version]) =>
          typeof version === 'string' && isExactNpmVersion(version)
            ? []
            : [
                `${path} ${field} pins ${name} to ${JSON.stringify(version)}; use one exact version, such as "1.2.3".`,
              ],
        )
      : [];
  });
}

function isExactNpmVersion(version: string): boolean {
  const alias = /^npm:(?:@[^@/]+\/)?[^@]+@(.+)$/.exec(version);
  const workspace = /^workspace:(.+)$/.exec(version);
  const exact = alias?.[1] ?? workspace?.[1] ?? version;
  return EXACT_VERSION.test(exact);
}

// PEP 508: a name, optional extras, then `==` and one version, optionally
// followed by an environment marker.
const EXACT_REQUIREMENT =
  /^\s*[a-z\d](?:[a-z\d._-]*[a-z\d])?\s*(?:\[[^\]]*\])?\s*==\s*[\da-z.+!-]+\s*(?:;.*)?$/i;

/**
 * Every requirement in a pyproject.toml that is not `name==version` or a bare
 * workspace member: the project's dependencies, optional dependencies, and
 * dependency groups. The build system's requirements are not checked.
 */
export function pyprojectPinProblems(
  path: string,
  source: string,
  workspaceMembers: ReadonlySet<string>,
): string[] {
  const document = parse(source);
  const project = isTable(document['project']) ? document['project'] : {};
  const requirements = [
    ...strings(project['dependencies']),
    ...tableValues(project['optional-dependencies']).flatMap(strings),
    ...tableValues(document['dependency-groups']).flatMap(strings),
  ];
  return requirements.flatMap((requirement) => {
    const name = requirementName(requirement);
    const member =
      name !== undefined &&
      workspaceMembers.has(name) &&
      normalizeDistributionName(requirement.trim()) === name;
    return member || EXACT_REQUIREMENT.test(requirement)
      ? []
      : [
          `${path} requires ${JSON.stringify(requirement)}; pin it with ==, such as "name==1.2.3", or name a workspace member alone.`,
        ];
  });
}

type Table = Readonly<Record<string, unknown>>;

function isTable(value: unknown): value is Table {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tableValues(value: unknown): unknown[] {
  return isTable(value) ? Object.values(value) : [];
}

// Dependency groups may also hold `{ include-group = "..." }` tables, which
// name no distribution, so only strings count.
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
