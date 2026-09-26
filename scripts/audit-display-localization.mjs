import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const displaySourceRoots = [
    'packages/next-admin/src',
    'packages/storefront/src',
    ...fs
        .readdirSync(path.join(root, 'packages'))
        .filter(name => name.endsWith('-plugin'))
        .flatMap(name =>
            ['dashboard', 'browser']
                .filter(directory => fs.existsSync(path.join(root, 'packages', name, 'src', directory)))
                .map(directory => `packages/${name}/src/${directory}`),
        ),
];
const systemFields = new Set([
    'state',
    'status',
    'eventType',
    'reasonCode',
    'pluginCode',
    'departmentCode',
    'roleCode',
    'permissionCode',
    'paymentMethodCode',
    'costSource',
    'blockType',
    'outcome',
    'outcomeCode',
    'severity',
    'strategy',
    'placement',
    'layoutVariant',
    'incidentStatus',
    'deliveryStatus',
    'ownerDepartmentCode',
    'escalationDepartmentCode',
    'actorType',
    'stage',
    'headerRequestIdSource',
    'rateSource',
    'defaultLanguageCode',
    'providerHostnameStatus',
    'providerSslStatus',
]);
const technicalCodeOwners = new Set([
    'definition',
    'block',
    'slide',
    'operation',
    'condition',
    'action',
    'handler',
]);
const serviceMessageFields = new Set([
    'errorMessage',
    'lastError',
    'lastSyncError',
    'lastVerificationError',
    'providerHealthMessage',
    'healthMessage',
    'unavailableReason',
    'failureReason',
]);
const displayAttributes = new Set([
    'title',
    'aria-label',
    'placeholder',
    'label',
    'description',
    'subtitle',
    'detail',
    'name',
]);
// Proper product names, standardized units and actual keyboard shortcuts are not UI translations.
const technicalTerms =
    /^(?:SKU|USDT|CNY|MYR|HTML|Markdown|WhatsApp|Telegram|Vendure|ESC|\d|[\s#/：:*=().·+-])+$/u;
function isUnlocalizedCopy(value) {
    return /[A-Za-z]{3}/u.test(value) && !/\p{Script=Han}/u.test(value) && !technicalTerms.test(value.trim());
}
function isLocalizedBranch(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (
            ts.isConditionalExpression(parent) &&
            /\b(?:language|languageCode|isZh|isEn|locale)\b/u.test(parent.condition.getText())
        )
            return true;
    }
    return false;
}

function unwrap(node) {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))
        node = node.expression;
    return node;
}
function rawSystemValue(node) {
    node = unwrap(node);
    if (ts.isPropertyAccessExpression(node)) {
        if (['text', 'copy', 'labels', 'zh', 'en'].includes(node.expression.getText())) return false;
        return (
            systemFields.has(node.name.text) ||
            (node.name.text !== 'httpStatus' && /(?:State|Status)$/u.test(node.name.text)) ||
            serviceMessageFields.has(node.name.text) ||
            node.name.text === 'type' ||
            (node.name.text === 'code' && technicalCodeOwners.has(node.expression.getText()))
        );
    }
    if (
        ts.isBinaryExpression(node) &&
        [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)
    ) {
        return rawSystemValue(node.left) || rawSystemValue(node.right);
    }
    if (ts.isTemplateExpression(node))
        return node.templateSpans.some(span => rawSystemValue(span.expression));
    if (ts.isConditionalExpression(node))
        return rawSystemValue(node.whenTrue) || rawSystemValue(node.whenFalse);
    return false;
}
function inTechnicalDetails(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (
            ts.isJsxElement(parent) &&
            parent.openingElement.attributes.properties.some(
                attribute =>
                    ts.isJsxAttribute(attribute) && attribute.name.getText() === 'data-technical-details',
            )
        )
            return true;
        if (ts.isFunctionDeclaration(parent) && /TechnicalDetails/u.test(parent.name?.text ?? ''))
            return true;
    }
    return false;
}

