import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';

/** The parts of a project's pyproject.toml that the Python plugin reads. */
export interface PyprojectInfo {
  /** Normalized distribution name, such as `bar-kit`. */
  readonly name: string;
  /** Import name of the package under `src/`, such as `bar_kit`. */
  readonly moduleName: string;
  /**
   * Normalized names of every requirement: dependencies, optional
   * dependencies, and dependency groups.
   */
  readonly requirements: readonly string[];
}

type Table = Record<string, unknown>;

// PEP 508: a name starts and ends with a letter or digit.
const REQUIREMENT_NAME = /^\s*([a-z\d](?:[a-z\d._-]*[a-z\d])?)/i;

/** Normalize a distribution name as PEP 503 does: `Bar_Kit` → `bar-kit`. */
export function normalizeDistributionName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/** The normalized distribution name a PEP 508 requirement refers to. */
export function requirementName(requirement: string): string | undefined {
  const match = REQUIREMENT_NAME.exec(requirement);
  return match?.[1] === undefined
    ? undefined
    : normalizeDistributionName(match[1]);
}

/** Read and parse a project's pyproject.toml. */
export function readPyproject(path: string): PyprojectInfo {
  return parsePyproject(readFileSync(path, 'utf8'), path);
}

/** Parse pyproject.toml `source`; `path` names the file in errors. */
export function parsePyproject(source: string, path: string): PyprojectInfo {
  const document = parse(source);
  const project = tableAt(document, ['project']);
  const rawName = project?.['name'];
  if (typeof rawName !== 'string' || rawName === '') {
    throw new Error(`${path} must set [project].name.`);
  }

  const name = normalizeDistributionName(rawName);
  const moduleName = tableAt(document, ['tool', 'uv', 'build-backend'])?.[
    'module-name'
  ];

  return {
    name,
    moduleName:
      typeof moduleName === 'string' ? moduleName : name.replaceAll('-', '_'),
    requirements: [
      ...strings(project?.['dependencies']),
      ...Object.values(
        tableAt(project, ['optional-dependencies']) ?? {},
      ).flatMap(strings),
      ...Object.values(tableAt(document, ['dependency-groups']) ?? {}).flatMap(
        strings,
      ),
    ].flatMap((requirement) => requirementName(requirement) ?? []),
  };
}

/** The `[tool.uv.workspace].members` of the root pyproject.toml. */
export function readWorkspaceMembers(path: string): string[] {
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(
      `Python projects need a uv workspace root at ${path}; see docs/python.md.`,
      { cause: error },
    );
  }
  return strings(
    tableAt(parse(source), ['tool', 'uv', 'workspace'])?.['members'],
  ).map((member) => member.replace(/^\.\//, '').replace(/\/$/, ''));
}

function tableAt(table: Table | undefined, keys: string[]): Table | undefined {
  let current: unknown = table;
  for (const key of keys) {
    current = isTable(current) ? current[key] : undefined;
  }
  return isTable(current) ? current : undefined;
}

function isTable(value: unknown): value is Table {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Dependency groups may also hold `{ include-group = "..." }` tables, which
// name no distribution, so only strings count.
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
