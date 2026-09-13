import { createHash } from 'node:crypto';

import { createInputReader, dependencies, jobRecipe } from '../scripts/ci-check-inputs.mjs';
import { isDocumentation, packageInventory } from '../scripts/ci-impact.mjs';

// Source revision is provenance. These inputs decide whether compiled bytes can
// be reused; the runtime archive and its revision metadata are still built afresh.
export function artifactSourceHash({
    component,
    ref = 'HEAD',
    reader = createInputReader(),
    inventory = packageInventory(),
} = {}) {
    const prefixes = component
        ? dependencies([component], inventory).map(name => `packages/${name}/`)
        : ['packages/'];
    const entries = reader
        .entries(ref)
        .filter(({ path }) => {
            if (isDocumentation(path)) return false;
            if (/^packages\/dev-server\/scripts\/.*\.spec\.mjs$/u.test(path)) return false;
            if (path.startsWith('packages/')) return prefixes.some(prefix => path.startsWith(prefix));
            if (path.startsWith('deploy/'))
                return [
                    'deploy/build-artifact.mjs',
                    'deploy/frontend-artifact.mjs',
                    'deploy/artifact-inputs.mjs',
                ].includes(path);
            if (path.startsWith('.github/'))
                return (
                    path.startsWith('.github/actions/setup/') ||
                    path === '.github/workflows/build_production_runtime.yml'
                );
            if (/^scripts\/(ci-|release-)/u.test(path)) return path === 'scripts/ci-run.mjs';
            // Root manifests/configuration and other build scripts are conservative inputs.
            return true;
        })
        .map(({ path, metadata }) => `${metadata}\t${path}`);
    const workflowPath = '.github/workflows/build_and_test.yml';
    const workflow = reader.entries(ref).some(item => item.path === workflowPath)
        ? reader.text(ref, workflowPath)
        : undefined;
    const recipe = workflow ? jobRecipe(workflow, component ? 'frontend' : 'build') : undefined;
    return createHash('sha256')
        .update(JSON.stringify({ version: 1, component, entries, recipe }))
        .digest('hex');
}

// Only completed, same-repository build jobs can supply executable artifacts.
// A deployment failure after a successful build does not invalidate its bytes.
export function runtimeArtifactRunTrusted(run, repository, jobs) {
    return (
        run.status === 'completed' &&
        run.head_repository?.full_name === repository &&
        run.event === 'workflow_dispatch' &&
        run.head_branch === 'main' &&
        run.path === '.github/workflows/production_release.yml' &&
        jobs.some(
            job =>
                job.name === 'build immutable runtime / build verified linux/x64 runtime' &&
                job.conclusion === 'success',
        )
    );
}
