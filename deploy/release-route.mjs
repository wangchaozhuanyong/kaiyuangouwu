import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { classifyChanges, inspection } from '../scripts/ci-impact.mjs';
import { retainedFrontendPlan } from '../scripts/release-preserve-frontends.mjs';

import { frontendChangedSinceObserved, pendingFrontendComponents } from './frontend-release.mjs';
import nginxRevision from './nginx-revision.cjs';

export function selectReleaseRoute({
    plan,
    baseSha,
    targetSha,
    storefrontSha,
    adminSha,
    nginxSha,
    nginxChangedSince,
    managed = false,
    retainFrontends = false,
    changedSince = frontendChangedSinceObserved,
}) {
    for (const sha of [baseSha, targetSha]) assert.match(sha, /^[a-f0-9]{40}$/u);
    if (!plan.full) {
        const paths = nginxRevision.withoutActiveNginx(
            plan.files,
            { nginxSha, targetSha },
            nginxChangedSince,
        );
        if (paths !== plan.files) plan = classifyChanges(paths);
    }
    if (retainFrontends) {
        assert.equal(managed, false, 'Runtime-only release cannot publish managed content');
        retainedFrontendPlan(plan);
        for (const sha of [storefrontSha, adminSha]) assert.match(sha, /^[a-f0-9]{40}$/u);
        return {
            lane: 'runtime',
            components: [],
            reasons: ['Publish the mailbox backend and preserve all frontend pointers and asset bytes.'],
        };
    }
    if (managed)
        return {
            lane: 'runtime',
            components: [],
            reasons: ['Explicit managed content scope requires the reviewed full release.'],
        };
    if (baseSha === targetSha && storefrontSha === targetSha && adminSha === targetSha) {
        return {
            lane: 'none',
            components: [],
            reasons: ['Runtime and frontend versions already match; no rebuild or deployment.'],
        };
    }
    // Nginx may advance independently only when every other serving input is
    // already active. Pending static components require a prior frontend phase;
    // unknown/backend inputs retain the runtime route. Managed writes were
    // handled above and cannot enter this branch.
    if (!plan.full && plan.files.includes('deploy/nginx/damatong.conf')) {
        const remaining = classifyChanges(plan.files.filter(file => file !== 'deploy/nginx/damatong.conf'));
        const knownFrontends = [storefrontSha, adminSha].every(sha => /^[a-f0-9]{40}$/u.test(sha ?? ''));
        if (['none', 'frontend'].includes(remaining.lane) && knownFrontends) {
            const pending = pendingFrontendComponents(
                remaining,
                { storefrontSha, adminSha, targetSha },
                changedSince,
            );
            if (pending.length) {
                return {
                    lane: 'frontend-nginx',
                    components: pending,
                    reasons: [
                        'Publish pending static components first; apply Nginx only after their exact versions are active. Preserve API and Worker.',
                    ],
                };
            }
            return {
                lane: 'nginx',
                components: [],
                reasons: [
                    'Only reviewed Nginx configuration remains unpublished; preserve API, Worker and frontend versions.',
                ],
            };
        }
    }
    if (plan.lane === 'frontend') {
        const observed = { storefront: storefrontSha, 'next-admin': adminSha };
        if (plan.frontends.some(component => !/^[a-f0-9]{40}$/u.test(observed[component] ?? ''))) {
            return {
                lane: 'runtime',
                components: [],
                reasons: ['A full release must initialize missing frontend pointers.'],
            };
        }
        const components = pendingFrontendComponents(
            plan,
            { storefrontSha, adminSha, targetSha },
            changedSince,
        );
        if (!components.length) {
            return {
                lane: 'none',
                components: [],
                reasons: ['Affected frontend content already matches the active component revisions.'],
            };
        }
        return { lane: 'frontend', components, reasons: plan.reasons };
    }
    if (baseSha === targetSha && (storefrontSha !== targetSha || adminSha !== targetSha)) {
        throw new Error(
            'Frontend version drift at the active runtime SHA: inspect and restore the verified frontend pointers. ' +
                'An empty-diff rebuild cannot repair this state.',
        );
    }
    return { lane: plan.lane, components: plan.frontends, reasons: plan.reasons };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { BASE_SHA: baseSha, TARGET_SHA: targetSha } = process.env;
    const plan = baseSha === targetSha ? classifyChanges([]) : inspection(baseSha, targetSha);
    const route = selectReleaseRoute({
        plan,
        baseSha,
        targetSha,
        storefrontSha: process.env.STOREFRONT_SHA,
        adminSha: process.env.ADMIN_SHA,
        nginxSha: process.env.NGINX_SHA,
        managed: process.env.MANAGED === 'true',
        retainFrontends: process.env.RETAIN_FRONTENDS === 'true',
    });
    if (process.env.GITHUB_OUTPUT)
        appendFileSync(
            process.env.GITHUB_OUTPUT,
            `lane=${route.lane}\ncomponents=${route.components.join(',')}\n`,
        );
    if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(
            process.env.GITHUB_STEP_SUMMARY,
            `## Release scope\n\n${route.reasons.join('\n\n')}\n\nRoute: ${route.lane}; components: ${route.components.join(', ') || 'none'}.\n`,
        );
    process.stdout.write(JSON.stringify(route) + '\n');
}
