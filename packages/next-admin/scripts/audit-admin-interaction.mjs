import { Kind, parse } from 'graphql';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Read-only architecture gate. It does not rewrite source or expose runtime request context.
const defaultSourceRoot = path.resolve(import.meta.dirname, '../src');

/** Exported only for isolated rule-gate fixtures; production commands always use the package source. */
export function auditAdminInteraction(root = defaultSourceRoot) {
    const violations = [];
    const coverage = {
        sourceFiles: 0,
        managedQueryFiles: 0,
        managedQueryCalls: 0,
        sharedControls: 0,
        pageRefreshButtons: 0,
        mutationDocuments: 0,
        mappedMutations: 0,
        authTransitions: 0,
    };
    const walk = directory =>
        fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) return /^(?:test|__tests__)$/.test(entry.name) ? [] : walk(file);
            return /\.[cm]?[jt]sx?$/.test(file) && !/\.(?:spec|test)\./.test(entry.name) ? [file] : [];
        });
    const rawQueryFiles = new Set(['App.tsx', 'layouts/AppShell.tsx', 'hooks/use-admin-query.ts']);
    const rawQueryHooks = new Set([
        'useQuery',
        'useLazyQuery',
        'useSuspenseQuery',
        'useBackgroundQuery',
        'useLoadableQuery',
    ]);
    function unwrap(expression) {
        while (
            ts.isParenthesizedExpression(expression) ||
            ts.isAsExpression(expression) ||
            ts.isTypeAssertionExpression(expression) ||
            ts.isNonNullExpression(expression)
        )
            expression = expression.expression;
        return expression;
    }
    for (const file of walk(root)) {
        coverage.sourceFiles++;
        const source = fs.readFileSync(file, 'utf8');
        const tree = ts.createSourceFile(
            file,
            source,
            ts.ScriptTarget.Latest,
            true,
            /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        const relative = path.relative(root, file).split(path.sep).join('/');
        const fail = (node, reason) =>
            violations.push(
                `${relative}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1} ${reason}`,
            );
        const queryNames = new Set();
        const apolloNamespaces = new Set();
        for (const statement of tree.statements) {
            if (!ts.isImportDeclaration(statement)) continue;
            const names = statement.importClause?.namedBindings;
            if (
                names &&
                ts.isNamespaceImport(names) &&
                /^@apollo\/client(?:\/react)?$/.test(statement.moduleSpecifier.text)
            )
                apolloNamespaces.add(names.name.text);
            if (!names || !ts.isNamedImports(names)) continue;
            for (const name of names.elements) {
                const original = name.propertyName?.text ?? name.name.text;
                if (
                    statement.moduleSpecifier.text.endsWith('hooks/use-admin-query') &&
                    /useAdmin(?:Lazy)?Query/.test(original)
                )
                    queryNames.add(name.name.text);
                if (
                    /^@apollo\/client(?:\/react)?$/.test(statement.moduleSpecifier.text) &&
                    rawQueryHooks.has(original) &&
                    !rawQueryFiles.has(relative)
                )
                    fail(name, '业务查询必须使用 use-admin-query');
            }
        }
        if (queryNames.size) coverage.managedQueryFiles++;
        const jsxTag = node =>
            ts.isJsxElement(node)
                ? node.openingElement.tagName.getText(tree)
                : ts.isJsxSelfClosingElement(node)
                  ? node.tagName.getText(tree)
                  : '';
        const jsxAttribute = (node, name) => {
            const attributes = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes;
            return attributes?.properties.find(
                attribute => ts.isJsxAttribute(attribute) && attribute.name.text === name,
            )?.initializer;
        };
        const isShortControl = node =>
            ['AdminInput', 'AdminSelect', 'SearchInput'].includes(jsxTag(node)) &&
            !/(?:checkbox|radio|range|file|color|hidden)/.test(
                jsxAttribute(node, 'type')?.getText(tree) ?? '',
            );
        function visit(node) {
            if (ts.isJsxElement(node) && jsxTag(node) === 'label') {
                const children = node.children.filter(child => !ts.isJsxText(child) || child.text.trim());
                const controlIndex = children.findIndex(isShortControl);
                const hasCaption = children
                    .slice(0, controlIndex)
                    .some(
                        child => ts.isJsxText(child) || ts.isJsxExpression(child) || jsxTag(child) === 'span',
                    );
                const classes = jsxAttribute(node, 'className')?.getText(tree) ?? '';
                const isInline =
                    /(?:^|[\s"'`])(?:inline-flex|flex)(?:[\s"'`]|$)/.test(classes) &&
                    !/\bflex-col\b/.test(classes);
                if (
                    controlIndex > 0 &&
                    hasCaption &&
                    classes &&
                    !isInline &&
                    // A multi-line order/selection card is a compound label, not a short field caption.
                    !/rounded.*border/.test(classes)
                )
                    fail(node, '短字段标题与控件须使用 AdminField 自适应横排，不能固定上下排列');
            }
            if (
                ts.isCallExpression(node) &&
                ts.isIdentifier(node.expression) &&
                queryNames.has(node.expression.text)
            )
                coverage.managedQueryCalls++;
            if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
                const tag = node.tagName.getText(tree);
                if (
                    relative !== 'components/AdminControls.tsx' &&
                    ['button', 'input', 'select', 'textarea'].includes(tag)
                )
                    fail(node, '交互控件必须使用 AdminControls');
                if (/^Admin(?:Button|Input|Select|TextArea)$/.test(tag)) coverage.sharedControls++;
                if (
                    tag === 'AdminButton' &&
                    node.attributes.properties.some(
                        attribute => ts.isJsxAttribute(attribute) && attribute.name.text === 'refreshPage',
                    )
                )
                    coverage.pageRefreshButtons++;
            }
            if (ts.isCallExpression(node)) {
                const expression = unwrap(node.expression);
                const call = expression.getText(tree);
                if (
                    relative !== 'hooks/use-page-activity.ts' &&
                    /^(?:(?:window|globalThis)\.)?setInterval$/.test(call)
                )
                    fail(node, '页面计时必须使用 useActiveInterval');
                if (/^(?:window\.)?location\.reload$/.test(call))
                    fail(node, '页面刷新不得使用 location.reload；版本恢复使用 build-recovery');
                if (
                    !rawQueryFiles.has(relative) &&
                    ts.isPropertyAccessExpression(expression) &&
                    apolloNamespaces.has(unwrap(expression.expression).getText(tree)) &&
                    rawQueryHooks.has(expression.name.text)
                )
                    fail(node, '业务查询必须使用 use-admin-query，命名空间导入也不能绕过');
            }
            ts.forEachChild(node, visit);
        }
        visit(tree);
    }
    // Read the production rule literals so this gate cannot drift into a second policy table.
    const policyFile = path.join(root, 'runtime/admin-resource-events.ts');
    const policyTree = ts.createSourceFile(
        policyFile,
        fs.readFileSync(policyFile, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    );
    let domainPatterns = [];
    let authFields = new Set();
    function readPolicy(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(policyTree) === 'domainRules') {
            if (!node.initializer || !ts.isArrayLiteralExpression(node.initializer))
                throw new Error('资源域规则须保持可审计的静态数组');
            domainPatterns = node.initializer.elements.map(rule => {
                const literal = rule.elements[1].getText(policyTree);
                const end = literal.lastIndexOf('/');
                return new RegExp(literal.slice(1, end), literal.slice(end + 1));
            });
        }
        if (ts.isVariableDeclaration(node) && node.name.getText(policyTree) === 'authTransitionFields')
            authFields = new Set(node.initializer.arguments[0].elements.map(element => element.text));
        ts.forEachChild(node, readPolicy);
    }
    readPolicy(policyTree);
    if (!domainPatterns.length) throw new Error('没有读取到生产资源域规则');
    for (const file of walk(root)) {
        const tree = ts.createSourceFile(
            file,
            fs.readFileSync(file, 'utf8'),
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TSX,
        );
        function visit(node) {
            if (ts.isTaggedTemplateExpression(node) && node.tag.getText(tree) === 'gql') {
                const raw = ts.isNoSubstitutionTemplateLiteral(node.template)
                    ? node.template.text
                    : node.template.head.text +
                      node.template.templateSpans.map(span => span.literal.text).join('');
                let document;
                try {
                    document = parse(raw);
                } catch {
                    // Fully composed dynamic documents are handled by their constituent static definitions.
                    ts.forEachChild(node, visit);
                    return;
                }
                for (const operation of document.definitions.filter(
                    definition =>
                        definition.kind === Kind.OPERATION_DEFINITION && definition.operation === 'mutation',
                )) {
                    coverage.mutationDocuments++;
                    const fields = operation.selectionSet.selections
                        .filter(selection => selection.kind === Kind.FIELD)
                        .map(selection => selection.name.value);
                    const business = fields.filter(field => !authFields.has(field));
                    if (!business.length) coverage.authTransitions++;
                    else if (business.every(field => domainPatterns.some(pattern => pattern.test(field))))
                        coverage.mappedMutations++;
                    else
                        violations.push(
                            `${path.relative(root, file)}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1} 写入缺少资源域：${business.filter(field => !domainPatterns.some(pattern => pattern.test(field))).join(', ')}`,
                        );
                }
            }
            ts.forEachChild(node, visit);
        }
        visit(tree);
    }
    return { coverage, violations };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const report = auditAdminInteraction();
    console.log(JSON.stringify(report, null, 2));
    if (report.violations.length) process.exitCode = 1;
}
