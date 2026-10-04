/* eslint-disable no-console -- CLI diagnostics. */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import ts from 'typescript';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owner = 'src/styles/typography.css';
const sourceRoots = ['src', 'two-factor-tool', '../storefront-content-plugin/src/shared'];
const properties = new Map([
    ['font-size', 'fontSize'],
    ['line-height', 'lineHeight'],
    ['font-weight', 'fontWeight'],
    ['font-family', 'fontFamily'],
    ['letter-spacing', 'letterSpacing'],
    ['font', 'font'],
]);
const inlineProperties = new Map([...properties].map(([css, jsx]) => [jsx, css]));
const specialOwners = {
    artwork: ['src/styles/ai-product-covers.css'],
    watermark: ['src/tailwind/checkout-page-styles.ts'],
};

export function typeTokens(source) {
    const tokens = new Set();
    postcss.parse(source).walkDecls(d => {
        if (/^--(?:type-|font-|line-height-|tracking-)/.test(d.prop)) tokens.add(d.prop);
    });
    return tokens;
}

function allowedValue(property, value) {
    if (value === 'inherit') return true;
    if (property === 'font') return value === 'inherit';
    if (property === 'font-size') return /^var\(--type-[\w-]+-size\)$/.test(value);
    if (property === 'line-height')
        return /^(?:var\(--(?:type-[\w-]+-leading|line-height-[\w-]+)\)|normal)$/.test(value);
    if (property === 'font-weight')
        return /^var\(--font-weight-(?:normal|medium|semibold|bold)\)$/.test(value);
    if (property === 'font-family')
        return /^var\(--(?:font-(?:ui|numeric|code|display)|skin-display-font)(?:,\s*var\(--font-ui\))?\)$/.test(
            value,
        );
    if (property === 'letter-spacing') return /^var\(--tracking-[\w-]+\)$/.test(value);
    return true;
}

