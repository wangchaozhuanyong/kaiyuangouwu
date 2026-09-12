import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { classifyChanges, inspection } from '../scripts/ci-impact.mjs';

export function selectReleaseRoute({ plan, baseSha, targetSha, storefrontSha, adminSha, managed = false }) {
    for (const sha of [baseSha, targetSha]) assert.match(sha, /^[a-f0-9]{40}$/u);
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
    if (plan.lane === 'frontend') {
        const observed = { storefront: storefrontSha, 'next-admin': adminSha };
        if (plan.frontends.some(component => !/^[a-f0-9]{40}$/u.test(observed[component] ?? ''))) {
            return {
                lane: 'runtime',
                components: [],
                reasons: ['A full release must initialize missing frontend pointers.'],
            };
        }
        if (plan.frontends.every(component => observed[component] === targetSha)) {
            return {
                lane: 'none',
                components: [],
                reasons: ['The affected frontend versions are already active.'],
            };
        }
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
        managed: process.env.MANAGED === 'true',
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
