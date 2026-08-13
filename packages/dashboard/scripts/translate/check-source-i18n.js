#!/usr/bin/env node
/* global process */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(__dirname, '../..');
const workspaceRoot = path.resolve(dashboardRoot, '../..');
const sourceRoots = [
    path.join(dashboardRoot, 'src'),
    path.join(workspaceRoot, 'packages/operations-dashboard-plugin/src/dashboard'),
];
const ignoredPathParts = ['/graphql/', '/generated/', '/__generated__/', '/node_modules/', '/dist/'];
const ignoredFilePatterns = [/\.(spec|test|stories)\.[cm]?[jt]sx?$/u, /\.d\.ts$/u];
const visibleAttributes = new Set(['aria-label', 'alt', 'placeholder', 'title']);
const visibleProperties = new Set(['description', 'label', 'message', 'placeholder', 'title']);
const technicalLiterals = new Set([
    'API',
    'GraphQL',
    'ID',
    'ID:',
    'JSON',
    'SKU',
    'SKU:',
    'URL',
    'Vendure',
    'auto',
    'blockId',
    'column',
    'href',
    'identifier',
    'itemId',
    'locationId',
    'order',
    'pageId',
    'v',
    'x',
]);
const helpContentFile = path.join(
    workspaceRoot,
    'packages/dashboard/src/lib/components/help/help-content.ts',
);

function collectFiles(root) {
    if (!fs.existsSync(root)) return [];
    const files = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const absolutePath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectFiles(absolutePath));
        } else if (/\.[cm]?[jt]sx?$/u.test(entry.name)) {
            files.push(absolutePath);
        }
    }
    return files;
}

function shouldInspect(filePath) {
    const normalized = filePath.split(path.sep).join('/');
    return (
        !ignoredPathParts.some(part => normalized.includes(part)) &&
        !ignoredFilePatterns.some(pattern => pattern.test(normalized))
    );
}

function tagName(node) {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    return '';
}

function isInsideTranslation(node) {
    for (let current = node.parent; current; current = current.parent) {
        if (ts.isJsxElement(current) && tagName(current.openingElement.tagName) === 'Trans') {
            return true;
        }
        if (ts.isTaggedTemplateExpression(current) && ['t', 'msg'].includes(tagName(current.tag))) {
            return true;
        }
        if (ts.isCallExpression(current)) {
            const name = tagName(current.expression);
            if (name === 'msg' || name === '_' || name === 't') return true;
        }
        if (ts.isStatement(current)) break;
    }
    return false;
}

function isMeaningfulText(value) {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (!normalized || !/[A-Za-z\u4e00-\u9fff]/u.test(normalized)) return false;
    if (technicalLiterals.has(normalized)) return false;
    if (/^(?:https?:\/\/|mailto:|tel:)/u.test(normalized)) return false;
    return true;
}

function propertyName(node) {
    const name = node.name;
    return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : '';
}

function isPairedHelpTranslation(filePath, node) {
    if (filePath !== helpContentFile || !node.parent || !ts.isCallExpression(node.parent)) return false;
    const call = node.parent;
    if (!ts.isIdentifier(call.expression) || call.expression.text !== 'text' || call.arguments[0] !== node) {
        return false;
    }
    const english = call.arguments[1];
    return (
        !!english &&
        (ts.isStringLiteral(english) || ts.isNoSubstitutionTemplateLiteral(english)) &&
        /[A-Za-z]/u.test(english.text) &&
        !/[\u4e00-\u9fff]/u.test(english.text)
    );
}

function hasIgnoreComment(sourceFile, node) {
    const fullText = sourceFile.getFullText();
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
    const previousLineStart = line > 0 ? sourceFile.getPositionOfLineAndCharacter(line - 1, 0) : 0;
    const text = fullText.slice(previousLineStart, node.getEnd());
    return /i18n-audit-ignore\s+--\s+\S/u.test(text.slice(0, node.getStart(sourceFile) - previousLineStart));
}

function addFinding(findings, sourceFile, node, kind, value) {
    if (hasIgnoreComment(sourceFile, node)) return;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({
        file: path.relative(workspaceRoot, sourceFile.fileName),
        line: line + 1,
        column: character + 1,
        kind,
        value: value.replace(/\s+/gu, ' ').trim(),
    });
}

function inspectFile(filePath) {
    const sourceText = fs.readFileSync(filePath, 'utf8');
    const scriptKind = filePath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
    const findings = [];

    function visit(node) {
        if (ts.isJsxText(node) && isMeaningfulText(node.text) && !isInsideTranslation(node)) {
            addFinding(findings, sourceFile, node, 'UNTRANSLATED_JSX_TEXT', node.text);
        }

        if (ts.isJsxAttribute(node) && visibleAttributes.has(node.name.text)) {
            if (node.initializer && ts.isStringLiteral(node.initializer)) {
                const value = node.initializer.text;
                if (isMeaningfulText(value)) {
                    addFinding(findings, sourceFile, node, 'UNTRANSLATED_JSX_ATTRIBUTE', value);
                }
            }
        }

        if (ts.isPropertyAssignment(node) && visibleProperties.has(propertyName(node))) {
            if (
                ts.isStringLiteral(node.initializer) ||
                ts.isNoSubstitutionTemplateLiteral(node.initializer)
            ) {
                const value = node.initializer.text;
                if (isMeaningfulText(value) && !isInsideTranslation(node.initializer)) {
                    addFinding(findings, sourceFile, node, 'UNTRANSLATED_VISIBLE_PROPERTY', value);
                }
            }
        }

        if (ts.isJsxElement(node) && tagName(node.openingElement.tagName) === 'Trans') {
            const expressions = node.children.filter(ts.isJsxExpression);
            const meaningfulText = node.children.some(
                child => ts.isJsxText(child) && /[A-Za-z\u4e00-\u9fff]/u.test(child.text),
            );
            if (expressions.length === 1 && !meaningfulText) {
                addFinding(
                    findings,
                    sourceFile,
                    node,
                    'DYNAMIC_TRANS_CANNOT_BE_EXTRACTED',
                    node.getText(sourceFile),
                );
            }
        }

        if (
            !isPairedHelpTranslation(filePath, node) &&
            (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
            /[\u4e00-\u9fff]/u.test(node.text) &&
            !isInsideTranslation(node)
        ) {
            addFinding(findings, sourceFile, node, 'UNDECLARED_CHINESE_SOURCE_TEXT', node.text);
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return findings;
}

const files = sourceRoots.flatMap(collectFiles).filter(shouldInspect).sort();
const findings = files.flatMap(inspectFile);

if (findings.length > 0) {
    console.error(`Found ${findings.length} source i18n issues:`);
    for (const finding of findings) {
        console.error(
            `${finding.file}:${finding.line}:${finding.column} ${finding.kind}: ${JSON.stringify(finding.value)}`,
        );
    }
    process.exit(1);
}

console.log(`Source i18n check passed (${files.length} production files).`);
