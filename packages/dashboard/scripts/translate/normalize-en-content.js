#!/usr/bin/env node
/* global process */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getIcuArgumentNames, parsePOFile } from './locale-profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const poFile = path.resolve(__dirname, '../../src/i18n/locales/en.po');

// English follows the China-first product vocabulary instead of exposing
// framework-specific entity names that do not match the Chinese UI.
const exactTranslations = new Map([
    ['Assets', 'Asset library'],
    ['Channel', 'Sales channel'],
    ['Channels', 'Sales channels'],
    ['Collection', 'Product group'],
    ['Collections', 'Product groups'],
    ['Countries', 'Countries & regions'],
    ['Facet', 'Filter attribute'],
    ['Facets', 'Filter attributes'],
    ['Facet Values', 'Filter attribute values'],
    ['Facet values', 'Filter attribute values'],
    ['Job Queue', 'Background tasks'],
    ['New Channel', 'New sales channel'],
    ['New channel', 'New sales channel'],
    ['New Collection', 'New product group'],
    ['New collection', 'New product group'],
    ['New Facet', 'New filter attribute'],
    ['New facet', 'New filter attribute'],
    ['New facet value', 'New filter attribute value'],
    ['New product variant', 'New product SKU'],
    ['Product Variants', 'Product SKUs'],
    ['Product variants', 'Product SKUs'],
    ['Settings Store', 'System configuration'],
    ['Stock Locations', 'Warehouses & stock locations'],
    ['Variant', 'SKU'],
    ['Variants', 'SKUs'],
    ['Variant name', 'SKU name'],
    ['Zones', 'Business zones'],
]);