function isBusinessReference(node) {
    return (
        ts.isJsxElement(node.parent) &&
        node.parent.openingElement.attributes.properties.some(
            attribute =>
                ts.isJsxAttribute(attribute) && attribute.name.getText() === 'data-business-reference',
        )
    );
}

/** Source-level contract: system keys must pass a display resolver before becoming visible text. */
export function auditDisplaySource(source, filename) {
    const ast = ts.createSourceFile(
        filename,
        source,
        ts.ScriptTarget.Latest,
        true,
        filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const findings = [];
    const add = (node, rule) =>
        findings.push({
            file: filename,
            line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            rule,
            expression: node.getText().slice(0, 240),
        });
    function visit(node) {
        if (
            filename.startsWith('packages/next-admin/src/') &&
            ts.isJsxText(node) &&
            isUnlocalizedCopy(node.text) &&
            !isLocalizedBranch(node) &&
            !inTechnicalDetails(node)
        ) {
            if (!/^\/[\w/-]+$/u.test(node.text.trim())) add(node, 'unlocalized-ui-copy');
        }
        if (
            filename.startsWith('packages/next-admin/src/') &&
            ts.isJsxAttribute(node) &&
            ['title', 'aria-label', 'label', 'description', 'subtitle', 'detail'].includes(
                node.name.getText(),
            ) &&
            node.initializer &&
            ts.isStringLiteral(node.initializer) &&
            isUnlocalizedCopy(node.initializer.text) &&
            !isLocalizedBranch(node) &&
            !inTechnicalDetails(node)
        )
            add(node, 'unlocalized-ui-copy');
        if (ts.isJsxExpression(node) && node.expression && !inTechnicalDetails(node)) {
            const visible =
                !ts.isJsxAttribute(node.parent) || displayAttributes.has(node.parent.name.getText());
            if (
                visible &&
                filename.startsWith('packages/next-admin/src/') &&
                ts.isStringLiteralLike(node.expression) &&
                isUnlocalizedCopy(node.expression.text) &&
                !isLocalizedBranch(node)
            )
                add(node, 'unlocalized-ui-copy');
            if (visible && !isBusinessReference(node) && rawSystemValue(node.expression))
                add(node, 'raw-system-text');
        }
        if (
            ts.isBinaryExpression(node) &&
            [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)
        ) {
            const left = unwrap(node.left);
            const right = unwrap(node.right);
            if (
                ts.isElementAccessExpression(left) &&
                left.argumentExpression?.getText() === right.getText() &&
                !/class|style|color/iu.test(left.expression.getText())
            ) {
                add(node, 'raw-label-fallback');
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
    return findings;
}

function filesIn(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return filesIn(entryPath);
        return /\.tsx?$/u.test(entry.name) && !/\.(spec|test)\./u.test(entry.name) ? [entryPath] : [];
    });
}
export function auditDisplayProject() {
    const files = displaySourceRoots.flatMap(directory => filesIn(path.join(root, directory)));
    return {
        files: files.length,
        findings: files.flatMap(file =>
            auditDisplaySource(fs.readFileSync(file, 'utf8'), path.relative(root, file)),
        ),
    };
}
export function assertDisplayLocalization() {
    const result = auditDisplayProject();
    if (result.findings.length) {
        const lines = result.findings.map(
            finding => `${finding.file}:${finding.line} ${finding.rule}: ${finding.expression}`,
        );
        throw new Error(`Display localization audit failed:\n${lines.join('\n')}`);
    }
    process.stdout.write(`Display localization audit passed (${result.files} source files)\n`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const result = auditDisplayProject();
    process.stdout.write(
        `${JSON.stringify(result, null, process.argv.includes('--inventory') ? 2 : undefined)}\n`,
    );
    if (result.findings.length && !process.argv.includes('--inventory')) process.exitCode = 1;
}
