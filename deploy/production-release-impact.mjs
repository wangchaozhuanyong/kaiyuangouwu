#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const SHA_PATTERN = /^[a-f0-9]{40}$/u;

function uniqueSorted(values) {
    return [...new Set(values)].sort();
}

function hasPath(changedFiles, predicate) {
    return changedFiles.some(predicate);
}

function validateManagedReleaseScope(files, releaseScope) {
    const authVisualChange = files.includes('packages/dev-server/scripts/sync-auth-visuals.mjs');
    const brandChange = hasPath(
        files,
        file =>
            file === 'packages/dev-server/scripts/sync-moyao-brand.mjs' ||
            file.startsWith('packages/storefront/src/assets/brand/moyao-ai/'),
    );
    const damatongChange = hasPath(
        files,
        file =>
            file === 'packages/dev-server/scripts/damatong-storefront-config.mjs' ||
            file === 'packages/dev-server/scripts/sync-damatong-storefront.mjs' ||
            file.startsWith('packages/storefront/src/assets/brand/damatong-market/') ||
            file.startsWith('packages/storefront/src/assets/storefront/damatong/'),
    );
    const homepageCarouselChange = hasPath(
        files,
        file =>
            file === 'packages/dev-server/scripts/sync-homepage-carousel.mjs' ||
            file.startsWith('packages/storefront/src/assets/storefront/carousel/'),
    );
    const referralPosterChange = hasPath(
        files,
        file =>
            file === 'packages/dev-server/scripts/sync-referral-posters.mjs' ||
            file.startsWith('packages/dev-server/assets/referral-posters/') ||
            file === 'packages/store-management-plugin/src/referral/referral-poster-presets.ts',
    );
    const managedStorefrontChanges = files.filter(
        file =>
            file === 'packages/dev-server/scripts/catalog-cigarette-media.mjs' ||
            file === 'packages/dev-server/scripts/sync-storefront-media.mjs' ||
            file === 'packages/dev-server/scripts/repair-inventory-inheritance.mjs' ||
            (file.startsWith('packages/storefront/src/assets/storefront/') &&
                !file.startsWith('packages/storefront/src/assets/storefront/damatong/')),
    );
    const requireExactScope = (changed, selected, label) => {
        if (changed && !selected)
            throw new Error(`${label} changed but its reviewed release scope was not selected`);
        if (!changed && selected) throw new Error(`${label} scope was selected without a matching change`);
    };
    requireExactScope(authVisualChange, releaseScope.authVisuals, 'Managed auth visual publisher');
    requireExactScope(brandChange, releaseScope.moyaoBrand, 'MOYAO AI managed brand data');
    requireExactScope(damatongChange, releaseScope.damatongStorefront, 'Damatong managed storefront data');
    requireExactScope(homepageCarouselChange, releaseScope.homepageCarousel, 'Managed homepage carousel');
    requireExactScope(
        referralPosterChange,
        releaseScope.referralPosters && releaseScope.referralPosters !== 'none',
        'Managed referral posters',
    );
    if (managedStorefrontChanges.length && !releaseScope.mediaKeys) {
        throw new Error('Managed storefront data changed; reviewed media keys are required');
    }
    for (const file of managedStorefrontChanges) {
        if (
            file !== 'packages/dev-server/scripts/catalog-cigarette-media.mjs' &&
            file !== 'packages/dev-server/scripts/sync-storefront-media.mjs' &&
            !file.startsWith('packages/storefront/src/assets/storefront/')
        ) {
            throw new Error(`Managed storefront release contains an unsupported data change: ${file}`);
        }
    }
    if (!managedStorefrontChanges.length && releaseScope.mediaKeys && !homepageCarouselChange) {
        throw new Error('Reviewed media keys were supplied without a managed storefront data change');
    }
}

