import assert from 'node:assert/strict';

import {
    compensationFingerprint,
    createLegacyCompensationExecutor,
    LEGACY_COMPENSATION_LINE_RISK_TABLES,
    LEGACY_COMPENSATION_RISK_TABLES,
} from './public-preview-legacy-compensation.mjs';

// One reviewed historical repair; this does not change storefront/runtime delivery policy.
export const LEGACY_DIGITAL_COMPENSATION_VERSION = 'public-preview-legacy-digital-compensation-v1';
export const LEGACY_DIGITAL_COMPENSATION_AUTHORIZATION = 'ORDER_37_TEST_ONLY_20261007';
export const LEGACY_DIGITAL_COMPENSATION_SCOPE = Object.freeze({
    orderId: '37',
    channelId: '5',
    orderLineId: '248',
    productVariantId: '1093',
    stockLocationId: '10',
    quantity: 1,
    couponId: '8',
});
const id = value => (value == null ? null : String(value));
const sort = rows => rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
const pick = (row, keys) =>
    Object.fromEntries(
        keys.map(key => [
            key,
            key.endsWith('At')
                ? row[key] == null
                    ? null
                    : new Date(row[key]).toISOString()
                : key === 'id' || key.endsWith('Id')
                  ? id(row[key])
                  : (row[key] ?? null),
        ]),
    );
const receiptKey = () => `${LEGACY_DIGITAL_COMPENSATION_VERSION}:37`;
const required = [
    'ProductVariant',
    'GlobalSettings',
    'ManualDigitalDelivery',
    'ManualDigitalDeliveryEvent',
    'DigitalVariantConfig',
    'DigitalOrderReservation',
    'DigitalReceiptAccess',
    'FulfillmentLine',
    'AdminNotificationDelivery',
    'AdminIncidentEvidence',
    'AdminIncidentAction',
];

export function validateLegacyDigitalReviewArtifact(artifact, entry, now = new Date()) {
    assert.equal(
        artifact?.version,
        'historical-test-digital-review-v1',
        'Independent digital review missing',
    );
    for (const [key, value] of Object.entries({
        orderId: '37',
        channelId: '5',
        deliveryId: entry.snapshot.digital.task.id,
        beforeFingerprint: entry.fingerprint,
        contentFingerprint: entry.snapshot.digital.task.contentFingerprint,
        contentClassification: 'TEST_ONLY',
        realResourceDisposition: 'NO_REAL_RESOURCE',
        attestationSource: 'HUMAN_USER_20261007',
    }))
        assert.equal(artifact[key], value, `Digital review ${key} mismatch`);
    assert.match(artifact.attestationDigest, /^[a-f0-9]{64}$/, 'Human attestation digest missing');
    assert.ok(
        ['NOT_VERIFIED', 'VERIFIED_TEST_ONLY'].includes(artifact.externalDeliveryOutcome),
        'Real or unknown resource disposition blocks digital repair',
    );
    const age = now.getTime() - new Date(artifact.reviewedAt).getTime();
    assert.ok(Number.isFinite(age) && age >= 0 && age <= 30 * 60_000, 'Digital review is stale');
    // NOT_VERIFIED is retained in the receipt. Test-only human classification does not assert
    // that external dispatch never happened; new success/claim/fulfillment evidence still blocks.
    return compensationFingerprint(artifact);
}

