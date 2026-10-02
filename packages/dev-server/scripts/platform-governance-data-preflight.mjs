import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { collectPlatformCatalogDataPlan } from './platform-catalog-data-plan.mjs';
import { collectPlatformPaymentDataPlan } from './platform-payment-data-plan.mjs';
import { createStoreIsolationAdapter, safeReadOnlyAuditFailure } from './store-isolation-data-preflight.mjs';

// Both collectors have fixed ID/state column lists. No arbitrary SQL, mappings or write mode is accepted.
export async function collectPlatformGovernanceDataPreflight(adapter) {
    const catalog = await collectPlatformCatalogDataPlan(adapter);
    const payment = await collectPlatformPaymentDataPlan(adapter);
    const plan = {
        schema: 'vendure-platform-governance-production-preflight-v1',
        mode: 'READ_ONLY',
        productionApply: false,
        catalog,
        payment,
    };
    const bytes = Buffer.from(JSON.stringify(plan));
    const compressed = gzipSync(bytes).toString('base64');
    if (compressed.length > 18000) throw new Error('SAFE_PLAN_EXCEEDS_TRANSPORT_LIMIT');
    return {
        schema: plan.schema,
        mode: plan.mode,
        productionApply: false,
        snapshotHash: createHash('sha256').update(bytes).digest('hex'),
        resourceCount: catalog.resources.length,
        unresolvedResourceCount: catalog.resources.filter(resource => !resource.proposedOwnerChannelId)
            .length,
        paymentMethodCount: payment.entries.length,
        enabledStoreSwitchCount: payment.switches.filter(state => state.enabled).length,
        compressedPlan: compressed,
    };
}

async function main() {
    if (process.argv.length !== 2) throw new Error('NO_ARGUMENTS_ALLOWED');
    const adapter = await createStoreIsolationAdapter(process.env);
    try {
        process.stdout.write(`${JSON.stringify(await collectPlatformGovernanceDataPreflight(adapter))}\n`);
    } finally {
        await adapter.close();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        process.stderr.write(`${safeReadOnlyAuditFailure(error)}\n`);
        process.exitCode = 1;
    });
}
