import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { customerDependencyFacts } from './store-isolation-customer-dependencies.mjs';

function inventoryRows(group, channels) {
    if (!group?.available) return null;
    assert.ok(Array.isArray(group.rows), 'Incomplete reference inventory');
    const seen = new Set();
    for (const row of group.rows) {
        assert.ok(
            typeof row.entityRef === 'string' && row.entityRef && !seen.has(row.entityRef),
            'Duplicate or missing entity reference',
        );
        seen.add(row.entityRef);
        if ('channelId' in row) assert.ok(channels.has(row.channelId), 'Unknown reference Channel');
        if ('channelIds' in row) {
            assert.ok(
                Array.isArray(row.channelIds) && new Set(row.channelIds).size === row.channelIds.length,
                'Duplicate reference Channel',
            );
            assert.ok(
                row.channelIds.every(id => channels.has(id)),
                'Unknown reference Channel',
            );
        }
    }
    return group.rows;
}

function walletReconciliation(relations, customerRef) {
    const wallets = relations.referral_wallet.filter(row => row.customerRef === customerRef);
    const accounts = relations.referral_account;
    const ledger = relations.referral_ledger_entry.filter(row => row.customerRef === customerRef);
    const issues = [];
    for (const wallet of wallets) {
        const account = accounts.find(row => row.entityRef === wallet.referralAccountRef);
        if (!account || account.channelId !== wallet.channelId || account.customerRef !== customerRef)
            issues.push('wallet-account-reference-mismatch');
        const entries = ledger.filter(row => row.walletRef === wallet.entityRef);
        for (const [balance, delta] of [
            ['availableBalance', 'availableDelta'],
            ['pendingBalance', 'pendingDelta'],
            ['reservedBalance', 'reservedDelta'],
        ]) {
            assert.ok(Number.isSafeInteger(wallet[balance]), 'Invalid wallet balance');
            let total = 0;
            for (const entry of entries) {
                assert.ok(Number.isSafeInteger(entry[delta]), 'Invalid ledger amount');
                total += entry[delta];
                assert.ok(Number.isSafeInteger(total), 'Unsafe ledger total');
            }
            if (total !== wallet[balance]) issues.push('wallet-ledger-reconciliation');
        }
    }
    for (const table of [
        'referral_ledger_entry',
        'referral_balance_use',
        'referral_wallet_usage',
        'referral_withdrawal',
    ]) {
        for (const row of relations[table].filter(
            item =>
                item.customerRef === customerRef ||
                wallets.some(wallet => wallet.entityRef === item.walletRef),
        )) {
            const wallet = wallets.find(item => item.entityRef === row.walletRef);
            if (
                !wallet ||
                row.customerRef !== customerRef ||
                wallet.channelId !== row.channelId ||
                wallet.currencyCode !== row.currencyCode
            )
                issues.push('wallet-reference-mismatch');
        }
    }
    return [...new Set(issues)];
}

