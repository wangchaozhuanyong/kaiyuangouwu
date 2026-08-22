import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eslintBin = path.join(repositoryRoot, 'node_modules', 'eslint', 'bin', 'eslint.js');
const supportedExtensions = new Set(['.cts', '.mjs', '.mts', '.ts', '.tsx']);
const maxFilesPerProcess = 200;

function groupName(file) {
    const [topLevel, packageName] = file.split('/');
    return topLevel === 'packages' && packageName ? `${topLevel}/${packageName}` : topLevel;
}

const baseArgumentIndex = process.argv.indexOf('--base');
if (baseArgumentIndex !== -1 && !process.argv[baseArgumentIndex + 1]) {
    throw new Error('--base requires a Git revision');
}
const requestedBase = baseArgumentIndex === -1 ? 'HEAD' : process.argv[baseArgumentIndex + 1];
const resolvedBase = execFileSync('git', ['rev-parse', '--verify', `${requestedBase}^{commit}`], {
    cwd: repositoryRoot,
    encoding: 'utf8',
}).trim();
const changedFiles = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', '-z', resolvedBase, '--'],
    { cwd: repositoryRoot, encoding: 'utf8' },
).split('\0');
const untrackedFiles = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
}).split('\0');

const sourceFiles = [...new Set([...changedFiles, ...untrackedFiles])]
    .filter(Boolean)
    .filter(file => supportedExtensions.has(path.extname(file)))
    .sort();

const groups = new Map();
for (const sourceFile of sourceFiles) {
    const name = groupName(sourceFile);
    const files = groups.get(name) ?? [];
    files.push(sourceFile);
    groups.set(name, files);
}

let checkedFiles = 0;
for (const [name, files] of groups) {
    const packageDirectory = path.join(repositoryRoot, name);
    const usesPackageFlatConfig = existsSync(path.join(packageDirectory, 'eslint.config.js'));
    const lintWorkingDirectory = usesPackageFlatConfig ? packageDirectory : repositoryRoot;
    const lintFiles = usesPackageFlatConfig
        ? files.map(file => path.relative(packageDirectory, path.join(repositoryRoot, file)))
        : files;

    for (let offset = 0; offset < lintFiles.length; offset += maxFilesPerProcess) {
        const shard = lintFiles.slice(offset, offset + maxFilesPerProcess);
        process.stdout.write(
            `Linting ${name}: files ${offset + 1}-${offset + shard.length}/${lintFiles.length}` +
                `${usesPackageFlatConfig ? ' (package config)' : ''}\n`,
        );
        const result = spawnSync(process.execPath, [eslintBin, ...shard], {
            cwd: lintWorkingDirectory,
            stdio: 'inherit',
        });
        if (result.error) {
            throw result.error;
        }
        if (result.status !== 0) {
            process.exit(result.status ?? 1);
        }
        checkedFiles += shard.length;
    }
}

process.stdout.write(`Lint check passed for ${checkedFiles} changed source files since ${resolvedBase}\n`);