const explicitIdTranslations = new Map([
    ['entity.facetValues', 'Filter attribute values'],
    ['fieldName.attempts', 'Attempts'],
    ['fieldName.availableCurrencyCodes', 'Available currencies'],
    ['fieldName.availableLanguageCodes', 'Available content languages'],
    ['fieldName.breadcrumbs', 'Breadcrumbs'],
    ['fieldName.category', 'Category'],
    ['fieldName.channels', 'Sales channels'],
    ['fieldName.children', 'Child items'],
    ['fieldName.code', 'Code'],
    ['fieldName.couponCode', 'Coupon code'],
    ['fieldName.createdAt', 'Created'],
    ['fieldName.currencyCode', 'Currency'],
    ['fieldName.currentValue', 'Current value'],
    ['fieldName.customer', 'Customer'],
    ['fieldName.customerGroup', 'Customer group'],
    ['fieldName.customers', 'Customers'],
    ['fieldName.customFields', 'Custom fields'],
    ['fieldName.data', 'Data'],
    ['fieldName.defaultCurrencyCode', 'Default currency'],
    ['fieldName.defaultLanguageCode', 'Default content language'],
    ['fieldName.defaultShippingZone', 'Default shipping zone'],
    ['fieldName.defaultTaxZone', 'Default tax zone'],
    ['fieldName.description', 'Description'],
    ['fieldName.duration', 'Duration'],
    ['fieldName.emailAddress', 'Email address'],
    ['fieldName.enabled', 'Enabled'],
    ['fieldName.endsAt', 'End time'],
    ['fieldName.error', 'Error'],
    ['fieldName.featuredAsset', 'Primary asset'],
    ['fieldName.firstName', 'First name'],
    ['fieldName.fulfillmentHandlerCode', 'Fulfilment method'],
    ['fieldName.id', 'ID'],
    ['fieldName.isDefault', 'Default'],
    ['fieldName.isPrivate', 'Private'],
    ['fieldName.isSettled', 'Settled'],
    ['fieldName.isRunning', 'Running'],
    ['fieldName.lastName', 'Last name'],
    ['fieldName.lastExecutedAt', 'Last executed'],
    ['fieldName.lastResult', 'Last result'],
    ['fieldName.name', 'Name'],
    ['fieldName.orderPlacedAt', 'Order date'],
    ['fieldName.nextExecutionAt', 'Next execution'],
    ['fieldName.parentId', 'Parent'],
    ['fieldName.perCustomerUsageLimit', 'Per-customer usage limit'],
    ['fieldName.permissions', 'Permissions'],
    ['fieldName.position', 'Position'],
    ['fieldName.price', 'Price'],
    ['fieldName.pricesIncludeTax', 'Prices include tax'],
    ['fieldName.priceWithTax', 'Price including tax'],
    ['fieldName.productVariants', 'Product SKUs'],
    ['fieldName.progress', 'Progress'],
    ['fieldName.queueName', 'Queue name'],
    ['fieldName.result', 'Result'],
    ['fieldName.readonly', 'Readonly'],
    ['fieldName.retries', 'Retries'],
    ['fieldName.seller', 'Merchant'],
    ['fieldName.schedule', 'Schedule pattern'],
    ['fieldName.scheduleDescription', 'Schedule'],
    ['fieldName.settledAt', 'Settled at'],
    ['fieldName.shippingLines', 'Shipping lines'],
    ['fieldName.sku', 'SKU'],
    ['fieldName.slug', 'URL identifier'],
    ['fieldName.startedAt', 'Started at'],
    ['fieldName.startsAt', 'Start time'],
    ['fieldName.state', 'Status'],
    ['fieldName.scopeType', 'Effective scope'],
    ['fieldName.stockLevels', 'Stock levels'],
    ['fieldName.token', 'Token'],
    ['fieldName.total', 'Total'],
    ['fieldName.totalWithTax', 'Total including tax'],
    ['fieldName.type', 'Type'],
    ['fieldName.updatedAt', 'Updated'],
    ['fieldName.usageLimit', 'Usage limit'],
    ['fieldName.user', 'User'],
    ['fieldName.value', 'Value'],
    ['fieldName.valueList', 'Values'],
    ['fieldName.zone', 'Zone'],
    ['jobQueue.applyCollectionFilters', 'Update product group matches'],
    [
        'jobQueue.applyCollectionFilters.description',
        'Recalculates product group contents from their filter rules',
    ],
    ['jobQueue.cleanSessions', 'Clean expired sign-in sessions'],
    ['jobQueue.cleanSessions.description', 'Removes expired administrator and customer sign-in sessions'],
    ['jobQueue.custom', 'Custom background task'],
    ['jobQueue.custom.description', 'A background task registered by a plugin or business extension'],
    ['jobQueue.sendEmail', 'Send system email'],
    ['jobQueue.sendEmail.description', 'Sends order, account, and other notification emails'],
    ['jobQueue.updateSearchIndex', 'Update product search index'],
    ['jobQueue.updateSearchIndex.description', 'Synchronizes product search and filtering data'],
    ['scheduledTask.cleanSessions', 'Clean expired sign-in sessions'],
    [
        'scheduledTask.cleanSessions.description',
        'Removes expired administrator and customer sign-in sessions from the database',
    ],
    ['scheduledTask.cleanOrphanedSettingsStore', 'Clean invalid system configuration'],
    [
        'scheduledTask.cleanOrphanedSettingsStore.description',
        'Removes system configuration records whose field definitions no longer exist',
    ],
    ['scheduledTask.cleanJobs', 'Clean background task records'],
    [
        'scheduledTask.cleanJobs.description',
        'Removes completed, failed, and cancelled background task records from the database',
    ],
    ['scheduledTask.cleanJobQueueIndex', 'Clean background task index'],
    [
        'scheduledTask.cleanJobQueueIndex.description',
        'Cleans the index used to speed up background task list queries',
    ],
    ['scheduledTask.custom', 'Custom scheduled task'],
    [
        'scheduledTask.custom.description',
        'A scheduled background task registered by a plugin or business extension',
    ],
    ['settingsStore.pluginGlobalValue', 'Plugin global setting'],
    ['settingsStore.pluginUserValue', 'Plugin user setting'],
    ['settingsStore.buildVersion', 'System build version'],
    ['settingsStore.buildMetadata', 'System build information'],
    ['settingsStore.dashboardUserSettings', 'Dashboard user preferences'],
    ['settingsStore.globalSavedViews', 'Shared table views'],
    ['settingsStore.userSavedViews', 'Personal table views'],
    ['settingsStore.custom', 'Extension configuration'],
    ['fulfillmentState.Cancelled', 'Cancelled'],
    ['fulfillmentState.Created', 'Created'],
    ['fulfillmentState.Delivered', 'Delivered'],
    ['fulfillmentState.Pending', 'Pending'],
    ['fulfillmentState.Shipped', 'Shipped'],
    ['orderState.AddingItems', 'Adding items'],
    ['orderState.ArrangingAdditionalPayment', 'Awaiting additional payment'],
    ['orderState.ArrangingPayment', 'Awaiting payment'],
    ['orderState.Cancelled', 'Cancelled'],
    ['orderState.Created', 'Created'],
    ['orderState.Delivered', 'Delivered'],
    ['orderState.Draft', 'Draft'],
    ['orderState.Modifying', 'Modifying'],
    ['orderState.PartiallyDelivered', 'Partially delivered'],
    ['orderState.PartiallyShipped', 'Partially shipped'],
    ['orderState.PaymentAuthorized', 'Payment authorized'],
    ['orderState.PaymentSettled', 'Payment received'],
    ['orderState.Shipped', 'Shipped'],
    ['paymentState.Authorized', 'Authorized'],
    ['paymentState.Cancelled', 'Cancelled'],
    ['paymentState.Created', 'Created'],
    ['paymentState.Declined', 'Declined'],
    ['paymentState.Error', 'Error'],
    ['paymentState.Failed', 'Failed'],
    ['paymentState.Pending', 'Pending'],
    ['paymentState.Settled', 'Paid'],
    ['refundState.Failed', 'Failed'],
    ['refundState.Pending', 'Pending'],
    ['refundState.Settled', 'Settled'],
    ['refundReason.CustomerRequest', 'Customer request'],
    ['refundReason.DamagedInShipping', 'Damaged in transit'],
    ['refundReason.NotAvailable', 'Out of stock'],
    ['refundReason.Other', 'Other'],
    ['refundReason.WrongItem', 'Wrong item'],
]);