export function classifyProductionReleaseImpact(changedFiles, releaseScope = {}) {
    const files = uniqueSorted(changedFiles.filter(Boolean));
    if (!files.length) {
        throw new Error('A production release must contain at least one change from the deployed revision');
    }
    validateManagedReleaseScope(files, releaseScope);

    const managedContentWrite = Boolean(
        releaseScope.mediaKeys ||
        releaseScope.authVisuals ||
        releaseScope.moyaoBrand ||
        releaseScope.damatongStorefront ||
        releaseScope.homepageCarousel ||
        (releaseScope.referralPosters && releaseScope.referralPosters !== 'none'),
    );
    const schemaChange = hasPath(
        files,
        file =>
            file.startsWith('packages/dev-server/migrations/') ||
            /\/src\/entities\//u.test(file) ||
            /\/src\/[^/]*\.entity\.ts$/u.test(file) ||
            file === 'deploy/usdt-migration-guard.cjs',
    );

    const affectedChecks = new Set(['all-store-basics']);
    if (
        hasPath(
            files,
            file =>
                file.startsWith('.github/workflows/') ||
                file.startsWith('deploy/') ||
                file === 'packages/dev-server/scripts/production-runtime-artifact.mjs',
        )
    ) {
        affectedChecks.add('release-controls');
    }
    if (
        hasPath(
            files,
            file =>
                file.startsWith('packages/storefront/') ||
                file.startsWith('packages/storefront-') ||
                file === 'deploy/nginx/damatong.conf',
        )
    ) {
        affectedChecks.add('storefront');
    }
    if (
        hasPath(
            files,
            file => file.startsWith('packages/next-admin/') || file.startsWith('packages/dashboard/'),
        )
    ) {
        affectedChecks.add('dashboard');
    }
    if (
        hasPath(
            files,
            file =>
                file.startsWith('packages/dev-server/') ||
                file.startsWith('packages/core/') ||
                (/^packages\/[^/]+-plugin\//u.test(file) && !file.includes('/skill/')),
        )
    ) {
        affectedChecks.add('api');
    }
    if (
        hasPath(
            files,
            file => file.toLowerCase().includes('realtime') || file === 'deploy/nginx/damatong.conf',
        )
    ) {
        affectedChecks.add('storefront-realtime');
    }
    if (schemaChange) affectedChecks.add('database-migration');
    if (managedContentWrite) affectedChecks.add('managed-content');

    const dataRisk = schemaChange ? 'schema' : managedContentWrite ? 'managed-content' : 'runtime-only';
    return {
        affectedChecks: [...affectedChecks].sort(),
        backupPolicy: dataRisk === 'runtime-only' ? 'reuse-recent-or-create' : 'fresh',
        changedFileCount: files.length,
        changedFilesSha256: createHash('sha256')
            .update(`${files.join('\n')}\n`)
            .digest('hex'),
        dataRisk,
    };
}

export function inspectProductionReleaseImpact({ baseSha, targetSha, releaseScope, git = execFileSync }) {
    if (!SHA_PATTERN.test(baseSha) || !SHA_PATTERN.test(targetSha)) {
        throw new Error('Release impact requires full lowercase base and target SHAs');
    }
    git('git', ['merge-base', '--is-ancestor', baseSha, targetSha], { stdio: 'ignore' });
    const changedFiles = git('git', ['diff', '--name-only', '--diff-filter=ACDMRT', baseSha, targetSha], {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
    })
        .split('\n')
        .filter(Boolean);
    return classifyProductionReleaseImpact(changedFiles, releaseScope);
}

function booleanInput(value, name) {
    if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false`);
    return value === 'true';
}

async function main() {
    const { values } = parseArgs({
        options: {
            'base-sha': { type: 'string' },
            'target-sha': { type: 'string' },
            'media-keys': { type: 'string', default: '' },
            'channel-codes': { type: 'string', default: '' },
            'auth-visuals': { type: 'string', default: 'false' },
            'moyao-brand': { type: 'string', default: 'false' },
            'damatong-storefront': { type: 'string', default: 'false' },
            'homepage-carousel': { type: 'string', default: 'false' },
            'referral-posters': { type: 'string', default: 'none' },
            output: { type: 'string' },
        },
        strict: true,
    });
    if (!values['base-sha'] || !values['target-sha']) {
        throw new Error('Usage: production-release-impact.mjs --base-sha <sha> --target-sha <sha>');
    }
    const impact = inspectProductionReleaseImpact({
        baseSha: values['base-sha'],
        targetSha: values['target-sha'],
        releaseScope: {
            mediaKeys: values['media-keys'],
            channelCodes: values['channel-codes'],
            authVisuals: booleanInput(values['auth-visuals'], 'auth-visuals'),
            moyaoBrand: booleanInput(values['moyao-brand'], 'moyao-brand'),
            damatongStorefront: booleanInput(values['damatong-storefront'], 'damatong-storefront'),
            homepageCarousel: booleanInput(values['homepage-carousel'], 'homepage-carousel'),
            referralPosters: values['referral-posters'],
        },
    });
    const output = `${JSON.stringify(impact)}\n`;
    if (values.output) writeFileSync(values.output, output, { encoding: 'utf8', mode: 0o600 });
    else process.stdout.write(output);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch(error => {
        process.stderr.write(`Production release impact failed: ${error.message}\n`);
        process.exitCode = 1;
    });
}
