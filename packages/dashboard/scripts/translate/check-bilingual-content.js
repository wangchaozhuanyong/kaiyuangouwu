#!/usr/bin/env node
/* global process */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { getIcuArgumentNames, looksTrivial, parsePOFile } from './locale-profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localeDir = path.resolve(__dirname, '../../src/i18n/locales');
const workspaceRoot = path.resolve(__dirname, '../../../..');
const operationsDashboardRoot = path.join(
    workspaceRoot,
    'packages/operations-dashboard-plugin/src/dashboard',
);
const operationsLocaleDir = path.join(operationsDashboardRoot, 'i18n');
const enEntries = parsePOFile(path.join(localeDir, 'en.po'));
const zhEntries = parsePOFile(path.join(localeDir, 'zh_Hans.po'));
const enIds = new Set(enEntries.map(entry => entry.id));
const zhIds = new Set(zhEntries.map(entry => entry.id));

const missingInChinese = enEntries.filter(entry => !zhIds.has(entry.id));
const missingInEnglish = zhEntries.filter(entry => !enIds.has(entry.id));
const emptyEnglish = enEntries.filter(entry => !entry.msgstr);
const emptyChinese = zhEntries.filter(entry => !entry.msgstr);
const chineseInEnglishContent = enEntries.filter(entry => /[\u4e00-\u9fff]/u.test(entry.msgstr));
const chineseAllowlist = new Set(['SKU:', '{buttonText}', '{operator}', '{title}', '{label}']);
const nonChineseContent = zhEntries.filter(
    entry =>
        !looksTrivial(entry.msgstr) &&
        !/[\u4e00-\u9fff]/u.test(entry.msgstr) &&
        !chineseAllowlist.has(entry.msgstr),
);
const explicitIdPattern =
    /^(nav|entity|fieldName|jobQueue|scheduledTask|settingsStore|fulfillmentState|orderState|paymentState|refundReason)\./u;
const unresolvedMessageIds = [...enEntries, ...zhEntries].filter(
    entry => explicitIdPattern.test(entry.msgid) && entry.msgstr === entry.msgid,
);
const hasMatchingArguments = entry => {
    const sourceArguments = getIcuArgumentNames(entry.msgid);
    const translatedArguments = getIcuArgumentNames(entry.msgstr);
    return sourceArguments.join('\0') === translatedArguments.join('\0');
};
const invalidEnglishArguments = enEntries.filter(entry => !hasMatchingArguments(entry));
const invalidChineseArguments = zhEntries.filter(entry => !hasMatchingArguments(entry));

function collectTypeScriptFiles(root) {
    return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
        const filePath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            return entry.name === 'i18n' ? [] : collectTypeScriptFiles(filePath);
        }
        return /\.[jt]sx?$/u.test(entry.name) && !/\.(spec|test)\.[jt]sx?$/u.test(entry.name)
            ? [filePath]
            : [];
    });
}

function collectExplicitMessageIds(root) {
    const ids = new Set();
    for (const filePath of collectTypeScriptFiles(root)) {
        const sourceText = fs.readFileSync(filePath, 'utf8');
        const sourceFile = ts.createSourceFile(
            filePath,
            sourceText,
            ts.ScriptTarget.Latest,
            true,
            filePath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        function visit(node) {
            if (
                ts.isPropertyAssignment(node) &&
                ((ts.isIdentifier(node.name) && node.name.text === 'id') ||
                    (ts.isStringLiteral(node.name) && node.name.text === 'id')) &&
                ts.isStringLiteral(node.initializer) &&
                node.initializer.text.startsWith('operations.')
            ) {
                ids.add(node.initializer.text);
            }
            ts.forEachChild(node, visit);
        }
        visit(sourceFile);
    }
    return ids;
}

function checkCatalogPair(label, englishFile, chineseFile, sourceMessageIds = new Set()) {
    const englishEntries = parsePOFile(englishFile);
    const chineseEntries = parsePOFile(chineseFile);
    const englishById = new Map(englishEntries.map(entry => [entry.msgid, entry]));
    const chineseById = new Map(chineseEntries.map(entry => [entry.msgid, entry]));
    const catalogIssues = [];

    for (const id of new Set([...englishById.keys(), ...chineseById.keys(), ...sourceMessageIds])) {
        const english = englishById.get(id);
        const chinese = chineseById.get(id);
        if (!english) catalogIssues.push(`${label} English catalog is missing: ${id}`);
        if (!chinese) catalogIssues.push(`${label} Chinese catalog is missing: ${id}`);
        if (!english || !chinese) continue;
        if (!english.msgstr) catalogIssues.push(`${label} English translation is empty: ${id}`);
        if (!chinese.msgstr) catalogIssues.push(`${label} Chinese translation is empty: ${id}`);
        if (/[一-鿿]/u.test(english.msgstr)) {
            catalogIssues.push(`${label} English translation contains Chinese text: ${id}`);
        }
        if (
            !looksTrivial(chinese.msgstr) &&
            !/[一-鿿]/u.test(chinese.msgstr) &&
            !chineseAllowlist.has(chinese.msgstr)
        ) {
            catalogIssues.push(`${label} Chinese translation is not localized: ${id}`);
        }
        if (
            getIcuArgumentNames(english.msgstr).join('\0') !== getIcuArgumentNames(chinese.msgstr).join('\0')
        ) {
            catalogIssues.push(`${label} ICU arguments do not match: ${id}`);
        }
    }
    return catalogIssues;
}

const operationsSourceMessageIds = collectExplicitMessageIds(operationsDashboardRoot);
const operationsIssues = checkCatalogPair(
    'Operations plugin',
    path.join(operationsLocaleDir, 'en.po'),
    path.join(operationsLocaleDir, 'zh_Hans.po'),
    operationsSourceMessageIds,
);

const issues = [
    ...missingInChinese.map(entry => `Chinese catalog is missing: ${entry.msgid}`),
    ...missingInEnglish.map(entry => `English catalog is missing: ${entry.msgid}`),
    ...emptyEnglish.map(entry => `English translation is empty: ${entry.msgid}`),
    ...emptyChinese.map(entry => `Chinese translation is empty: ${entry.msgid}`),
    ...chineseInEnglishContent.map(entry => `English UI contains Chinese content: ${entry.msgid}`),
    ...nonChineseContent.map(entry => `Chinese UI still contains untranslated content: ${entry.msgid}`),
    ...unresolvedMessageIds.map(entry => `Internal message id is shown to users: ${entry.msgid}`),
    ...invalidEnglishArguments.map(entry => `English ICU arguments do not match source: ${entry.msgid}`),
    ...invalidChineseArguments.map(entry => `Chinese ICU arguments do not match source: ${entry.msgid}`),
    ...operationsIssues,
];

if (issues.length > 0) {
    console.error(`Found ${issues.length} bilingual content issues:`);
    for (const issue of issues.slice(0, 50)) console.error(`- ${issue}`);
    if (issues.length > 50) console.error(`...and ${issues.length - 50} more.`);
    process.exit(1);
}

console.log(
    `Bilingual content check passed (${enEntries.length} dashboard messages / ${operationsSourceMessageIds.size} operations-plugin messages).`,
);
