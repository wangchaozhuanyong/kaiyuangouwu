import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(packageRoot, 'src');
const allowedRawMessageFiles = new Set([
    'apollo.ts',
    'utils/authentication-error.ts',
    'utils/build-recovery.ts',
    'utils/operation-failure.ts',
    'pages/Catalog/import/CatalogImportDialog.tsx',
    'pages/Catalog/import/catalog-import.worker.ts',
]);
const violations = [];

for (const file of sourceFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, file).split(path.sep).join('/');
    if (/\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(relative)) continue;
    const source = readFileSync(file, 'utf8');

    if (
        !allowedRawMessageFiles.has(relative) &&
        /(?:\b(?:error|err)\.message\b|\.error\?*\.message\b)/u.test(source)
    ) {
        violations.push(`${relative}: do not render raw Error.message; use toUserFacingError()`);
    }
    if (source.includes('失败，请检查填写内容和账号权限后重试')) {
        violations.push(`${relative}: replace the generic failure copy with an actionable reason`);
    }
    if (relative !== 'utils/admin-clipboard.ts' && source.includes('navigator.clipboard')) {
        violations.push(`${relative}: use admin-clipboard so browser permission failures are explained`);
    }
}

const apolloSource = readFileSync(path.join(sourceRoot, 'apollo.ts'), 'utf8');
if (!apolloSource.includes('adminMutationFeedbackLink')) {
    violations.push('apollo.ts: global mutation feedback link is not installed');
}
const mainSource = readFileSync(path.join(sourceRoot, 'main.tsx'), 'utf8');
if (!mainSource.includes('<AdminFeedbackCenter')) {
    violations.push('main.tsx: AdminFeedbackCenter is not mounted');
}

if (violations.length) {
    process.stderr.write(`Admin operation feedback audit failed:\n- ${violations.join('\n- ')}\n`);
    process.exit(1);
}

process.stdout.write('Admin operation feedback audit passed\n');

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(entryPath);
        return /\.[cm]?[jt]sx?$/u.test(entry.name) ? [entryPath] : [];
    });
}
