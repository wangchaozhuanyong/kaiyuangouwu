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

function unwrap(node) {
    while (
        node &&
        (ts.isParenthesizedExpression(node) ||
            ts.isAsExpression(node) ||
            ts.isTypeAssertionExpression(node) ||
            ts.isSatisfiesExpression(node) ||
            ts.isNonNullExpression(node))
    )
        node = node.expression;
    return node;
}

function moduleBindings(parsed) {
    return new Map(
        parsed.statements
            .filter(ts.isVariableStatement)
            .flatMap(statement =>
                statement.declarationList.declarations
                    .filter(declaration => ts.isIdentifier(declaration.name))
                    .map(declaration => [declaration.name.text, unwrap(declaration.initializer)]),
            ),
    );
}

function moduleOwned(node) {
    let owner = node.parent;
    while (owner && !ts.isSourceFile(owner) && !ts.isFunctionLike(owner)) owner = owner.parent;
    return owner && ts.isSourceFile(owner);
}

export function checkInteractionSource(file, source) {
    const violations = [];
    if (/content-visibility\s*:\s*auto\b/u.test(source))
        violations.push('正文不能用估算高度跳过布局；首帧须计算真实几何，避免刷新与滚动回跳');
    // Stylesheets have no query constructors or JS call sites. Do not parse CSS
    // as a TSX program; large global sheets otherwise dominate the source gate.
    if (/\.css$/u.test(file)) return violations.map(message => `${file}: ${message}`);
    if (/\b(?:window\.)?location\.reload\s*\(/u.test(source) && !reloadOwners.has(file))
        violations.push('数据重试不得整页 reload；使用当前作用域 refreshStorefrontQueries');
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const bindings = moduleBindings(parsed);
    const queryConstructors = new Set(['QueryClient']);
    for (const statement of parsed.statements) {
        if (!ts.isImportDeclaration(statement) || !/\bquery(?:-core)?$/u.test(statement.moduleSpecifier.text))
            continue;
        const imports = statement.importClause?.namedBindings;
        if (imports && ts.isNamedImports(imports))
            for (const item of imports.elements)
                if ((item.propertyName ?? item.name).text === 'QueryClient')
                    queryConstructors.add(item.name.text);
    }
    const isQueryConstructor = (expression, seen = new Set()) => {
        const node = unwrap(expression);
        if (!node) return false;
        if (ts.isPropertyAccessExpression(node)) return node.name.text === 'QueryClient';
        if (!ts.isIdentifier(node) || seen.has(node.text)) return false;
        if (queryConstructors.has(node.text)) return true;
        seen.add(node.text);
        return isQueryConstructor(bindings.get(node.text), seen);
    };
    const functions = new Map();
    const collectFunctions = node => {
        if (ts.isFunctionDeclaration(node) && node.name && node.body)
            functions.set(node.name.text, node.body);
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        )
            functions.set(node.name.text, node.initializer.body);
        ts.forEachChild(node, collectFunctions);
    };
    if (/\bsetInterval\s*\(/u.test(source)) collectFunctions(parsed);
    const readsServer = (node, seen = new Set()) => {
        if (!node) return false;
        if (ts.isIdentifier(node) && !seen.has(node.text)) {
            seen.add(node.text);
            if (functions.has(node.text)) return readsServer(functions.get(node.text), seen);
            if (/^(?:refresh|refetch|fetch|poll|load)(?:[A-Z_]|$)/u.test(node.text)) return true;
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const target = node.expression.expression.getText(parsed);
            if (
                /(?:^|\.)api$/iu.test(target) ||
                /^(?:refetch|fetchNextPage|fetchQuery)$/u.test(node.expression.name.text)
            )
                return true;
        }
        return ts.forEachChild(node, child => readsServer(child, seen)) === true;
    };
    const visit = node => {
        let owner;
        if (ts.isNewExpression(node)) {
            owner = node.parent;
            while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
        }
        // SSR deliberately creates one isolated client per document; it must never
        // share request/customer state with the browser singleton or another render.
        const serverDocumentClient =
            file === 'public-snapshot.tsx' &&
            owner &&
            ts.isFunctionDeclaration(owner) &&
            owner.name?.text === 'createPublicSnapshotApp';
        if (
            ts.isNewExpression(node) &&
            isQueryConstructor(node.expression) &&
            file !== 'query-client.ts' &&
            !serverDocumentClient
        )
            violations.push('业务页面不得创建第二个 QueryClient；复用根查询缓存');
        if (
            ts.isNewExpression(node) &&
            unwrap(node.expression)?.getText(parsed) === 'Map' &&
            /^(?:pages|route-pages|client-plugins|hooks)\//u.test(file) &&
            moduleOwned(node) &&
            !/\b\w*Draft(?:State)?\b/u.test(node.typeArguments?.[1]?.getText(parsed) ?? '')
        )
            violations.push(
                '页面、插件与 Hook 不得保留模块级 Map 状态；业务数据归根 QueryClient，独立草稿必须明确 Draft 类型',
            );
        if (
            ts.isVariableDeclaration(node) &&
            node.initializer &&
            ts.isNewExpression(node.initializer) &&
            node.initializer.expression.getText(parsed) === 'Map' &&
            node.initializer.typeArguments?.some(type =>
                /\b(?:Product|Order|ActiveCustomer|StorefrontConfig|ImageStudioCacheEntry|ImageStudioSnapshot|ImageStudioWallet)\b/u.test(
                    type.getText(parsed),
                ),
            )
        ) {
            let moduleOwner = node.parent;
            while (moduleOwner && !ts.isSourceFile(moduleOwner) && !ts.isFunctionLike(moduleOwner))
                moduleOwner = moduleOwner.parent;
            if (moduleOwner && ts.isSourceFile(moduleOwner))
                violations.push(
                    '模块级业务数据不得另建 Map 缓存；使用根 QueryClient，草稿与显示元数据单独管理',
                );
        }
        if (
            ts.isCallExpression(node) &&
            /^(?:(?:window|globalThis)\.)?setInterval$/u.test(node.expression.getText(parsed)) &&
            !reloadOwners.has(file) &&
            !['public-refresh-scheduler.ts', 'storefront-traffic-observer.ts'].includes(file) &&
            readsServer(node.arguments[0])
        )
            violations.push('业务轮询不得另建定时器；使用公共 Query 的 refetchInterval 和活动状态');
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

export function interactionSources() {
    return files(sourceRoot).map(file => ({
        file: path.relative(sourceRoot, file).split(path.sep).join('/'),
        source: readFileSync(file, 'utf8'),
    }));
}

export function auditInteractionStandard() {
    return [
        ...interactionSources().flatMap(({ file, source }) => checkInteractionSource(file, source)),
        ...auditInteractionRoutes(),
    ];
}

export function auditInteractionRoutes() {
    const router = ts.createSourceFile(
        'storefront-router.ts',
        readFileSync(path.join(sourceRoot, 'storefront-router.ts'), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    );
    const bindings = moduleBindings(router);
    const expand = (expression, seen = new Set()) => {
        const node = unwrap(expression);
        if (node && ts.isStringLiteral(node)) return [node.text];
        if (node && ts.isArrayLiteralExpression(node))
            return node.elements.flatMap(item =>
                expand(ts.isSpreadElement(item) ? item.expression : item, new Set(seen)),
            );
        if (node && ts.isIdentifier(node) && !seen.has(node.text)) {
            seen.add(node.text);
            return expand(bindings.get(node.text), seen);
        }
        throw new Error('路由注册须保持可解析的静态名称与数组展开，不能绕过路由准入检查');
    };
    const familyFile = ts.createSourceFile(
        'desktop-page-contract.ts',
        readFileSync(path.join(sourceRoot, 'desktop-page-contract.ts'), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    );
    const familyObject = moduleBindings(familyFile).get('desktopPageFamilyByRoute');
    if (!familyObject || !ts.isObjectLiteralExpression(familyObject))
        throw new Error('无法核对页面分类所有者');
    const families = familyObject.properties.map(property =>
        property.name?.getText(familyFile).replace(/["']/gu, ''),
    );
    const routeFiles = files(path.join(sourceRoot, 'routes')).map(file =>
        path.relative(path.join(sourceRoot, 'routes'), file).split(path.sep).join('/'),
    );
    return checkRouteAdmission(expand(bindings.get('storefrontRouteNames')), families, routeFiles);
}

export function checkRouteAdmission(routeNames, familyNames, routeFiles) {
    const problems = [];
    if (new Set(routeNames).size !== routeNames.length) problems.push('路由注册存在重复名称');
    // TanStack file paths differ from semantic route names for nested content.
    // These exact aliases still require both registration and a page family.
    const contentRouteFiles = {
        guide: 'guides.$slug',
        blog: 'blog.index',
        'blog-article': 'blog.$slug',
    };
    const expected = new Set([
        '__root.tsx',
        'index.tsx',
        ...routeNames.map(name => `${contentRouteFiles[name] ?? name}.tsx`),
    ]);
    for (const file of routeFiles)
        if (!expected.has(file)) problems.push(`routes/${file}: 新路由未接入 storefrontRouteNames 与页面族`);
    for (const file of expected)
        if (!routeFiles.includes(file)) problems.push(`routes/${file}: 已注册路由缺少文件入口`);
    for (const name of routeNames)
        if (!familyNames.includes(name)) problems.push(`${name}: 路由缺少 desktopPageFamilyByRoute 分类`);
    for (const name of familyNames)
        if (!routeNames.includes(name)) problems.push(`${name}: 页面分类没有对应路由注册`);
    return problems;
}

export function assertInteractionStandard(violations = auditInteractionStandard()) {
    if (violations.length) throw new Error(violations.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        assertInteractionStandard();
        process.stdout.write('Storefront interaction standard passed\n');
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
