import type { ViteUserConfig } from 'vitest/config';

export interface CoverageThresholds {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

export interface ProjectVitestConfigOptions {
  /** Ratchet these upward; never lower them to make a change pass. */
  coverageThresholds: CoverageThresholds;
  /**
   * Extra source globs without behavior worth covering, such as a process
   * entry point. Explain each in a comment.
   */
  coverageExclude?: string[];
}

export declare function createProjectVitestConfig(
  options: ProjectVitestConfigOptions,
): ViteUserConfig;