export function validateLegacyDigitalCompensationSnapshot(snapshot, now = new Date()) {
    const s = LEGACY_DIGITAL_COMPENSATION_SCOPE;
    assert.equal(snapshot?.order?.id, s.orderId, 'Digital repair exceeds reviewed order scope');
    assert.equal(snapshot.order.salesChannelId, s.channelId, 'Immutable sales Channel mismatch');
    assert.ok(
        ['PaymentSettled', 'Modifying'].includes(snapshot.order.state),
        'Unexpected historical order state',
    );
    assert.ok(
        snapshot.payments.length && snapshot.payments.some(p => p.state === 'Settled'),
        'Settled test payment missing',
    );
    for (const p of snapshot.payments) {
        assert.ok(['Authorized', 'Settled'].includes(p.state), 'Real or unknown payment state');
        assert.equal(p.method, 'controlled-test-payment-5', 'Native test method mismatch');
        assert.equal(p.serverMarkedTest, true, 'Persisted server test marker missing');
        assert.equal(p.manualReviewRequired, false, 'Payment needs review');
        assert.deepEqual(p.refunds, [], 'Refund evidence blocks historical repair');
    }
    assert.deepEqual(snapshot.fulfillments, [], 'Fulfillment blocks historical repair');
    assert.equal(snapshot.lines.length, 1, 'Additional order lines require review');
    const line = snapshot.lines[0];
    assert.equal(line.id, s.orderLineId, 'Reviewed digital line mismatch');
    assert.equal(line.productVariantId, s.productVariantId, 'Reviewed variant mismatch');
    assert.equal(line.quantity, s.quantity, 'Reviewed quantity mismatch');
    assert.equal(line.fulfillmentType, 'digital', 'Digital fulfillment classification missing');
    assert.equal(
        snapshot.digital.lineIdentity.fulfillmentTypeSnapshot,
        'digital',
        'Immutable digital sales identity missing',
    );
    assert.equal(
        snapshot.digital.lineIdentity.digitalDeliveryModeSnapshot,
        'manual_service',
        'Immutable manual delivery identity missing',
    );
    const {
        task,
        events,
        variant,
        globalSettings,
        configs,
        receiptAccess,
        reservations,
        incidents,
        actions,
    } = snapshot.digital;
    assert.equal(task.channelId, s.channelId, 'Delivery Channel mismatch');
    assert.equal(task.orderId, s.orderId, 'Delivery order mismatch');
    assert.equal(task.orderLineId, s.orderLineId, 'Delivery line mismatch');
    assert.equal(task.quantity, s.quantity, 'Delivery quantity mismatch');
    assert.ok(
        ['SENDING', 'EMAIL_FAILED', 'MANUAL_REVIEW'].includes(task.state),
        'Delivery is already sent/cancelled or unreconciled',
    );
    assert.equal(task.hasEncryptedPackages, true, 'Published content evidence missing');
    assert.equal(task.sentAt, null, 'Sent delivery blocks repair');
    assert.equal(task.fulfillmentId, null, 'Delivery fulfillment blocks repair');
    assert.ok(
        events.some(e => e.type === 'PUBLISHED'),
        'Published event evidence missing',
    );
    assert.ok(
        events.every(
            e =>
                e.deliveryId === task.id &&
                !['EMAIL_SENT', 'CONTENT_VIEWED', 'CANCELLED'].includes(e.type) &&
                !e.lateEvidence,
        ),
        'Success, access or late evidence blocks repair',
    );
    assert.deepEqual(receiptAccess, [], 'Receipt access blocks repair');
    assert.deepEqual(snapshot.digital.fulfillmentLines, [], 'Native fulfillment line blocks repair');
    assert.deepEqual(reservations, [], 'Digital reservations require separate resource review');
    assert.deepEqual(configs, [], 'Digital stock configuration requires separate resource review');
    assert.equal(variant.id, s.productVariantId, 'Tracking variant mismatch');
    assert.ok(
        globalSettings && typeof globalSettings.trackInventory === 'boolean',
        'Global tracking evidence missing',
    );
    assert.ok(
        variant.trackInventory === 'TRUE' ||
            (variant.trackInventory === 'INHERIT' && globalSettings.trackInventory),
        'Native effective tracking must be verified before decrementing allocation',
    );
    assert.equal(
        variant.digitalDeliveryMode,
        'manual_service',
        'Manual digital variant classification missing',
    );
    assert.equal(variant.fulfillmentType, 'digital', 'Current digital variant classification missing');
    assert.equal(variant.digitalStockPolicy, 'limited', 'Reviewed historical digital stock policy mismatch');
    const tables = new Set([...LEGACY_COMPENSATION_RISK_TABLES, ...LEGACY_COMPENSATION_LINE_RISK_TABLES]);
    for (const table of tables) {
        assert.ok(Array.isArray(snapshot.risks[table]), `Unverified risk table: ${table}`);
        if (table === 'manual_digital_delivery') {
            assert.deepEqual(
                snapshot.risks[table],
                [{ id: task.id, fingerprint: task.fingerprint }],
                'Additional or mismatched manual delivery',
            );
        } else assert.deepEqual(snapshot.risks[table], [], `Existing ${table} blocks repair`);
    }
    assert.ok(
        Array.isArray(snapshot.carts) && snapshot.carts.every(c => c.channelId === s.channelId),
        'Foreign or unverified Cart',
    );
    assert.equal(snapshot.movements.length, 1, 'Original allocation set changed');
    const movement = snapshot.movements[0];
    for (const [key, value] of Object.entries({
        type: 'ALLOCATION',
        orderLineId: s.orderLineId,
        productVariantId: s.productVariantId,
        stockLocationId: s.stockLocationId,
        quantity: s.quantity,
    }))
        assert.equal(movement[key], value, `Original allocation ${key} mismatch`);
    assert.equal(snapshot.locations.length, 1, 'Original location set changed');
    assert.equal(snapshot.locations[0].id, s.stockLocationId, 'Original warehouse mismatch');
    assert.ok(snapshot.locations[0].channelIds.includes(s.channelId), 'Original warehouse Channel mismatch');
    assert.equal(snapshot.stockLevels.length, 1, 'Original StockLevel set changed');
    const level = snapshot.stockLevels[0];
    assert.equal(level.productVariantId, s.productVariantId, 'StockLevel variant mismatch');
    assert.equal(level.stockLocationId, s.stockLocationId, 'StockLevel location mismatch');
    assert.ok(
        Number.isSafeInteger(level.stockAllocated) && level.stockAllocated >= s.quantity,
        'Insufficient original allocation',
    );
    assert.deepEqual(
        snapshot.coupons.map(c => c.id),
        [s.couponId],
        'Reviewed coupon set changed',
    );
    const coupon = snapshot.coupons[0];
    assert.equal(coupon.channelId, s.channelId, 'Coupon Channel mismatch');
    assert.equal(coupon.status, 'USED', 'Coupon is no longer USED');
    assert.equal(coupon.usedOrderId, s.orderId, 'Coupon owner mismatch');
    assert.ok(coupon.validUntil && new Date(coupon.validUntil) <= now, 'Coupon has not expired');
    assert.equal(coupon.revokedAt, null, 'Revoked coupon needs review');
    assert.ok(coupon.lockedOrderId == null || coupon.lockedOrderId === s.orderId, 'Foreign coupon lock');
    assert.equal(snapshot.allocations.length, 1, 'Coupon allocation is ambiguous');
    const allocation = snapshot.allocations[0];
    for (const [key, value] of Object.entries({
        customerCouponId: s.couponId,
        channelId: s.channelId,
        orderId: s.orderId,
        status: 'USED',
        refundId: null,
        refundedAmount: 0,
    }))
        assert.equal(allocation[key], value, `Coupon allocation ${key} mismatch`);
    assert.ok(
        snapshot.ledger.some(
            e => e.customerCouponId === s.couponId && e.orderId === s.orderId && e.eventType === 'REDEEMED',
        ),
        'Original REDEEMED ledger missing',
    );
    for (const incident of incidents) {
        assert.equal(incident.sourceType, 'ManualDigitalDelivery', 'Foreign incident source');
        assert.equal(incident.sourceId, task.id, 'Foreign incident owner');
        assert.equal(incident.payloadChannelId, s.channelId, 'Incident Channel mismatch');
        assert.equal(incident.payloadOrderId, s.orderId, 'Incident order mismatch');
        assert.equal(incident.payloadDeliveryId, task.id, 'Incident delivery mismatch');
        assert.equal(incident.mode, 'INCIDENT', 'Unreviewed notification mode');
        assert.notEqual(incident.incidentStatus, 'ACTION_PENDING', 'Unfinished incident workflow');
        assert.ok(
            [
                'commerce.fulfillment.manual_delivery_failed:' + task.id,
                'commerce.fulfillment.manual_delivery_overdue:' + task.id,
            ].includes(incident.incidentFingerprint),
            'Unreviewed delivery incident',
        );
        assert.notEqual(incident.deliveryStatus, 'CLAIMED', 'Claimed notification is in flight');
        assert.equal(incident.claimedAt, null, 'Notification transport claim must be resolved');
        assert.equal(incident.claimedBy, null, 'Notification transport owner must be resolved');
    }
    assert.ok(
        actions.every(a => a.status === 'COMPLETED'),
        'Unfinished corrective action blocks repair',
    );
    return [
        {
            orderLineId: s.orderLineId,
            productVariantId: s.productVariantId,
            stockLocationId: s.stockLocationId,
            quantity: s.quantity,
        },
    ];
}

