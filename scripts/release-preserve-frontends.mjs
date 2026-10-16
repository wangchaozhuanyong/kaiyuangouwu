import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { classifyChanges, isAutomationOnly, isDocumentation, packageInventory } from './ci-impact.mjs';

const frontendOnly = file => /^packages\/(?:storefront|next-admin)\/(?:src|e2e)\//u.test(file);
export function retainedFrontendPlan(plan, packageList = packageInventory()) {
    assert.equal(plan.full, false, 'Preserving frontend versions requires a scoped release');
    for (const file of plan.files)
        assert.ok(
            frontendOnly(file) ||
                file.startsWith('packages/icloud-relay-plugin/src/') ||
                isAutomationOnly(file) ||
                isDocumentation(file) ||
                ['deploy/deploy-production-from-s3.sh', 'deploy/release-route.mjs'].includes(file),
            `Runtime-only mailbox release cannot include ${file}`,
        );
    const selected = classifyChanges(
        plan.files.filter(file => !frontendOnly(file)),
        packageList,
        false,
    );
    assert.equal(selected.lane, 'runtime', 'Frontend preservation requires a pending mailbox runtime change');
    assert.deepEqual(selected.frontends, []);
    return selected;
}

function inventory(directory) {
    const result = {};
    function walk(relative = '') {
        for (const name of readdirSync(path.join(directory, relative)).sort()) {
            const next = path.join(relative, name);
            const file = path.join(directory, next);
            const stat = lstatSync(file);
            assert.ok(!stat.isSymbolicLink(), 'Frontend assets must be immutable regular files');
            if (stat.isDirectory()) walk(next);
            else {
                assert.ok(stat.isFile());
                result[next] = createHash('sha256').update(readFileSync(file)).digest('hex');
            }
        }
    }
    walk();
    assert.ok(Object.keys(result).length > 0);
    return result;
}

export function frontendSnapshot({ storefrontSha, adminSha, pointerDirectory = '/var/www' }) {
    const result = { version: 1, components: {} };
    for (const [component, expected] of [
        ['storefront', storefrontSha],
        ['next-admin', adminSha],
        ['two-factor', null],
    ]) {
        if (expected !== null) assert.match(expected, /^[a-f0-9]{40}$/u);
        const pointer = path.join(pointerDirectory, `kaiyuangouwu-${component}-current`);
        assert.ok(lstatSync(pointer).isSymbolicLink(), 'Frontend preservation requires initialized pointers');
        const directory = realpathSync(pointer);
        assert.ok(lstatSync(directory).isDirectory());
        assert.ok(
            ['kaiyuangouwu-releases', 'kaiyuangouwu-frontend-releases'].some(name =>
                directory.startsWith(path.join(pointerDirectory, name) + path.sep),
            ),
            'Frontend pointer escaped immutable release roots',
        );
        const files = inventory(directory);
        if (expected !== null) {
            const names = ['frontend-release.json', 'storefront-release.json'];
            const marker = names.find(name => Object.hasOwn(files, name));
            assert.ok(marker, 'Frontend preservation requires an immutable source marker');
            assert.equal(JSON.parse(readFileSync(path.join(directory, marker), 'utf8')).sourceSha, expected);
        }
        result.components[component] = { pointer, directory, files };
    }
    return result;
}

export function verifyFrontendSnapshot(snapshot, options) {
    assert.deepEqual(frontendSnapshot(options), snapshot, 'Frontend pointer or asset content changed');
}

function main() {
    const [mode, receipt, storefrontSha, adminSha] = process.argv.slice(2);
    assert.ok(['snapshot', 'verify'].includes(mode));
    assert.ok(path.isAbsolute(receipt));
    const options = { storefrontSha, adminSha };
    if (mode === 'snapshot')
        writeFileSync(receipt, JSON.stringify(frontendSnapshot(options)) + '\n', { flag: 'wx', mode: 0o600 });
    else {
        assert.ok(lstatSync(receipt).isFile() && !lstatSync(receipt).isSymbolicLink());
        verifyFrontendSnapshot(JSON.parse(readFileSync(receipt, 'utf8')), options);
        process.stdout.write(
            `PRODUCTION_FRONTEND_PRESERVED storefront=${storefrontSha} next-admin=${adminSha}\n`,
        );
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
