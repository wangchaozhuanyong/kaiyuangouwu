import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const storefrontPackagePath = path.resolve(scriptDirectory, '../package.json');
const storefrontPackage = JSON.parse(await readFile(storefrontPackagePath, 'utf8'));
const declaredRange = storefrontPackage.devDependencies?.['@tanstack/router-plugin'];

assert.match(
    declaredRange ?? '',
    /^\^\d+\.\d+\.\d+$/,
    'Storefront router plugin must use a supported caret version range',
);

const installedPackagePath = fileURLToPath(import.meta.resolve('@tanstack/router-plugin/package.json'));
const installedPackage = JSON.parse(await readFile(installedPackagePath, 'utf8'));

const parseVersion = version => version.split('.').map(part => Number.parseInt(part, 10));
const compareVersions = (left, right) => {
    const leftParts = parseVersion(left);
    const rightParts = parseVersion(right);
    for (let index = 0; index < 3; index += 1) {
        if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
    }
    return 0;
};

const minimumVersion = declaredRange.slice(1);
const [minimumMajor, minimumMinor, minimumPatch] = parseVersion(minimumVersion);
const [installedMajor, installedMinor, installedPatch] = parseVersion(installedPackage.version);
const upperBound =
    minimumMajor > 0
        ? [minimumMajor + 1, 0, 0]
        : minimumMinor > 0
          ? [0, minimumMinor + 1, 0]
          : [0, 0, minimumPatch + 1];
const installedVersion = [installedMajor, installedMinor, installedPatch].join('.');
const upperBoundVersion = upperBound.join('.');
const mismatchMessage =
    `Storefront requires @tanstack/router-plugin ${declaredRange}, ` +
    `but resolved ${installedPackage.version} from ${installedPackagePath}. ` +
    'Run a frozen workspace install before generating routes.';

assert.ok(
    compareVersions(installedVersion, minimumVersion) >= 0 &&
        compareVersions(installedVersion, upperBoundVersion) < 0,
    mismatchMessage,
);

process.stdout.write(`Storefront router toolchain verified: ${installedPackage.version}\n`);