export function createLegacyDigitalCompensationExecutor(providers) {
    const {
        connection,
        orders,
        carts,
        stockMovements,
        stockLocations,
        coupons,
        history,
        manualDelivery,
        incidents: incidentService,
        entities,
        superAdminPermission,
        isolatedTest = false,
        verifyProductionRuntimeProtections,
        verifyReviewedArtifact,
        clock = () => new Date(),
    } = providers;
    for (const key of required) assert.ok(entities?.[key], `Missing managed digital entity: ${key}`);
    assert.ok(
        manualDelivery?.closeHistoricalTestTask && incidentService?.closeHistoricalTestTaskIncidents,
        'Native historical close providers missing',
    );
    // Capture the original physical evidence without calling its physical-only repair validator.
    const base = createLegacyCompensationExecutor(providers);
    const repo = (ctx, key) => connection.getRepository(ctx, entities[key]);
    const meta = key => connection.rawConnection.getMetadata(entities[key]);
    const values = (row, metadata, exclude = []) =>
        Object.fromEntries(
            metadata.columns
                .filter(c => !exclude.includes(c.propertyPath))
                .map(c => [c.propertyPath, c.getEntityValue(row) ?? null]),
        );
    const hash = (row, key, exclude) => compensationFingerprint(values(row, meta(key), exclude));
    async function capture(ctx, orderId = '37') {
        assert.equal(id(orderId), '37', 'Digital repair exceeds reviewed order scope');
        assert.equal(id(ctx.channelId), '5', 'Context Channel mismatch');
        const original = await base.capture(ctx, orderId);
        const tasks = await repo(ctx, 'ManualDigitalDelivery').find({
            where: [{ orderId }, { orderLineId: '248' }],
        });
        assert.equal(tasks.length, 1, 'Exactly one correlated manual task is required');
        const task = tasks[0];
        const events = await repo(ctx, 'ManualDigitalDeliveryEvent').find({ where: { deliveryId: task.id } });
        const variant = await repo(ctx, 'ProductVariant').findOne({
            where: { id: '1093' },
            relations: { product: true },
        });
        assert.ok(variant, 'Reviewed ProductVariant missing');
        const ownedLine = await repo(ctx, 'OrderLine').findOne({ where: { id: '248' } });
        assert.ok(ownedLine, 'Reviewed OrderLine missing');
        const settings = await repo(ctx, 'GlobalSettings').find();
        assert.equal(settings.length, 1, 'Global tracking is ambiguous');
        const configs = await repo(ctx, 'DigitalVariantConfig').find({ where: { productVariantId: '1093' } });
        const reservations = await repo(ctx, 'DigitalOrderReservation').find({
            where: [{ orderId }, { orderLineId: '248' }],
        });
        const receiptAccess = await repo(ctx, 'DigitalReceiptAccess').find({
            where: [{ orderId }, { orderLineId: '248' }],
        });
        const incidentRows = await repo(ctx, 'AdminNotificationDelivery').find({
            where: [
                { sourceType: 'ManualDigitalDelivery', sourceId: id(task.id) },
                { fingerprint: `commerce.fulfillment.manual_delivery_failed:${task.id}` },
                { fingerprint: `commerce.fulfillment.manual_delivery_overdue:${task.id}` },
            ],
        });
        const evidence = [];
        const actions = [];
        for (const incident of incidentRows) {
            evidence.push(
                ...(await repo(ctx, 'AdminIncidentEvidence').find({ where: { incidentId: incident.id } })),
            );
            actions.push(
                ...(await repo(ctx, 'AdminIncidentAction').find({ where: { incidentId: incident.id } })),
            );
        }
        const digestRows = (rows, key) =>
            sort(rows.map(row => ({ id: id(row.id), fingerprint: hash(row, key) })));
        const immutableTask = ['state', 'updatedAt'];
        const mutableIncident = [
            'updatedAt',
            'incidentStatus',
            'closedAt',
            'resolvedAt',
            'eventState',
            'activeFingerprint',
            'actionRequired',
            'slaDueAt',
            'recoveryValidationDueAt',
            'reviewDueAt',
            'deliveryStatus',
            'payload',
        ];
        const snapshot = {
            ...original.snapshot,
            digital: {
                lineIdentity: {
                    fulfillmentTypeSnapshot: ownedLine.customFields?.fulfillmentTypeSnapshot ?? null,
                    digitalDeliveryModeSnapshot: ownedLine.customFields?.digitalDeliveryModeSnapshot ?? null,
                },
                task: {
                    ...pick(task, [
                        'id',
                        'channelId',
                        'orderId',
                        'orderLineId',
                        'quantity',
                        'state',
                        'createdAt',
                        'updatedAt',
                        'expectedAt',
                        'attemptCount',
                        'lastDispatchedAt',
                        'sentAt',
                        'fulfillmentId',
                    ]),
                    hasEncryptedPackages: Boolean(task.encryptedPackages),
                    contentFingerprint: compensationFingerprint({
                        encryptedPackages: task.encryptedPackages,
                        attachmentAssetIdsJson: task.attachmentAssetIdsJson,
                    }),
                    fingerprint: hash(task, 'ManualDigitalDelivery'),
                    immutableFingerprint: hash(task, 'ManualDigitalDelivery', immutableTask),
                },
                events: sort(
                    events.map(row => ({
                        ...pick(row, [
                            'id',
                            'deliveryId',
                            'type',
                            'actorType',
                            'actorId',
                            'createdAt',
                            'updatedAt',
                        ]),
                        noteFingerprint: compensationFingerprint(row.note),
                        fingerprint: hash(row, 'ManualDigitalDeliveryEvent'),
                        closingReceipt:
                            row.type === 'CANCELLED' && row.note === `历史测试任务终止；收据 ${receiptKey()}`,
                        lateEvidence: String(row.note ?? '').startsWith('[historical-test-late:'),
                    })),
                ),
                variant: {
                    id: id(variant.id),
                    trackInventory: variant.trackInventory,
                    digitalDeliveryMode: variant.customFields?.digitalDeliveryMode ?? null,
                    digitalStockPolicy: variant.customFields?.digitalStockPolicy ?? null,
                    fulfillmentType:
                        variant.customFields?.fulfillmentType ??
                        variant.product?.customFields?.fulfillmentType ??
                        null,
                    fingerprint: hash(variant, 'ProductVariant'),
                },
                globalSettings: {
                    id: id(settings[0].id),
                    trackInventory: settings[0].trackInventory,
                    fingerprint: hash(settings[0], 'GlobalSettings'),
                },
                configs: digestRows(configs, 'DigitalVariantConfig'),
                reservations: digestRows(reservations, 'DigitalOrderReservation'),
                receiptAccess: digestRows(receiptAccess, 'DigitalReceiptAccess'),
                incidents: sort(
                    incidentRows.map(row => ({
                        ...pick(row, [
                            'id',
                            'sourceType',
                            'sourceId',
                            'eventType',
                            'mode',
                            'incidentStatus',
                            'eventState',
                            'deliveryStatus',
                            'claimedAt',
                            'claimedBy',
                            'closedAt',
                            'attempts',
                            'sentAt',
                        ]),
                        incidentFingerprint: row.fingerprint,
                        payloadChannelId: id(row.payload?.channelId),
                        payloadOrderId: id(row.payload?.orderId),
                        payloadDeliveryId: id(row.payload?.deliveryId),
                        originalPayloadFingerprint: compensationFingerprint(
                            Object.fromEntries(
                                Object.entries(row.payload ?? {}).filter(
                                    ([key]) =>
                                        !['historicalTestClosureKey', 'historicalTestOutcome'].includes(key),
                                ),
                            ),
                        ),
                        fingerprint: hash(row, 'AdminNotificationDelivery'),
                        immutableFingerprint: hash(row, 'AdminNotificationDelivery', mutableIncident),
                    })),
                ),
                evidence: sort(
                    evidence.map(row => ({
                        ...pick(row, [
                            'id',
                            'incidentId',
                            'eventType',
                            'actorType',
                            'actorUserId',
                            'occurredAt',
                        ]),
                        fingerprint: hash(row, 'AdminIncidentEvidence'),
                    })),
                ),
                actions: sort(
                    actions.map(row => ({
                        ...pick(row, ['id', 'incidentId', 'status', 'completedAt']),
                        fingerprint: hash(row, 'AdminIncidentAction'),
                    })),
                ),
            },
        };
        // Native fulfillment links can exist without appearing in order.fulfillments.
        const fulfillmentMeta = connection.rawConnection.getMetadata(entities.FulfillmentLine);
        const links = await connection
            .getRepository(ctx, fulfillmentMeta.target)
            .find({ where: { orderLineId: '248' } });
        snapshot.digital.fulfillmentLines = sort(
            links.map(row => ({
                id: id(row.id),
                fingerprint: compensationFingerprint(values(row, fulfillmentMeta)),
            })),
        );
        assert.deepEqual(snapshot.digital.fulfillmentLines, [], 'Native fulfillment line blocks repair');
        return { snapshot, fingerprint: compensationFingerprint(snapshot) };
    }
    async function lock(ctx, key, ids) {
        for (const rowId of [...new Set(ids)].sort()) {
            const row = await repo(ctx, key)
                .createQueryBuilder('row')
                .setLock('pessimistic_write')
                .where('row.id = :id', { id: rowId })
                .getOne();
            assert.ok(row, `Expected ${key} disappeared while locking`);
        }
    }
    const replayEvidence = snapshot => {
        const { stockLevels: _levels, ...owned } = snapshot;
        return owned;
    };
    async function execute(ctx, { manifest, reviewArtifact, apply = false }) {
        assert.equal(manifest?.version, LEGACY_DIGITAL_COMPENSATION_VERSION, 'Wrong digital repair version');
        assert.equal(
            manifest.authorization,
            LEGACY_DIGITAL_COMPENSATION_AUTHORIZATION,
            'Named digital authorization missing',
        );
        assert.match(manifest.sourceSnapshotSha256, /^[a-f0-9]{64}$/, 'Source snapshot digest missing');
        const age = clock().getTime() - new Date(manifest.capturedAt).getTime();
        assert.ok(Number.isFinite(age) && age >= 0 && age <= 30 * 60_000, 'Reviewed snapshot is stale');
        const expected = manifest.entry;
        assert.equal(
            expected?.fingerprint,
            compensationFingerprint(expected?.snapshot),
            'Digital snapshot digest mismatch',
        );
        assert.equal(id(ctx.channelId), '5', 'Context Channel mismatch');
        const reviewFingerprint = validateLegacyDigitalReviewArtifact(reviewArtifact, expected, clock());
        validateLegacyDigitalCompensationSnapshot(expected.snapshot, clock());
        if (!apply)
            return {
                status: 'PREVIEW_ONLY',
                orderId: '37',
                fingerprint: expected.fingerprint,
                reviewFingerprint,
            };
        assert.equal(ctx.apiType, 'admin', 'Managed admin context required');
        assert.ok(
            ctx.activeUserId && ctx.userHasPermissions([superAdminPermission]),
            'Authenticated native SuperAdmin required',
        );
        if (isolatedTest) {
            const options = connection.rawConnection.options;
            assert.ok(
                ['mysql', 'mariadb'].includes(options.type) &&
                    ['127.0.0.1', 'localhost', '::1'].includes(options.host),
                'Owned loopback native MySQL required',
            );
            assert.match(
                String(options.database),
                /^(?:order_closure|legacy_preview)_[a-f0-9]+$/,
                'Owned UUID test database required',
            );
        } else {
            const proof = await verifyProductionRuntimeProtections?.();
            assert.ok(
                proof?.status === 'VERIFIED' &&
                    /^[a-f0-9]{40}$/.test(proof.runtimeSha) &&
                    proof.runtimeSha === proof.releaseSha &&
                    !proof.runtimeSha.startsWith('a535b99d') &&
                    /^[a-f0-9]{64}$/.test(proof.protectionsFingerprint) &&
                    proof.sourceHashesVerified === true &&
                    proof.nativeFundingGuardsVerified === true &&
                    proof.testOrderDeliveryGuardsVerified === true &&
                    proof.historicalDigitalCloseoutGuardsVerified === true,
                'WAIT_REPAIR_DEPLOYMENT: actual installed native protections are not verified',
            );
            assert.equal(
                typeof verifyReviewedArtifact,
                'function',
                'Independent managed review verifier required',
            );
        }
        if (verifyReviewedArtifact)
            assert.equal(
                await verifyReviewedArtifact(reviewArtifact, expected),
                true,
                'Independent reviewed artifact verification rejected',
            );
        return orders.withOrderMutationTransaction(ctx, async txCtx => {
            await carts.lockForOrder(txCtx, '37');
            await orders.lockOrderForRefund(txCtx, '37');
            await lock(
                txCtx,
                'Payment',
                (await repo(txCtx, 'Payment').find({ where: { order: { id: '37' } } })).map(p => p.id),
            );
            await lock(txCtx, 'OrderLine', ['248']);
            await lock(txCtx, 'ManualDigitalDelivery', [expected.snapshot.digital.task.id]);
            await lock(
                txCtx,
                'ManualDigitalDeliveryEvent',
                expected.snapshot.digital.events.map(e => e.id),
            );
            await lock(txCtx, 'ProductVariant', ['1093']);
            await lock(txCtx, 'GlobalSettings', [expected.snapshot.digital.globalSettings.id]);
            await lock(
                txCtx,
                'AdminNotificationDelivery',
                expected.snapshot.digital.incidents.map(i => i.id),
            );
            await lock(
                txCtx,
                'AdminIncidentAction',
                expected.snapshot.digital.actions.map(a => a.id),
            );
            await lock(
                txCtx,
                'AdminIncidentEvidence',
                expected.snapshot.digital.evidence.map(e => e.id),
            );
            const coupon = await repo(txCtx, 'CustomerCoupon').findOne({ where: { id: '8' } });
            assert.ok(
                coupon && (coupon.lockedOrderId == null || id(coupon.lockedOrderId) === '37'),
                'Coupon moved to a foreign Cart',
            );
            await coupons.lockCouponForRepair(txCtx, '8');
            await lock(
                txCtx,
                'CouponOrderAllocation',
                expected.snapshot.allocations.map(a => a.id),
            );
            await lock(txCtx, 'StockLocation', ['10']);
            await lock(
                txCtx,
                'StockLevel',
                expected.snapshot.stockLevels.map(l => l.id),
            );
            const fresh = await capture(txCtx);
            const entries = await repo(txCtx, 'OrderHistoryEntry').find({
                where: { order: { id: '37' }, type: 'ORDER_NOTE' },
            });
            const receipts = entries.filter(e => e.data?.digitalCompensation?.key === receiptKey());
            assert.ok(receipts.length <= 1, 'Duplicate digital receipts require review');
            if (receipts.length) {
                const priorReceipt = receipts[0].data.digitalCompensation;
                assert.equal(
                    priorReceipt.beforeFingerprint,
                    expected.fingerprint,
                    'Different reviewed digital receipt',
                );
                assert.equal(
                    priorReceipt.reviewFingerprint,
                    reviewFingerprint,
                    'Different business attestation on replay',
                );
                assert.equal(
                    compensationFingerprint(replayEvidence(fresh.snapshot)),
                    priorReceipt.afterEvidenceFingerprint,
                    'Digital closeout evidence changed; reconcile before replay',
                );
                return {
                    ...priorReceipt,
                    status: 'ALREADY_APPLIED',
                    changedQuantity: 0,
                    correctedCoupons: 0,
                };
            }
            assert.equal(
                fresh.fingerprint,
                expected.fingerprint,
                'Persisted digital snapshot/version changed',
            );
            const releases = validateLegacyDigitalCompensationSnapshot(fresh.snapshot, clock());
            const line = await repo(txCtx, 'OrderLine').findOne({ where: { id: '248' } });
            const selected = await stockLocations.getReleaseLocations(txCtx, line, 1);
            assert.equal(selected.length, 1, 'Native release selected multiple locations');
            assert.equal(id(selected[0].location?.id), '10', 'Native release changed original warehouse');
            assert.equal(selected[0].quantity, 1, 'Native release changed quantity');
            await manualDelivery.closeHistoricalTestTask(txCtx, fresh.snapshot.digital.task.id, receiptKey());
            const closedIncidentIds = await incidentService.closeHistoricalTestTaskIncidents(txCtx, {
                orderId: '37',
                deliveryId: fresh.snapshot.digital.task.id,
                receiptId: receiptKey(),
            });
            const movements = await stockMovements.createReleasesForOrderLines(
                txCtx,
                releases.map(r => ({ orderLineId: r.orderLineId, quantity: r.quantity })),
            );
            assert.equal(movements.length, 1, 'Native release count mismatch');
            assert.equal(movements[0].type, 'RELEASE', 'Native release type mismatch');
            assert.equal(id(movements[0].orderLine?.id), '248', 'Native release line mismatch');
            assert.equal(
                id(movements[0].stockLocationId ?? movements[0].stockLocation?.id),
                '10',
                'Native release warehouse mismatch',
            );
            assert.equal(movements[0].quantity, 1, 'Native release quantity mismatch');
            const originalCoupon = fresh.snapshot.coupons[0];
            const originalAllocation = fresh.snapshot.allocations[0];
            const couponCas = await repo(txCtx, 'CustomerCoupon').update(
                {
                    id: '8',
                    channelId: '5',
                    version: originalCoupon.version,
                    status: 'USED',
                    usedOrderId: '37',
                },
                {
                    status: 'EXPIRED',
                    expiredAt: clock(),
                    lockedOrderId: null,
                    lockedAt: null,
                    lockExpiresAt: null,
                },
            );
            assert.equal(couponCas.affected, 1, 'Coupon compare-and-set failed');
            const allocationCas = await repo(txCtx, 'CouponOrderAllocation').update(
                { id: originalAllocation.id, channelId: '5', orderId: '37', status: 'USED' },
                {
                    status: 'RELEASED',
                    releasedAt: originalAllocation.releasedAt
                        ? new Date(originalAllocation.releasedAt)
                        : clock(),
                },
            );
            assert.equal(allocationCas.affected, 1, 'Coupon allocation compare-and-set failed');
            const ledgerIds = [];
            for (const eventType of ['CORRECTED', 'EXPIRED']) {
                const ledgerEntry = await repo(txCtx, 'CouponLedgerEntry').save(
                    new entities.CouponLedgerEntry({
                        channelId: '5',
                        customerCouponId: '8',
                        promotionId: originalCoupon.promotionId,
                        customerId: originalCoupon.customerId,
                        orderId: '37',
                        refundId: null,
                        eventType,
                        actorType: 'ADMIN',
                        idempotencyKey: `${receiptKey()}:8:${eventType}`,
                        discountAmount: null,
                        note: '历史纯测试数字订单收尾；保留原REDEEMED，已过期权益终结，不补发新券',
                        metadata: {
                            compensationKey: receiptKey(),
                            beforeFingerprint: fresh.fingerprint,
                            originalCoupon,
                            originalAllocation,
                        },
                    }),
                );
                ledgerIds.push(id(ledgerEntry.id));
            }
            const owner = await repo(txCtx, 'CustomerCoupon').findOne({
                where: { id: '8' },
                relations: { customer: { user: true } },
            });
            await coupons.publishCustomerCouponChanged(txCtx, owner.customer);
            const after = await capture(txCtx);
            for (const key of ['order', 'payments', 'lines', 'fulfillments', 'locations', 'carts'])
                assert.deepEqual(after.snapshot[key], fresh.snapshot[key], `Original ${key} changed`);
            for (const [table, evidence] of Object.entries(fresh.snapshot.risks))
                if (table !== 'manual_digital_delivery')
                    assert.deepEqual(after.snapshot.risks[table], evidence, `Risk ${table} changed`);
            const beforeDigital = fresh.snapshot.digital;
            const afterDigital = after.snapshot.digital;
            assert.equal(afterDigital.task.state, 'CANCELLED', 'Manual task was not closed');
            assert.equal(
                afterDigital.task.immutableFingerprint,
                beforeDigital.task.immutableFingerprint,
                'Original task content/history fields changed',
            );
            for (const key of [
                'lineIdentity',
                'variant',
                'globalSettings',
                'configs',
                'reservations',
                'receiptAccess',
                'fulfillmentLines',
                'actions',
            ])
                assert.deepEqual(afterDigital[key], beforeDigital[key], `Digital ${key} changed`);
            assert.equal(
                afterDigital.events.length,
                beforeDigital.events.length + 1,
                'Unexpected task event count',
            );
            for (const old of beforeDigital.events)
                assert.deepEqual(
                    afterDigital.events.find(e => e.id === old.id),
                    old,
                    'Original task event changed',
                );
            assert.equal(
                afterDigital.events.filter(e => e.closingReceipt && e.actorType === 'ADMIN').length,
                1,
                'Durable task closing receipt missing',
            );
            assert.equal(
                afterDigital.incidents.length,
                beforeDigital.incidents.length,
                'Incident set changed',
            );
            for (const old of beforeDigital.incidents) {
                const closed = afterDigital.incidents.find(i => i.id === old.id);
                assert.equal(closed.incidentStatus, 'CLOSED', 'Historical incident not truthfully closed');
                assert.equal(
                    closed.immutableFingerprint,
                    old.immutableFingerprint,
                    'Original incident transport/error audit changed',
                );
                assert.equal(
                    closed.originalPayloadFingerprint,
                    old.originalPayloadFingerprint,
                    'Original incident payload audit changed',
                );
            }
            for (const old of beforeDigital.evidence)
                assert.deepEqual(
                    afterDigital.evidence.find(e => e.id === old.id),
                    old,
                    'Original incident evidence changed',
                );
            const releaseIds = movements.map(m => id(m.id));
            assert.deepEqual(
                after.snapshot.movements.filter(m => !releaseIds.includes(m.id)),
                fresh.snapshot.movements,
                'Original stock history changed',
            );
            assert.equal(
                after.snapshot.movements.length,
                fresh.snapshot.movements.length + 1,
                'Unexpected stock movement',
            );
            assert.equal(
                after.snapshot.stockLevels[0].stockOnHand,
                fresh.snapshot.stockLevels[0].stockOnHand,
                'Native release changed stockOnHand',
            );
            assert.equal(
                after.snapshot.stockLevels[0].stockAllocated,
                fresh.snapshot.stockLevels[0].stockAllocated - 1,
                'Native allocated decrement mismatch',
            );
            for (const old of fresh.snapshot.ledger)
                assert.deepEqual(
                    after.snapshot.ledger.find(e => e.id === old.id),
                    old,
                    'Original REDEEMED ledger changed',
                );
            const corrected = after.snapshot.coupons[0];
            assert.equal(corrected.status, 'EXPIRED', 'Coupon was not expired');
            assert.equal(corrected.version, originalCoupon.version + 1, 'Coupon version increment mismatch');
            for (const key of [
                'usedAt',
                'usedOrderId',
                'returnCount',
                'customerId',
                'promotionId',
                'validFrom',
                'validUntil',
            ])
                assert.equal(corrected[key], originalCoupon[key], `Original coupon ${key} changed`);
            assert.equal(
                after.snapshot.allocations[0].releasedAt,
                originalAllocation.releasedAt ?? after.snapshot.allocations[0].releasedAt,
                'Prior allocation release time changed',
            );
            const receipt = {
                key: receiptKey(),
                version: LEGACY_DIGITAL_COMPENSATION_VERSION,
                authorization: manifest.authorization,
                orderId: '37',
                salesChannelId: '5',
                deliveryId: beforeDigital.task.id,
                sourceSnapshotSha256: manifest.sourceSnapshotSha256,
                beforeFingerprint: fresh.fingerprint,
                afterFingerprint: after.fingerprint,
                afterEvidenceFingerprint: compensationFingerprint(replayEvidence(after.snapshot)),
                reviewArtifact,
                reviewFingerprint,
                before: fresh.snapshot,
                releaseIds,
                ledgerIds,
                closedIncidentIds: closedIncidentIds.map(id),
                changedQuantity: 1,
                correctedCoupons: 1,
                appliedAt: clock().toISOString(),
                automaticRecoveryAllowed: false,
                productionCompleted: false,
                productionCompletionStatus: isolatedTest
                    ? 'NOT_APPLICABLE_ISOLATED_TEST'
                    : 'NATIVE_CACHE_REFRESH_AND_READBACK_REQUIRED',
            };
            const entry = await history.createHistoryEntryForOrder(
                {
                    ctx: txCtx,
                    orderId: '37',
                    type: 'ORDER_NOTE',
                    data: {
                        note: '历史纯测试数字任务、原库位预占、已过期券及关联告警收尾；外发结果按原审阅保留',
                        digitalCompensation: receipt,
                    },
                },
                false,
            );
            return { ...receipt, status: 'APPLIED', historyEntryId: id(entry.id) };
        });
    }
    return { capture, execute };
}