function targetsEditable(selector) {
    return selector
        ?.split(',')
        .some(part => /^(?:input|select|textarea)(?:$|[.:\[])/.test(part.trim().split(/\s+/).at(-1)));
}

/** Audit a source unit. Tests also pass synthetic future pages through this exact path. */
export function auditTypographySource(file, source, tokens) {
    const issues = [];
    const report = (line, reason) => issues.push({ file, line, reason });
    const checkReferences = (value, line) => {
        for (const match of value.matchAll(/--(?:type-|font-|line-height-|tracking-)[\w-]+/g)) {
            if (!tokens.has(match[0])) report(line, `Undefined typography token: ${match[0]}`);
            for (const [role, owners] of Object.entries(specialOwners)) {
                if (match[0].startsWith(`--type-${role}-`) && !owners.includes(file)) {
                    report(line, `Decorative ${role} role is restricted to ${owners.join(', ')}`);
                }
            }
        }
    };
    if (file === owner) {
        const minimums = { body: 14, label: 14, input: 16, helper: 13, meta: 12, 'navigation-compact': 12 };
        postcss.parse(source).walkDecls(d => {
            const role = d.prop.match(/^--type-([\w-]+)-size$/)?.[1];
            if (
                role in minimums &&
                (!/^\d+(?:\.\d+)?px$/.test(d.value) || parseFloat(d.value) < minimums[role])
            ) {
                report(d.source.start.line, `${role} must remain at least ${minimums[role]}px`);
            }
        });
        return issues;
    }
    if (file.endsWith('.css')) {
        const root = postcss.parse(source, { from: file });
        root.walkDecls(d => {
            const line = d.source.start.line;
            if (/^--(?:type-|font-|line-height-|tracking-)/.test(d.prop))
                report(line, `Typography tokens may only be declared in ${owner}`);
            if (properties.has(d.prop) && !allowedValue(d.prop, d.value)) {
                report(line, `Use a shared typography role for ${d.prop}: ${d.value}`);
            }
            if (d.prop === 'font' && targetsEditable(d.parent.selector) && file !== 'src/styles.css') {
                const size = d.parent.nodes.find(n => n.type === 'decl' && n.prop === 'font-size');
                if (size?.value !== 'var(--type-input-size)')
                    report(line, 'Control font reset must preserve the input role');
            }
            if (d.prop === 'font-size') {
                const role = d.value.match(/^var\(--type-([\w-]+)-size\)$/)?.[1];
                const targetsInput = targetsEditable(d.parent.selector);
                if (targetsInput && role !== 'input')
                    report(line, 'Editable controls must use the input role');
                const leading = d.parent.nodes
                    .filter(n => n.type === 'decl' && n.prop === 'line-height')
                    .at(-1);
                const expected =
                    role?.startsWith('price-') &&
                    ['price-symbol', 'price-integer', 'price-decimal'].includes(role)
                        ? 'var(--type-price-part-leading)'
                        : `var(--type-${role}-leading)`;
                if (role && leading?.value !== expected)
                    report(line, `Pair ${d.value} with line-height: ${expected}`);
            }
            checkReferences(d.value, line);
        });
        return issues;
    }
    const tree = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const lineAt = node => tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
    const inputRoleIssues = (value, line) => {
        const roles = [...value.matchAll(/(?:^|[\s:])type-([\w-]+)(?=$|\s)/g)];
        if (roles.some(match => match[1] !== 'input')) report(line, 'Editable controls must use type-input');
    };
    const visit = node => {
        if (
            ts.isVariableDeclaration(node) &&
            /inputClass$/i.test(node.name.getText(tree)) &&
            node.initializer &&
            ts.isStringLiteralLike(node.initializer)
        ) {
            inputRoleIssues(node.initializer.text, lineAt(node));
        }
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            if (['input', 'textarea', 'select'].includes(node.tagName.getText(tree))) {
                const attribute = node.attributes.properties.find(
                    a => ts.isJsxAttribute(a) && a.name.getText(tree) === 'className',
                );
                if (attribute?.initializer && ts.isStringLiteralLike(attribute.initializer))
                    inputRoleIssues(attribute.initializer.text, lineAt(node));
            }
        }
        if (
            ts.isStringLiteralLike(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node)
        ) {
            const text = node.text;
            const line = lineAt(node);
            checkReferences(text, line);
            const rawPatterns = [
                String.raw`text-(?:xs|sm|base|lg|xl|[2-9]xl)`,
                String.raw`text-\[(?:\d|clamp\(|calc\()[^\]]*\]`,
                String.raw`leading-(?:none|tight|snug|normal|relaxed|loose|\d[\w.]*|\[[\d.][^\]]*\])`,
                String.raw`tracking-(?:tighter|tight|normal|wide|wider|widest|\[[\d.-][^\]]*\])`,
                String.raw`font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black|mono|sans|serif|\[\d[^\]]*\])`,
            ];
            const rawUtilities = text.match(
                new RegExp(String.raw`(?:^|[\s:])(?:${rawPatterns.join('|')})(?=$|\s)`, 'g'),
            );
            if (rawUtilities)
                report(line, `Use type-* utilities or shared tokens: ${rawUtilities.join(', ')}`);
            for (const match of text.matchAll(/(?:^|[\s:])type-([\w-]+)(?=$|\s)/g)) {
                if (!tokens.has(`--type-${match[1]}-size`))
                    report(line, `Undefined type utility: type-${match[1]}`);
            }
            for (const match of text.matchAll(
                /\[(font-size|font-weight|line-height|font-family|letter-spacing|font):([^\]]+)\]/g,
            )) {
                if (!allowedValue(match[1], match[2].replaceAll('_', ' ')))
                    report(line, `Use a shared role for ${match[0]}`);
            }
            if (/\[--(?:type-|font-|line-height-|tracking-)/.test(text))
                report(line, 'Page utilities cannot redefine typography tokens');
        }
        if (ts.isPropertyAssignment(node)) {
            const name = node.name.getText(tree).replace(/^['"]|['"]$/g, '');
            if (/^--(?:type-|font-|line-height-|tracking-)/.test(name))
                report(lineAt(node), 'Inline styles cannot redefine typography tokens');
            const css = inlineProperties.get(name);
            // These are canvas poster export measurements, not DOM styles. Keep output geometry intact.
            const canvasMeasurement =
                file === 'src/referral-poster-layout.ts' &&
                name === 'lineHeight' &&
                ['x', 'y', 'size', 'width'].every(key =>
                    node.parent.properties.some(
                        p => ts.isPropertyAssignment(p) && p.name.getText(tree) === key,
                    ),
                );
            if (css && !canvasMeasurement) {
                const value = ts.isStringLiteralLike(node.initializer) ? node.initializer.text : null;
                const branches = ts.isConditionalExpression(node.initializer)
                    ? [node.initializer.whenTrue, node.initializer.whenFalse]
                    : [];
                if (
                    !(value && allowedValue(css, value)) &&
                    !(
                        branches.length &&
                        branches.every(b => ts.isStringLiteralLike(b) && allowedValue(css, b.text))
                    )
                ) {
                    report(lineAt(node), `Inline ${name} must consume shared tokens`);
                }
                if (css === 'font-size' && value) {
                    const role = value.match(/^var\(--type-([\w-]+)-size\)$/)?.[1];
                    const pair = node.parent.properties.find(
                        p => ts.isPropertyAssignment(p) && p.name.getText(tree) === 'lineHeight',
                    );
                    if (
                        role &&
                        (!pair ||
                            !ts.isStringLiteralLike(pair.initializer) ||
                            pair.initializer.text !== `var(--type-${role}-leading)`)
                    ) {
                        report(lineAt(node), `Inline ${name} needs its matching lineHeight role`);
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(tree);
    return issues;
}

export function auditStorefrontTypography(root = packageRoot) {
    const tokens = typeTokens(readFileSync(path.join(root, owner), 'utf8'));
    const files = [];
    const collect = directory => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) collect(file);
            else if (
                /\.(?:css|tsx?|jsx?)$/.test(file) &&
                !/\.(?:spec|test)\./.test(file) &&
                !file.endsWith('routeTree.gen.ts')
            )
                files.push(file);
        }
    };
    sourceRoots.forEach(directory => collect(path.resolve(root, directory)));
    const issues = files.flatMap(file =>
        auditTypographySource(
            path.relative(root, file).split(path.sep).join('/'),
            readFileSync(file, 'utf8'),
            tokens,
        ),
    );
    return { files: files.length, tokens: tokens.size, issues };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = auditStorefrontTypography();
    if (result.issues.length) {
        for (const issue of result.issues) console.error(`${issue.file}:${issue.line} ${issue.reason}`);
        console.error(
            `Typography check failed: ${result.issues.length} issue(s), ${result.files} source files scanned.`,
        );
        process.exitCode = 1;
    } else
        console.log(`Typography check passed: ${result.files} source files, ${result.tokens} shared tokens.`);
}