// Planning only: this command has no database connection, apply option or deployment action.
export function buildMigrationPlan(preflight) {
    assert.equal(preflight.format, 1, 'Unsupported preflight');
    assert.equal(preflight.mode, 'read-only', 'A read-only preflight is required');
    assert.ok(
        Array.isArray(preflight.channels) && preflight.channels.length > 0,
        'Channel inventory missing',
    );
    const knownChannels = new Set(preflight.channels.map(channel => String(channel.id)));
    const evidence = preflight.ownershipEvidence;
    if (evidence) assert.equal(evidence.format, 1, 'Unsupported ownership evidence');
    const loginRows = inventoryRows(evidence?.customers?.login, knownChannels);
    const addressRows = inventoryRows(evidence?.customers?.addresses, knownChannels);
    const orderRows = inventoryRows(evidence?.customers?.orders, knownChannels);
    const relationNames = [
        'referral_account',
        'referral_wallet',
        'referral_ledger_entry',
        'referral_relationship',
        'referral_reward',
        'referral_balance_use',
        'referral_wallet_usage',
        'referral_withdrawal',
    ];
    const relations = Object.fromEntries(
        relationNames.map(name => [
            name,
            inventoryRows(evidence?.customers?.relations?.[name], knownChannels),
        ]),
    );
    const missing = [];
    const addMissing = (resource, entityRef, facts) => {
        if (facts.length) missing.push({ resource, entityRef, facts });
    };
    const shared = key => {
        const group = preflight.associations?.[key];
        if (!group?.available) {
            addMissing(key, null, ['relation-inventory']);
            return [];
        }
        assert.ok(
            Array.isArray(group.shared) && group.sharedCount === group.shared.length,
            'Incomplete shared inventory',
        );
        return group.shared;
    };
    const customers = shared('customers').map(customer => {
        const orderAssignments = (customer.orders ?? [])
            .map(order => {
                assert.ok(knownChannels.has(String(order.channelId)), 'Unknown order Channel');
                assert.ok(Number.isSafeInteger(order.count) && order.count >= 0, 'Invalid order count');
                return { channelId: String(order.channelId), orderCount: order.count };
            })
            .filter(order => order.orderCount > 0);
        const facts = [];
        const login = loginRows?.find(row => row.entityRef === customer.entityRef);
        if (!login || !('userRef' in login)) facts.push('login-user-links');
        else if (login.userRef != null) facts.push('one-to-one-login-split-strategy');
        const addresses = addressRows?.filter(row => row.customerRef === customer.entityRef);
        if (!addresses || addresses.length !== customer.addressCount || addresses.length > 0)
            facts.push('address-ownership');
        facts.push(
            ...customerDependencyFacts(
                evidence?.customers?.dependencies,
                customer,
                login,
                knownChannels,
                addresses,
            ),
        );
        if (relationNames.some(name => !relations[name])) facts.push('wallet-ledger', 'referral-links');
        else facts.push(...walletReconciliation(relations, customer.entityRef));
        const mappedOrders = orderRows?.filter(row => row.customerRef === customer.entityRef);
        if (!mappedOrders) facts.push('order-id-map');
        else {
            const counts = new Map();
            for (const order of mappedOrders) {
                if (order.channelIds.length !== 1) facts.push('ambiguous-order-channel');
                for (const id of order.channelIds) counts.set(id, (counts.get(id) ?? 0) + 1);
            }
            assert.ok(
                orderAssignments.every(item => counts.get(item.channelId) === item.orderCount) &&
                    counts.size === orderAssignments.length,
                'Order reference count mismatch',
            );
        }
        if (!orderAssignments.length) facts.push('registration-store-evidence');
        addMissing('customers', customer.entityRef, [...new Set(facts)]);
        return {
            entityRef: customer.entityRef,
            action: 'split-by-order-channel',
            orderAssignments,
            orderReferences: mappedOrders ?? null,
            loginUserRef: login?.userRef ?? null,
            addressCandidates:
                evidence?.customers?.dependencies?.addressMatches?.rows?.filter(
                    row => row.customerRef === customer.entityRef,
                ) ?? null,
            preserveHistoricalOrders: true,
            duplicateWalletBalance: false,
            missingFacts: [...new Set(facts)],
        };
    });
    const stockLocations = shared('stockLocations').map(location => {
        const buckets = location.variantBuckets;
        const facts = [];
        const levels = inventoryRows(evidence?.stock?.levels, knownChannels)?.filter(
            row => row.stockLocationRef === location.entityRef,
        );
        const movements = inventoryRows(evidence?.stock?.movements, knownChannels)?.filter(
            row => row.stockLocationRef === location.entityRef,
        );
        if (!levels || !movements) facts.push('stock-level-and-movement-id-map');
        else {
            assert.equal(levels.length, location.stockLevelCount, 'Stock level reference count mismatch');
            assert.equal(
                movements.length,
                location.stockMovementCount,
                'Stock movement reference count mismatch',
            );
            for (const row of [...levels, ...movements]) {
                for (const key of ['stockOnHand', 'stockAllocated', 'quantity'])
                    if (key in row) assert.ok(Number.isSafeInteger(row[key]), 'Invalid stock quantity');
            }
            if (
                movements.some(
                    row => row.orderLineRef != null && (!row.orderRef || row.channelIds.length !== 1),
                )
            )
                facts.push('ambiguous-movement-order');
        }
        if (!Array.isArray(buckets)) facts.push('stock-quantities-by-variant-channel');
        for (const bucket of buckets ?? []) {
            assert.ok(
                [bucket.stockOnHand, bucket.stockAllocated, bucket.variantCount].every(Number.isSafeInteger),
                'Invalid stock totals',
            );
            assert.ok(
                bucket.channelIds.every(id => knownChannels.has(String(id))),
                'Unknown stock Channel',
            );
            if (bucket.channelIds.length !== 1) facts.push('ambiguous-variant-allocation');
        }
        if (levels && Array.isArray(buckets)) {
            for (const key of ['stockOnHand', 'stockAllocated']) {
                const before = levels.reduce((sum, row) => sum + row[key], 0);
                const after = buckets.reduce((sum, row) => sum + row[key], 0);
                assert.ok(
                    Number.isSafeInteger(before) && Number.isSafeInteger(after) && before === after,
                    'Stock quantity conservation mismatch',
                );
            }
        }
        addMissing('stockLocations', location.entityRef, [...new Set(facts)]);
        return {
            entityRef: location.entityRef,
            action: 'move-stock-rows-without-duplication',
            currentBuckets: buckets ?? null,
            stockLevelReferences: levels ?? null,
            movementReferences: movements ?? null,
            preserveStockOnHand: true,
            preserveStockAllocated: true,
            preserveMovementHistory: true,
            missingFacts: [...new Set(facts)],
        };
    });
    const configuration = ['paymentMethods', 'shippingMethods'].flatMap(resource =>
        shared(resource).map(item => {
            const details = evidence?.configuration?.find(
                row => row.resource === resource && row.entityRef === item.entityRef,
            );
            const history = inventoryRows(details?.history, knownChannels);
            const facts = [];
            if (!/^[a-f0-9]{64}$/u.test(details?.configurationFingerprint ?? ''))
                facts.push('configuration-fingerprint');
            if (!history) facts.push('historical-order-reference-map');
            else if (history.some(row => !row.orderRef || row.channelIds.length !== 1))
                facts.push('ambiguous-historical-order-channel');
            addMissing(resource, item.entityRef, facts);
            return {
                resource,
                entityRef: item.entityRef,
                action: 'independent-config-per-channel',
                channels: item.channels,
                configurationFingerprint: details?.configurationFingerprint ?? null,
                historicalReferences: history,
                configurationCopyReviewRequired: true,
                preserveProcessorParameters: true,
                preserveHistoricalReferences: true,
                missingFacts: facts,
            };
        }),
    );
    for (const key of ['products', 'productVariants', 'collections', 'sellers']) {
        for (const item of shared(key)) addMissing(key, item.entityRef, ['review-shared-entity-ownership']);
    }
    const digital = preflight.digitalDelivery;
    if (!digital?.configured || !digital.exists)
        addMissing('digitalDelivery', null, ['digital-directory-inventory']);
    const digitalFiles = (digital?.legacyFiles ?? []).map(file => {
        const candidates = file.candidateChannelIds ?? file.suggestedChannelIds ?? [];
        const details = evidence?.digital?.find(item => item.fileRef === file.fileRef);
        const variants = inventoryRows(details?.variants, knownChannels);
        const lines = inventoryRows(details?.lines, knownChannels);
        const facts = [];
        if (!variants?.length || !lines) facts.push('product-and-order-reference-map');
        if (variants && lines) {
            assert.ok(
                lines.every(line => variants.some(variant => variant.entityRef === line.productVariantRef)),
                'Unknown digital product reference',
            );
            if (lines.some(line => line.channelIds.length !== 1 || !candidates.includes(line.channelIds[0])))
                facts.push('historical-delivery-channel-conflict');
        }
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\.(zip|pdf|txt|md)$/u.test(file.fileName ?? ''))
            facts.push('source-file-name');
        if (!/^[a-f0-9]{64}$/u.test(file.sha256 ?? '')) facts.push('source-file-sha256');
        if (candidates.length !== 1 || !knownChannels.has(String(candidates[0])))
            facts.push('file-channel-ownership');
        addMissing('digitalFiles', file.fileRef, facts);
        return {
            fileRef: file.fileRef,
            fileName: file.fileName ?? null,
            sha256: file.sha256 ?? null,
            candidateChannelIds: candidates,
            productReferences: variants,
            orderLineReferences: lines,
            action: 'copy-verify-then-switch-reading',
            retainLegacySource: true,
            missingFacts: facts,
        };
    });
    if (digital?.unsafeLegacyFileRefs?.length) addMissing('digitalFiles', null, ['unsafe-file-paths']);
    const icloudRows = (preflight.icloud ?? []).reduce((sum, table) => sum + table.totalRows, 0);
    assert.ok(Number.isSafeInteger(icloudRows) && icloudRows >= 0, 'Invalid iCloud inventory');
    return {
        format: 1,
        mode: 'plan-only',
        sourceGeneratedAt: preflight.generatedAt,
        requiresFreshPreflightBeforeExecution: true,
        readyForExecution: false,
        icloud: {
            policy: 'platform-shared',
            action: 'retain-existing-records-and-relations',
            rowCount: icloudRows,
            ownershipBlocker: false,
            preserveAccessProtection: true,
        },
        customers,
        stockLocations,
        configuration,
        digitalFiles,
        missingFacts: missing,
        executionOrder: [
            'fresh-read-only-inventory',
            'resolve-ownership-and-reference-maps',
            'isolated-restore-rehearsal',
            'backup',
            'copy-and-verify-files',
            'transactional-database-migration',
            'publish-reading-rules',
            'affected-access-acceptance',
        ],
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [input, output, ...extra] = process.argv.slice(2);
    assert.ok(
        input && output && !extra.length,
        'Usage: store-isolation-migration-plan.mjs <preflight.json> <plan.json>',
    );
    assert.ok(path.isAbsolute(input) && path.isAbsolute(output), 'Use absolute input/output paths');
    assert.notEqual(path.resolve(input), path.resolve(output), 'Preserve the source preflight');
    const plan = buildMigrationPlan(JSON.parse(await readFile(input, 'utf8')));
    await writeFile(output, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    process.stdout.write(
        JSON.stringify({
            mode: plan.mode,
            readyForExecution: false,
            icloudSharedRows: plan.icloud.rowCount,
            unresolvedResources: plan.missingFacts.length,
        }) + '\n',
    );
}
