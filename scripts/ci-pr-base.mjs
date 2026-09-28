import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function assertPrHeadContainsBase(base, head = 'HEAD', git = execFileSync) {
    if (!base) return false;
    assert.match(base, /^[0-9a-f]{40}$/u, 'Expected an exact PR base SHA');
    try {
        git('git', ['merge-base', '--is-ancestor', base, head], { stdio: 'ignore' });
    } catch {
        throw new Error(
            `PR head ${head} does not contain current main ${base}; refresh the branch before its first CI run`,
        );
    }
    return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    assertPrHeadContainsBase(process.argv[2] ?? '');
}
