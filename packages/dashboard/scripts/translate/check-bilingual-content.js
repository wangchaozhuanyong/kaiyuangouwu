#!/usr/bin/env node
/* global process */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { looksTrivial, parsePOFile } from './locale-profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localeDir = path.resolve(__dirname, '../../src/i18n/locales');
const enEntries = parsePOFile(path.join(localeDir, 'en.po'));
const zhEntries = parsePOFile(path.join(localeDir, 'zh_Hans.po'));
const enIds = new Set(enEntries.map(entry => entry.id));
const zhIds = new Set(zhEntries.map(entry => entry.id));

const missingInChinese = enEntries.filter(entry => !zhIds.has(entry.id));
const missingInEnglish = zhEntries.filter(entry => !enIds.has(entry.id));
const emptyEnglish = enEntries.filter(entry => !entry.msgstr);
const emptyChinese = zhEntries.filter(entry => !entry.msgstr);
const chineseAllowlist = new Set(['SKU:', '{buttonText}', '{operator}', '{title}', '{label}']);
const nonChineseContent = zhEntries.filter(
    entry =>
        !looksTrivial(entry.msgstr) &&
        !/[\u4e00-\u9fff]/u.test(entry.msgstr) &&
        !chineseAllowlist.has(entry.msgstr),
);
const explicitIdPattern = /^(nav|fieldName|fulfillmentState|orderState|paymentState|refundReason)\./u;
const unresolvedMessageIds = [...enEntries, ...zhEntries].filter(
    entry => explicitIdPattern.test(entry.msgid) && entry.msgstr === entry.msgid,
);
const getArgumentNames = value =>
    [...new Set([...value.matchAll(/\{([A-Za-z_][\w.]*)(?=[,}])/gu)].map(match => match[1]))].sort();
const hasMatchingArguments = entry => {
    const sourceArguments = getArgumentNames(entry.msgid);
    const translatedArguments = getArgumentNames(entry.msgstr);
    return sourceArguments.join('\0') === translatedArguments.join('\0');
};
const invalidEnglishArguments = enEntries.filter(entry => !hasMatchingArguments(entry));
const invalidChineseArguments = zhEntries.filter(entry => !hasMatchingArguments(entry));

const issues = [
    ...missingInChinese.map(entry => `Chinese catalog is missing: ${entry.msgid}`),
    ...missingInEnglish.map(entry => `English catalog is missing: ${entry.msgid}`),
    ...emptyEnglish.map(entry => `English translation is empty: ${entry.msgid}`),
    ...emptyChinese.map(entry => `Chinese translation is empty: ${entry.msgid}`),
    ...nonChineseContent.map(entry => `Chinese UI still contains untranslated content: ${entry.msgid}`),
    ...unresolvedMessageIds.map(entry => `Internal message id is shown to users: ${entry.msgid}`),
    ...invalidEnglishArguments.map(entry => `English ICU arguments do not match source: ${entry.msgid}`),
    ...invalidChineseArguments.map(entry => `Chinese ICU arguments do not match source: ${entry.msgid}`),
];

if (issues.length > 0) {
    console.error(`Found ${issues.length} bilingual content issues:`);
    for (const issue of issues.slice(0, 50)) console.error(`- ${issue}`);
    if (issues.length > 50) console.error(`...and ${issues.length - 50} more.`);
    process.exit(1);
}

console.log(
    `Bilingual content check passed (${enEntries.length} English / ${zhEntries.length} Chinese messages).`,
);