function normalizeTranslation(entry) {
    const explicit = explicitIdTranslations.get(entry.msgid);
    if (explicit !== undefined) return explicit;
    const exact = exactTranslations.get(entry.msgid);
    if (exact !== undefined) return exact;

    let value = entry.msgstr;
    const argumentNames = getIcuArgumentNames(entry.msgid);

    // Terminology changes apply only to visible copy. Protect ICU argument names
    // such as {collectionName}; changing those identifiers breaks catalog compilation.
    argumentNames.forEach((argumentName, index) => {
        value = value.replaceAll(`{${argumentName}`, `{__VDB_I18N_ARG_${index}__`);
    });
    if (/product variant|\bvariant/i.test(entry.msgid)) {
        value = value
            .replaceAll('Product Variants', 'Product SKUs')
            .replaceAll('Product variants', 'Product SKUs')
            .replaceAll('product variants', 'product SKUs')
            .replaceAll('Product Variant', 'Product SKU')
            .replaceAll('product variant', 'product SKU')
            .replaceAll('Variants', 'SKUs')
            .replaceAll('variants', 'SKUs')
            .replaceAll('Variant', 'SKU')
            .replaceAll('variant', 'SKU');
    }
    if (/facet/i.test(entry.msgid)) {
        value = value
            .replaceAll('Facet Values', 'Filter attribute values')
            .replaceAll('Facet values', 'Filter attribute values')
            .replaceAll('facet values', 'filter attribute values')
            .replaceAll('Facet Value', 'Filter attribute value')
            .replaceAll('facet value', 'filter attribute value')
            .replaceAll('Facets', 'Filter attributes')
            .replaceAll('facets', 'filter attributes')
            .replaceAll('Facet', 'Filter attribute')
            .replaceAll('facet', 'filter attribute');
    }
    if (/collection/i.test(entry.msgid)) {
        value = value
            .replaceAll('Collections', 'Product groups')
            .replaceAll('collections', 'product groups')
            .replaceAll('Collection', 'Product group')
            .replaceAll('collection', 'product group');
    }
    if (/seller/i.test(entry.msgid)) {
        value = value
            .replaceAll('Sellers', 'Merchants')
            .replaceAll('sellers', 'merchants')
            .replaceAll('Seller', 'Merchant')
            .replaceAll('seller', 'merchant');
    }
    if (/channel/i.test(entry.msgid)) {
        value = value
            .replaceAll('Channels', 'Sales channels')
            .replaceAll('channels', 'sales channels')
            .replaceAll('Channel', 'Sales channel')
            .replaceAll('channel', 'sales channel')
            .replaceAll('Sales sales channel', 'Sales channel')
            .replaceAll('sales sales channel', 'sales channel')
            .replace(/(?:sales\s+)+sales channels/gi, match =>
                /^[A-Z]/u.test(match) ? 'Sales channels' : 'sales channels',
            )
            .replace(/(?:sales\s+)+sales channel/gi, match =>
                /^[A-Z]/u.test(match) ? 'Sales channel' : 'sales channel',
            );
    }
    if (/\bjob/i.test(entry.msgid)) {
        value = value
            .replaceAll('Jobs', 'Tasks')
            .replaceAll('jobs', 'tasks')
            .replaceAll('Job', 'Task')
            .replaceAll('job', 'task');
    }

    argumentNames.forEach((argumentName, index) => {
        value = value.replaceAll(`{__VDB_I18N_ARG_${index}__`, `{${argumentName}`);
    });

    return value;
}

