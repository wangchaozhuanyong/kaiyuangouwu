import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'src');
const reloadOwners = new Set(['StorefrontErrorBoundary.tsx', 'StorefrontUpdatePrompt.tsx']);
// Auth closes an entry it owns; ordinary page returns belong to the shared history owner.
const historyReturnOwners = new Set([
    'storefront-navigation-history.ts',
    'auth-overlay-navigation-actions.ts',
]);

export function checkInteractionSource(file, source) {
    const violations = [];
    if (/content-visibility\s*:\s*auto\b/u.test(source))
        violations.push('正文不能用估算高度跳过布局；首帧须计算真实几何，避免刷新与滚动回跳');
    if (/\b(?:window\.)?location\.reload\s*\(/u.test(source) && !reloadOwners.has(file))
        violations.push('数据重试不得整页 reload；使用当前作用域 refreshStorefrontQueries');
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = node => {
        if (
            ts.isPropertyAssignment(node) &&
            node.name.getText(parsed).replace(/["']/gu, '') === 'gcTime' &&
            ts.isNumericLiteral(node.initializer) &&
            Number(node.initializer.text) === 0 &&
            !/@ephemeral-sensitive:\s*\S.+/u.test(source.slice(node.getFullStart(), node.getStart(parsed)))
        )
            violations.push(
                '普通只读查询不得离开即清除；敏感凭据例外须在 gcTime 前说明 @ephemeral-sensitive 原因并验证隔离',
            );
        if (
            ts.isJsxAttribute(node) &&
            node.name.text === 'fallback' &&
            node.initializer &&
            ts.isJsxExpression(node.initializer)
        ) {
            const fallback = node.initializer.expression;
            if (
                fallback &&
                ts.isJsxElement(fallback) &&
                ['p', 'span'].includes(fallback.openingElement.tagName.getText(parsed))
            )
                violations.push('懒加载占位必须使用对应布局骨架，不能只显示一行文字');
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const method = node.expression.name.text;
            const receiver = node.expression.expression;
            const rawHistory =
                (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'history') ||
                (ts.isIdentifier(receiver) && receiver.text === 'history');
            if (rawHistory && (method === 'back' || method === 'go') && !historyReturnOwners.has(file))
                violations.push(
                    '页面返回必须使用 goBackInStorefront / returnToStorefrontRoute，避免重复历史和返回循环',
                );
            if (method === 'refetch' || method === 'fetchNextPage') {
                const options = node.arguments[0];
                const joinsRequest =
                    options &&
                    ts.isObjectLiteralExpression(options) &&
                    options.properties.some(
                        property =>
                            ts.isPropertyAssignment(property) &&
                            property.name.getText(parsed) === 'cancelRefetch' &&
                            property.initializer.kind === ts.SyntaxKind.FalseKeyword,
                    );
                if (!joinsRequest)
                    violations.push(`${method} 必须声明 cancelRefetch: false，连续点击复用请求`);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(parsed);
    if (/placeholderData\s*:\s*keepPreviousData/u.test(source))
        violations.push('placeholder 必须核对店铺、币种和语言，使用 storefrontPlaceholderData');
    if (/refetchIntervalInBackground\s*:\s*true/u.test(source))
        violations.push('页面隐藏时不得继续普通业务轮询');
    if (/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/u.test(source))
        violations.push('业务交互必须使用现有应用内状态或弹窗');
    return violations.map(message => `${file}: ${message}`);
}

function files(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory()
            ? files(file)
            : /\.(?:[jt]sx?|css)$/u.test(entry.name) && !/\.(spec|test)\./u.test(entry.name)
              ? [file]
              : [];
    });
}

export function auditInteractionStandard() {
    return files(sourceRoot).flatMap(file =>
        checkInteractionSource(
            path.relative(sourceRoot, file).split(path.sep).join('/'),
            readFileSync(file, 'utf8'),
        ),
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const violations = auditInteractionStandard();
    if (violations.length) {
        process.stderr.write(`${violations.join('\n')}\n`);
        process.exitCode = 1;
    } else process.stdout.write('Storefront interaction standard passed\n');
}
