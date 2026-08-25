import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bun's hoisted linker can install multiple physical copies of the same Nest
 * version for different peer contexts. Tests that combine a workspace plugin
 * with `@vendure/core` must use Core's Nest instance so injection tokens such
 * as `ModuleRef` keep object identity.
 */
export const nestTestAliases = {
    '@nestjs/common': path.join(repoRoot, 'packages/core/node_modules/@nestjs/common'),
    '@nestjs/core': path.join(repoRoot, 'packages/core/node_modules/@nestjs/core'),
    '@nestjs/testing': path.join(repoRoot, 'packages/core/node_modules/@nestjs/testing'),
    '@nestjs/typeorm': path.join(repoRoot, 'packages/core/node_modules/@nestjs/typeorm'),
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
