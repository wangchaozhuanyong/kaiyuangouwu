import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const requireFromCore = createRequire(path.join(repoRoot, 'packages/core/package.json'));

function resolveNestPackage(packageName: string): string {
    return path.dirname(requireFromCore.resolve(`${packageName}/package.json`));
}

/**
 * Bun's hoisted linker can install multiple physical copies of the same Nest
 * version for different peer contexts. Tests that combine a workspace plugin
 * with `@vendure/core` must resolve Nest from Core's own module context so
 * injection tokens such as `ModuleRef` keep object identity. Resolving the
 * actual package location also works when a clean CI install hoists the package
 * without creating a package-local link.
 */
export const nestTestAliases = {
    '@nestjs/common': resolveNestPackage('@nestjs/common'),
    '@nestjs/core': resolveNestPackage('@nestjs/core'),
    '@nestjs/testing': resolveNestPackage('@nestjs/testing'),
    '@nestjs/typeorm': resolveNestPackage('@nestjs/typeorm'),
};

/**
 * Shared settings for package unit-test suites.
 *
 * In CI, `lerna run test` runs several package suites concurrently on a low-core
 * runner, so no single suite can assume an uncontended machine:
 *
 * - vitest's default 5s `testTimeout` produces spurious timeouts under CPU
 *   contention, so tests get generous headroom in CI.
 * - each vitest process sizes its worker pool to all available cores, which
 *   oversubscribes the runner several-fold when suites run concurrently. One
 *   worker per suite keeps the total process count aligned with the runner's
 *   cores — lerna already provides the cross-package parallelism.
 */
export const sharedTestConfig = {
    testTimeout: process.env.CI ? 30 * 1000 : 15 * 1000,
    maxWorkers: process.env.CI ? 1 : undefined,
};
