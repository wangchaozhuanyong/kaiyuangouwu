import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const migrationDirectory = path.join(repositoryRoot, 'packages/dev-server/migrations');
const migrationIndexPath = path.join(migrationDirectory, 'index.ts');

const approvedDuplicateTimestamps = new Map([
    [
        '1787785200000',
        ['1787785200000-add-referral-poster-templates.ts', '1787785200000-align-usdt-trc20-schema.ts'],
    ],
    [
        '1787796000000',
        ['1787796000000-add-fixed-money-source-currency.ts', '1787796000000-normalize-digital-inventory.ts'],
    ],
    [
        '1787806800000',
        ['1787806800000-add-mobile-referral-poster-copy.ts', '1787806800000-repair-fixed-money-json.ts'],
    ],
]);

const approvedOrphanMigrations = new Set([
    '1787785200000-align-usdt-trc20-schema.ts',
    '1787796000000-normalize-digital-inventory.ts',
]);

function sorted(values) {
    return [...values].sort((left, right) => left.localeCompare(right));
}

function sameValues(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function analyzeMigrationRegistry({
    fileNames,
    indexSource,
    sources,
    allowedDuplicates,
    allowedOrphans = new Set(),
}) {
    const errors = [];
    const migrationFiles = sorted(fileNames.filter(fileName => /^\d{13}-.+\.ts$/u.test(fileName)));
    const classByFile = new Map();

    for (const fileName of migrationFiles) {
        const source = sources.get(fileName);
        if (source == null) {
            errors.push(`Missing source for ${fileName}`);
            continue;
        }
        const classes = [...source.matchAll(/export class\s+(\w+)\s+implements\s+MigrationInterface/gu)].map(
            match => match[1],
        );
        if (classes.length !== 1) {
            errors.push(
                `${fileName} must export exactly one MigrationInterface class; found ${classes.length}`,
            );
            continue;
        }
        const timestamp = fileName.slice(0, 13);
        if (!classes[0].endsWith(timestamp)) {
            errors.push(`${fileName} exports ${classes[0]}, which does not end with its timestamp`);
        }
        classByFile.set(fileName, classes[0]);
    }

    const imports = new Map();
    for (const match of indexSource.matchAll(/^import\s+\{\s*(\w+)\s*\}\s+from\s+'\.\/([^']+)'\s*;/gmu)) {
        const [, className, importPath] = match;
        imports.set(`${importPath}.ts`, className);
    }

    const registryMatch = indexSource.match(/export const devServerMigrations\s*=\s*\[([\s\S]*?)\];/u);
    if (!registryMatch) {
        errors.push('Could not find the devServerMigrations registry');
    }
    const registryEntries = registryMatch
        ? registryMatch[1]
              .replace(/\/\*[\s\S]*?\*\//gu, '')
              .replace(/\/\/.*$/gmu, '')
              .split(',')
              .map(value => value.trim())
              .filter(Boolean)
        : [];

    const registryCounts = new Map();
    for (const entry of registryEntries) registryCounts.set(entry, (registryCounts.get(entry) ?? 0) + 1);

    for (const [fileName, className] of classByFile) {
        if (allowedOrphans.has(fileName)) {
            if (imports.has(fileName) || registryCounts.has(className)) {
                errors.push(
                    `${fileName} is an approved orphan and must not enter the active registry implicitly`,
                );
            }
            continue;
        }
        if (imports.get(fileName) !== className) {
            errors.push(`${fileName} must be imported as ${className}`);
        }
        const count = registryCounts.get(className) ?? 0;
        if (count !== 1)
            errors.push(`${className} must appear in devServerMigrations exactly once; found ${count}`);
    }

    for (const [fileName, className] of imports) {
        if (!classByFile.has(fileName))
            errors.push(`Index imports ${className} from missing migration ${fileName}`);
    }
    for (const fileName of allowedOrphans) {
        if (!classByFile.has(fileName))
            errors.push(`Approved orphan migration no longer exists: ${fileName}`);
    }
    for (const entry of registryCounts.keys()) {
        if (![...imports.values()].includes(entry))
            errors.push(`Registry entry ${entry} has no migration import`);
    }

    const filesByTimestamp = new Map();
    for (const fileName of migrationFiles) {
        const timestamp = fileName.slice(0, 13);
        const files = filesByTimestamp.get(timestamp) ?? [];
        files.push(fileName);
        filesByTimestamp.set(timestamp, files);
    }
    for (const [timestamp, files] of filesByTimestamp) {
        if (files.length < 2) continue;
        const approved = allowedDuplicates.get(timestamp);
        if (!approved || !sameValues(sorted(files), sorted(approved))) {
            errors.push(`Migration timestamp ${timestamp} is duplicated by: ${sorted(files).join(', ')}`);
        }
    }

    let previousTimestamp = '';
    for (const className of registryEntries) {
        const fileName = [...imports].find(([, importedClass]) => importedClass === className)?.[0];
        if (!fileName) continue;
        const timestamp = fileName.slice(0, 13);
        if (previousTimestamp && timestamp < previousTimestamp) {
            errors.push(`${className} is out of chronological order in devServerMigrations`);
        }
        previousTimestamp = timestamp;
    }

    return {
        errors,
        migrationCount: migrationFiles.length,
        registeredCount: migrationFiles.length - allowedOrphans.size,
        orphanCount: allowedOrphans.size,
    };
}

async function main() {
    const fileNames = await readdir(migrationDirectory);
    const migrationFiles = fileNames.filter(fileName => /^\d{13}-.+\.ts$/u.test(fileName));
    const sources = new Map(
        await Promise.all(
            migrationFiles.map(async fileName => [
                fileName,
                await readFile(path.join(migrationDirectory, fileName), 'utf8'),
            ]),
        ),
    );
    const result = analyzeMigrationRegistry({
        fileNames,
        indexSource: await readFile(migrationIndexPath, 'utf8'),
        sources,
        allowedDuplicates: approvedDuplicateTimestamps,
        allowedOrphans: approvedOrphanMigrations,
    });
    if (result.errors.length) {
        for (const error of result.errors) process.stderr.write(`- ${error}\n`);
        process.exitCode = 1;
        return;
    }
    process.stdout.write(
        `Migration registry check passed for ${result.registeredCount} active migrations` +
            ` (${result.orphanCount} approved historical orphans, ${result.migrationCount} source files)\n`,
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
