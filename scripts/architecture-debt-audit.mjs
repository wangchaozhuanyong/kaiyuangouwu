import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const baselinePath = path.join(scriptDirectory, 'architecture-debt-baseline.json');

export function countLines(source) {
    if (source.length === 0) return 0;
    return source.split(/\r?\n/u).length - (source.endsWith('\n') ? 1 : 0);
}

export function evaluateLimit({ id, currentLines, maxLines, targetLines }) {
    return {
        id,
        currentLines,
        maxLines,
        targetLines,
        overBudget: currentLines > maxLines,
    };
}

async function fileLineCount(relativePath) {
    return countLines(await readFile(path.join(repositoryRoot, relativePath), 'utf8'));
}

async function walkFiles(directory, extensions) {
    const matches = [];
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            matches.push(...(await walkFiles(entryPath, extensions)));
        } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
            matches.push(entryPath);
        }
    }
    return matches;
}

async function groupLineCount(group) {
    let total = 0;
    const extensions = new Set(group.extensions);
    for (const relativePath of group.paths) {
        const files = await walkFiles(path.join(repositoryRoot, relativePath), extensions);
        for (const file of files) total += countLines(await readFile(file, 'utf8'));
    }
    return total;
}

export async function collectArchitectureDebt(config) {
    const files = [];
    for (const budget of config.fileBudgets) {
        files.push(
            evaluateLimit({
                id: budget.path,
                currentLines: await fileLineCount(budget.path),
                maxLines: budget.maxLines,
                targetLines: budget.targetLines,
            }),
        );
    }

    const groups = [];
    for (const budget of config.groupBudgets) {
        groups.push(
            evaluateLimit({
                id: budget.id,
                currentLines: await groupLineCount(budget),
                maxLines: budget.maxLines,
                targetLines: budget.targetLines,
            }),
        );
    }
    return { files, groups };
}

function printResults(results) {
    process.stdout.write('Architecture debt budgets (current / maximum -> target)\n');
    for (const result of [...results.files, ...results.groups]) {
        const marker = result.overBudget ? 'OVER' : 'OK';
        process.stdout.write(
            `${marker.padEnd(4)} ${result.id}: ${result.currentLines} / ${result.maxLines} -> ${result.targetLines}\n`,
        );
    }
}

async function main() {
    const config = JSON.parse(await readFile(baselinePath, 'utf8'));
    if (config.schemaVersion !== 1) {
        throw new Error(`Unsupported architecture debt baseline version: ${String(config.schemaVersion)}`);
    }
    const results = await collectArchitectureDebt(config);
    printResults(results);
    if (
        process.argv.includes('--check') &&
        [...results.files, ...results.groups].some(result => result.overBudget)
    ) {
        process.exitCode = 1;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