function getViolations(entries) {
    return entries.flatMap(entry => {
        if (!entry.msgstr) {
            return [{ entry, expected: entry.msgid, reason: 'empty translation' }];
        }
        const expected = normalizeTranslation(entry);
        if (entry.msgstr !== expected) {
            return [{ entry, expected, reason: 'terminology mismatch' }];
        }
        if (
            /^(nav|entity|fieldName|jobQueue|scheduledTask|settingsStore|fulfillmentState|orderState|paymentState|refundReason)\./u.test(
                entry.msgid,
            ) &&
            entry.msgstr === entry.msgid
        ) {
            return [{ entry, expected: entry.msgstr, reason: 'unresolved navigation id' }];
        }
        return [];
    });
}

function writeTranslations(violations) {
    const lines = fs.readFileSync(poFile, 'utf8').split('\n');

    for (const { entry, expected } of violations) {
        if (!expected || expected === entry.msgstr) continue;
        const lineIndex = entry.msgstrLine - 1;
        if (!lines[lineIndex]?.startsWith('msgstr ') || lines[lineIndex + 1]?.startsWith('"')) {
            throw new Error(`Cannot safely rewrite msgstr at line ${entry.msgstrLine}`);
        }
        lines[lineIndex] = `msgstr ${JSON.stringify(expected)}`;
    }

    fs.writeFileSync(poFile, lines.join('\n'), 'utf8');
}

const entries = parsePOFile(poFile);
const violations = getViolations(entries);
const shouldWrite = process.argv.includes('--write');

if (shouldWrite && violations.length > 0) {
    writeTranslations(violations);
    console.log(`Updated ${violations.length} English content translations.`);
    process.exit(0);
}

if (violations.length > 0) {
    console.error(`Found ${violations.length} English content issues:`);
    for (const { entry, expected, reason } of violations) {
        console.error(`- ${reason}: ${entry.msgid}`);
        if (expected !== entry.msgstr) {
            console.error(`  current: ${entry.msgstr}`);
            console.error(`  expected: ${expected}`);
        }
    }
    process.exit(1);
}

console.log(`English content check passed (${entries.length} messages).`);
