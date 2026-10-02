import { Channel, LanguageCode, Order, Promotion, RequestContext } from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddAdminTelegramNotifications1788413600000 } from '../../../dev-server/migrations/1788413600000-add-admin-telegram-notifications';
import { AddIncidentResponseWorkflow1789502400000 } from '../../../dev-server/migrations/1789502400000-add-incident-response-workflow';
import { AddCustomerServiceFeedback1790310000000 } from '../../../dev-server/migrations/1790310000000-add-customer-service-feedback';
import { AddUnifiedStoreNotifications1790899200000 } from '../../../dev-server/migrations/1790899200000-add-unified-store-notifications';
import {
    AdminNotificationService,
    sanitizePayload,
} from '../../../operations-dashboard-plugin/src/admin-notification.service';
import { AdminNotificationDelivery } from '../../../operations-dashboard-plugin/src/entities/admin-notification-delivery.entity';
import { AdminNotificationRuntime } from '../../../operations-dashboard-plugin/src/entities/admin-notification-runtime.entity';
import { AdminNotificationSignal } from '../../../operations-dashboard-plugin/src/entities/admin-notification-signal.entity';
import { NotificationSignalService } from '../../../operations-dashboard-plugin/src/notification-signal.service';
import { SecurityNotificationService } from '../../../operations-dashboard-plugin/src/security-notification.service';
import { TelegramNotificationWorkerService } from '../../../operations-dashboard-plugin/src/telegram-notification-worker.service';
import { CustomerServiceFeedbackService } from '../customer-service-feedback.service';
import { CustomerServiceFeedback } from '../entities/customer-service-feedback.entity';
import { CustomerServiceReview } from '../entities/customer-service-review.entity';
import { StoreCouponCampaignConfig } from '../entities/store-coupon-campaign-config.entity';
import { StorefrontPresence, StorefrontPresenceStatus } from '../entities/storefront-presence.entity';

import { CustomerServiceReviewService } from './customer-service-review.service';
import {
    duePromotion,
    EXPIRY_REMINDER_MS,
    hourReportKey,
    PlatformStoreNotificationService,
} from './platform-store-notification.service';
import { ONLINE_WINDOW_MS, StorefrontPresenceService } from './storefront-presence.service';

const base = {
    id: { type: Number, primary: true, generated: true },
    createdAt: { type: Date, createDate: true },
    updatedAt: { type: Date, updateDate: true },
} as const;
const schema = (target: any, tableName: string, columns: any) =>
    new EntitySchema({ name: target.name, target, tableName, columns: { ...base, ...columns } });
const nullableHash = { type: String, nullable: true };
const outbox = new EntitySchema({
    name: 'AdminNotificationDelivery',
    target: AdminNotificationDelivery,
    tableName: 'admin_notification_outbox',
    columns: {
        ...base,
        ...Object.fromEntries(
            [
                'eventType',
                'category',
                'ownerDepartmentCode',
                'actionHint',
                'severity',
                'mode',
                'eventState',
                'title',
                'deliveryAction',
                'deliveryStatus',
            ].map(name => [name, { type: String }]),
        ),
        ...Object.fromEntries(
            [
                'sourceType',
                'sourceId',
                'dedupKey',
                'fingerprint',
                'activeFingerprint',
                'telegramMessageId',
                'queueJobId',
                'lastErrorCode',
                'lastError',
                'claimedBy',
                'escalationDepartmentCode',
            ].map(name => [name, nullableHash]),
        ),
        ...Object.fromEntries(
            ['availableAt', 'firstOccurredAt', 'lastOccurredAt'].map(name => [name, { type: Date }]),
        ),
        ...Object.fromEntries(
            ['expiresAt', 'slaDueAt', 'resolvedAt', 'escalatedAt', 'claimedAt', 'sentAt'].map(name => [
                name,
                { type: Date, nullable: true },
            ]),
        ),
        ...Object.fromEntries(
            ['occurrenceCount', 'priority', 'attempts', 'maxAttempts'].map(name => [name, { type: Number }]),
        ),
        actionRequired: { type: Boolean },
        silent: { type: Boolean },
        payload: { type: 'simple-json' },
        collaboratorDepartmentCodes: { type: 'simple-json' },
    },
});
const schemas = [
    outbox,
    schema(CustomerServiceFeedback, 'customer_service_feedback', {
        notificationRevision: { type: Number },
        channelId: { type: Number },
        customerId: { type: Number },
        orderId: { type: Number, nullable: true },
        orderCode: nullableHash,
        scopeKey: { type: String },
        rating: { type: Number },
        tagsJson: { type: String },
        comment: nullableHash,
    }),
    schema(Channel, 'channel', { code: { type: String }, customFields: { type: 'simple-json' } }),
    schema(Order, 'order', {
        code: { type: String },
        customerId: { type: Number },
        salesChannelId: { type: Number },
    }),
    schema(StorefrontPresence, 'storefront_presence', {
        channelId: { type: Number },
        visitorKeyHash: { type: String },
        customerKeyHash: nullableHash,
        lastSeenAt: { type: Date },
    }),
    schema(StorefrontPresenceStatus, 'storefront_presence_status', {
        channelId: { type: Number },
        firstSeenAt: { type: Date },
    }),
    schema(CustomerServiceReview, 'customer_service_review', {
        channelId: { type: Number },
        customerId: { type: Number, nullable: true },
        orderId: { type: Number, nullable: true },
        ownerKey: { type: String },
        submissionKey: { type: String },
        rating: { type: Number },
        tags: { type: 'simple-json' },
        comment: { type: String },
        orderCode: nullableHash,
        revision: { type: Number },
    }),
    schema(AdminNotificationSignal, 'admin_notification_signal', {
        key: { type: String },
        identityHash: { type: String },
        count: { type: Number },
        expiresAt: { type: Date },
    }),
];
const device = randomUUID();
const input = () => ({ visitorId: device, rating: 5, tags: ['响应迅速'], comment: '处理得很好' });
function ctx(channelId = 1, userId?: number, headers: Record<string, string> = {}) {
    return {
        channelId,
        activeUserId: userId,
        req: { ip: '203.0.113.10', headers: { 'user-agent': 'Mozilla/5.0 Test Browser', ...headers } },
        userHasPermissions: () => false,
    } as unknown as RequestContext;
}

describe('unified store notifications with real persistence and additive migrations', () => {
    let db: DataSource;
    let presence: StorefrontPresenceService;
    let reviews: CustomerServiceReviewService;
    let signals: NotificationSignalService;
    let notifications: AdminNotificationService;
    let connection: any;
    let worker: any;
    beforeEach(async () => {
        db = await new DataSource({ type: 'sqljs', entities: schemas, synchronize: false }).initialize();
        // Core tables are minimal local fixtures. New production tables come from the actual migration.
        await db.query('CREATE TABLE customer (id INTEGER PRIMARY KEY)');
        await db.query('INSERT INTO customer (id) VALUES (7),(8)');
        await db.query(
            'CREATE TABLE channel (id INTEGER PRIMARY KEY, createdAt datetime, updatedAt datetime, code varchar, customFields text)',
        );
        await db.query(
            'CREATE TABLE "order" (id INTEGER PRIMARY KEY, createdAt datetime, updatedAt datetime, code varchar, customerId int, salesChannelId int)',
        );
        await new AddAdminTelegramNotifications1788413600000().up(db.createQueryRunner());
        await new AddIncidentResponseWorkflow1789502400000().up(db.createQueryRunner());
        await new AddCustomerServiceFeedback1790310000000().up(db.createQueryRunner());
        const migration = new AddUnifiedStoreNotifications1790899200000();
        await migration.up(db.createQueryRunner());
        await migration.up(db.createQueryRunner());
        await db
            .getRepository(Channel)
            .save([
                new Channel({ id: 1, code: 'shop-a', customFields: { storefrontNameZh: '甲店' } }),
                new Channel({ id: 2, code: 'shop-b', customFields: { storefrontNameZh: '乙店' } }),
            ]);
        await db.query(
            `INSERT INTO "order" (id,code,customerId,salesChannelId) VALUES (11,'ORDER-A',7,1),(12,'ORDER-B',7,2),(13,'OTHER',8,1)`,
        );
        connection = {
            rawConnection: db,
            withTransaction: async (contextOrWork: any, maybeWork?: any) => {
                const context = typeof contextOrWork === 'function' ? {} : contextOrWork;
                const work = typeof contextOrWork === 'function' ? contextOrWork : maybeWork;
                if (context.manager) return work(context);
                return db.transaction(manager => work({ ...context, manager }));
            },
            getRepository: (context: any, entity: any) =>
                (context.manager ?? db.manager).getRepository(entity),
        };
        const customers = {
            findOneByUserId: (_ctx: any, id: number) => Promise.resolve(id === 99 ? undefined : { id }),
        };
        const config = {
            enabled: true,
            tokenConfigured: true,
            chatId: 'test-group',
            minSeverity: 'P3',
            notifyOrderEvents: true,
            notifyInventoryEvents: true,
            notifyServiceReviews: true,
            notifyOnlineReports: true,
            notifyPromotionExpiry: true,
            notifySecurityEvents: true,
            p0RepeatMinutes: 30,
            p1RepeatMinutes: 120,
            p1EscalationMinutes: 60,
            p2Silent: true,
            p3Silent: true,
            routeOverrides: [],
            sendResolved: true,
        };
        worker = {
            dispatch: vi.fn(() => Promise.resolve(true)),
            status: vi.fn(() => Promise.resolve({ running: true, dead: 0 })),
        };
        notifications = new AdminNotificationService(
            connection,
            { get: () => Promise.resolve(config), shouldDeliver: () => true } as never,
            worker,
            { appendSystemEvidence: vi.fn(() => Promise.resolve(undefined)) } as never,
        );
        signals = new NotificationSignalService(connection);
        presence = new StorefrontPresenceService(
            connection,
            customers as never,
            { signingSecret: 'test-notification-signing-secret' } as never,
        );
        reviews = new CustomerServiceReviewService(
            connection,
            customers as never,
            notifications as never,
            signals as never,
            { signingSecret: 'test-notification-signing-secret' } as never,
            new CustomerServiceFeedbackService(
                connection,
                customers as never,
                notifications as never,
                signals as never,
            ),
        );
    });
    afterEach(async () => {
        vi.useRealTimers();
        await db?.destroy();
    });
    it('distinguishes unavailable collection, zero after expiry, multi-tab, login merge and cross-store visits', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-02T10:00:00Z'));
        expect(await presence.snapshot(ctx())).toMatchObject({ available: false, total: null });
        await presence.heartbeat(ctx(), device);
        await presence.heartbeat(ctx(), device);
        expect(await presence.snapshot(ctx())).toMatchObject({ total: 1, guests: 1, customers: 0 });
        await presence.heartbeat(ctx(1, 7), device);
        await presence.heartbeat(ctx(1, 7), randomUUID());
        await presence.heartbeat(ctx(2), device);
        expect(await presence.snapshot(ctx())).toMatchObject({ total: 1, guests: 0, customers: 1 });
        expect(await presence.snapshot(ctx(2))).toMatchObject({ total: 1, guests: 1, customers: 0 });
        vi.advanceTimersByTime(ONLINE_WINDOW_MS);
        expect(await presence.snapshot(ctx())).toMatchObject({ available: true, total: 0 });
        const spy = vi
            .spyOn(db.getRepository(StorefrontPresence), 'find')
            .mockRejectedValue(new Error('collection broken'));
        await expect(presence.snapshot(ctx())).rejects.toThrow('collection broken');
        spy.mockRestore();
    });
    it('excludes bots/admin and removes an opted-out browser immediately without creating page views', async () => {
        await presence.heartbeat(ctx(), device);
        expect(
            (
                await presence.heartbeat(
                    ctx(1, undefined, { cookie: 'storefront_analytics_opt_out=1' }),
                    device,
                )
            ).recorded,
        ).toBe(false);
        expect((await presence.snapshot(ctx())).total).toBe(0);
        expect((await presence.heartbeat(ctx(1, 99), device)).recorded).toBe(false);
        expect(
            (await presence.heartbeat(ctx(1, undefined, { 'user-agent': 'Googlebot' }), device)).recorded,
        ).toBe(false);
        expect(await db.createQueryRunner().hasTable('storefront_page_view')).toBe(false);
    });
    it('persists a guest review and outbox once, sends Chinese store attribution, and updates its record', async () => {
        const first = await reviews.submit(ctx(), input());
        await reviews.submit(ctx(), input());
        expect(await db.getRepository(CustomerServiceReview).count()).toBe(1);
        expect(await db.getRepository(AdminNotificationDelivery).count()).toBe(1);
        expect(worker.dispatch).not.toHaveBeenCalled();
        const notice = await db.getRepository(AdminNotificationDelivery).findOneByOrFail({ id: 1 });
        expect(notice.payload).toMatchObject({ storeName: '甲店', rating: 5, serviceTags: ['响应迅速'] });
        expect(notice.silent).toBe(true);
        await db
            .getRepository(CustomerServiceReview)
            .update({ id: first.review.id }, { updatedAt: new Date(Date.now() - 61000) });
        const updated = await reviews.submit(ctx(), { ...input(), id: first.review.id, rating: 1 });
        expect(updated.review.id).toBe(first.review.id);
        expect(updated.review.revision).toBe(2);
        const bad = await db
            .getRepository(AdminNotificationDelivery)
            .findOneByOrFail({ dedupKey: `service-review:${first.review.id}:2` });
        expect(bad.severity).toBe('P1');
        expect(bad.silent).toBe(false);
        await expect(reviews.submit(ctx(2), { ...input(), id: first.review.id })).rejects.toThrow('无权修改');
        expect((await reviews.list(ctx(2))).items).toHaveLength(0);
        await expect(reviews.list(ctx(), 0, 25, true)).rejects.toThrow('仅平台管理员');
    });
    it('preserves historical logged feedback and deduplicates the public and existing submission APIs', async () => {
        const first = await reviews.submit(ctx(1, 7), { ...input(), orderCode: 'ORDER-A' });
        const read = await reviews.current(ctx(1, 7), device, 'ORDER-A');
        expect(read?.id).toBe(first.review.id);
        expect(await db.getRepository(CustomerServiceFeedback).count()).toBe(1);
        await reviews.submit(ctx(1, 7), { ...input(), id: first.review.id, orderCode: 'ORDER-A' });
        expect(await db.getRepository(AdminNotificationDelivery).count()).toBe(1);
        expect((await reviews.list(ctx())).items).toHaveLength(1);
        await db
            .getRepository(CustomerServiceFeedback)
            .update(
                { id: Number(first.review.id.replace('feedback:', '')) },
                { updatedAt: new Date(Date.now() - 61_000) },
            );
        const changed = await reviews.submit(ctx(1, 7), {
            ...input(),
            id: first.review.id,
            orderCode: 'ORDER-A',
            rating: 2,
        });
        expect(changed.review.id).toBe(first.review.id);
        expect(changed.review.revision).toBe(2);
        expect(await db.getRepository(AdminNotificationDelivery).count()).toBe(2);
    });
    it('validates real order customer and sales store, input content and durable rate limits', async () => {
        await expect(reviews.submit(ctx(), { ...input(), orderCode: 'ORDER-A' })).rejects.toThrow('请登录');
        await expect(reviews.submit(ctx(1, 7), { ...input(), orderCode: 'ORDER-B' })).rejects.toThrow(
            '订单不存在',
        );
        await expect(reviews.submit(ctx(1, 7), { ...input(), orderCode: 'OTHER' })).rejects.toThrow(
            '订单不存在',
        );
        const result = await reviews.submit(ctx(1, 7), { ...input(), orderCode: 'ORDER-A' });
        expect(result.review.orderId).toBe(11);
        await expect(reviews.submit(ctx(), { ...input(), rating: 0 })).rejects.toThrow('一至五星');
        await expect(reviews.submit(ctx(), { ...input(), tags: ['arbitrary'] })).rejects.toThrow('标签无效');
        await expect(reviews.submit(ctx(), { ...input(), comment: '长'.repeat(2001) })).rejects.toThrow(
            '2000',
        );
        for (let i = 0; i < 10; i++) await reviews.submit(ctx(), input());
        await expect(
            new CustomerServiceReviewService(
                connection,
                { findOneByUserId: () => Promise.resolve(undefined) } as never,
                notifications as never,
                new NotificationSignalService(connection) as never,
                { signingSecret: 'test-notification-signing-secret' } as never,
                {} as never,
            ).submit(ctx(), input()),
        ).rejects.toThrow('提交过于频繁');
    });
    it('keeps review/outbox atomic while Telegram dispatch never participates in a customer transaction', async () => {
        const failing = new CustomerServiceReviewService(
            connection,
            { findOneByUserId: () => Promise.resolve(undefined) } as never,
            {
                enqueueOneOff: async () => {
                    await Promise.resolve();
                    throw new Error('outbox write rejected');
                },
            } as never,
            signals as never,
            { signingSecret: 'test-notification-signing-secret' } as never,
            {} as never,
        );
        await expect(
            db.transaction(async manager => failing.submit({ ...ctx(), manager } as never, input())),
        ).rejects.toThrow('outbox write rejected');
        expect(await db.getRepository(CustomerServiceReview).count()).toBe(0);
        worker.dispatch.mockRejectedValue(new Error('Telegram unreachable'));
        await reviews.submit(ctx(), input());
        expect(await db.getRepository(CustomerServiceReview).count()).toBe(1);
    });
    it('shares rolling security windows across processes, triggers thresholds, then recovers', async () => {
        const identity = 'a'.repeat(64);
        const other = 'b'.repeat(64);
        const notices = {
            upsertIncident: vi.fn(() => Promise.resolve(true)),
            resolveIncident: vi.fn(() => Promise.resolve(true)),
        };
        const security = new SecurityNotificationService({} as never, connection, signals, notices as never);
        const rebooted = new SecurityNotificationService(
            {} as never,
            connection,
            new NotificationSignalService(connection),
            notices as never,
        );
        for (let i = 0; i < 4; i++) await security.failure(identity, 'PASSWORD_ACCOUNT', 7);
        expect(notices.upsertIncident).not.toHaveBeenCalled();
        await rebooted.failure(identity, 'PASSWORD_ACCOUNT', 7);
        expect(notices.upsertIncident).toHaveBeenCalledWith(
            null,
            expect.objectContaining({ payload: expect.objectContaining({ failureCount: 5 }) }),
        );
        for (let i = 0; i < 19; i++) await security.failure(other, 'PASSWORD_SOURCE');
        expect(notices.upsertIncident).toHaveBeenCalledTimes(1);
        await security.failure(other, 'PASSWORD_SOURCE');
        expect(notices.upsertIncident).toHaveBeenCalledTimes(2);
        expect(await signals.current(identity, Date.now() + 300001)).toBe(0);
        const initial = Date.parse('2026-10-02T10:04:59Z');
        const edge = 'c'.repeat(64);
        await signals.count(edge, 300000, initial);
        await signals.count(edge, 300000, initial + 2000);
        expect(await new NotificationSignalService(connection).current(edge, initial + 299999)).toBe(2);
        expect(await signals.current(edge, initial + 300000)).toBe(1);
    });
    it('handles the exact 72-hour boundary, missed startup reminder, end extension and disabled campaigns', () => {
        const now = new Date('2026-10-02T10:00:00Z');
        const end = new Date(now.getTime() + EXPIRY_REMINDER_MS);
        expect(duePromotion(end, true, false, now)).toBe(true);
        expect(duePromotion(new Date(end.getTime() + 1), true, false, now)).toBe(false);
        expect(duePromotion(new Date(now.getTime() + 3600000), true, false, now)).toBe(true);
        expect(duePromotion(now, true, false, now)).toBe(false);
        expect(duePromotion(end, false, false, now)).toBe(false);
        expect(duePromotion(end, true, true, now)).toBe(false);
        expect(duePromotion(null, true, false, now)).toBe(false);
        expect(hourReportKey(now)).toBe(hourReportKey(new Date(now.getTime() + 59999)));
    });
    it('preserves valid per-store snapshots through secret filtering', () => {
        const payload = sanitizePayload({
            shops: [
                { name: '甲店', total: 0, guests: 0, customers: 0, available: true, secret: 'hide' },
                { name: '乙店', total: null, guests: null, customers: null, available: false },
            ],
            error: 'Bearer example-secret-value',
            apiKey: 'hide',
        });
        expect(payload.shops).toEqual([
            { name: '甲店', total: 0, guests: 0, customers: 0, available: true },
            { name: '乙店', total: null, guests: null, customers: null, available: false },
        ]);
        expect(JSON.stringify(payload)).not.toContain('example-secret-value');
    });

    it('persists promotion reminders across task restarts and recalculates changed coupon deadlines', async () => {
        const now = new Date('2026-10-02T10:00:00Z');
        const discount = {
            id: 41,
            enabled: true,
            endsAt: new Date(now.getTime() + EXPIRY_REMINDER_MS),
            translations: [{ languageCode: LanguageCode.zh_Hans, name: '甲店折扣' }],
        };
        const coupon = {
            id: 42,
            enabled: true,
            endsAt: new Date(now.getTime() + 3600000),
            translations: [{ languageCode: LanguageCode.zh_Hans, name: '甲店领券' }],
        };
        const campaign = {
            promotionId: 42,
            claimEndsAt: new Date(now.getTime() + EXPIRY_REMINDER_MS + 1),
            archivedAt: null as Date | null,
        };
        const promotionConnection = {
            ...connection,
            getRepository: (context: RequestContext, entity: unknown) =>
                entity === Promotion
                    ? { find: () => Promise.resolve([discount, coupon]) }
                    : entity === StoreCouponCampaignConfig
                      ? { find: () => Promise.resolve([campaign]) }
                      : connection.getRepository(context, entity),
        };
        const createTask = () =>
            new PlatformStoreNotificationService(
                promotionConnection,
                {} as never,
                presence,
                {} as never,
                notifications as never,
                {} as never,
            );
        await createTask().promotions(ctx(), now);
        await createTask().promotions(ctx(), now);
        expect(await db.getRepository(AdminNotificationDelivery).count()).toBe(1);
        discount.endsAt = new Date(now.getTime() + 71 * 3600000);
        await createTask().promotions(ctx(), now);
        expect(await db.getRepository(AdminNotificationDelivery).count()).toBe(2);
        discount.enabled = false;
        campaign.claimEndsAt = new Date(now.getTime() + 30 * 3600000);
        await createTask().promotions(ctx(), now);
        expect(await db.getRepository(AdminNotificationDelivery).count()).toBe(3);
        campaign.archivedAt = now;
        campaign.claimEndsAt = new Date(now.getTime() + 29 * 3600000);
        await createTask().promotions(ctx(), now);
        const notices = await db.getRepository(AdminNotificationDelivery).find();
        expect(notices).toHaveLength(3);
        expect(notices[2].payload).toMatchObject({
            storeName: '甲店',
            promotionName: '甲店领券',
            promotionKind: '优惠券领取活动',
        });
        expect(notices[2].expiresAt?.getTime()).toBe(now.getTime() + 30 * 3600000);
    });

    it('persists one hourly report and retains zero versus unavailable stores in the same snapshot', async () => {
        const now = new Date('2026-10-02T10:00:00Z');
        await presence.heartbeat(ctx(), device);
        await db
            .getRepository(StorefrontPresence)
            .update({ channelId: 1 }, { lastSeenAt: new Date(now.getTime() - ONLINE_WINDOW_MS) });
        const channels = await db.getRepository(Channel).find();
        const task = new PlatformStoreNotificationService(
            connection,
            { create: ({ channelOrToken }: any) => Promise.resolve(ctx(channelOrToken.id)) } as never,
            presence,
            { get: () => Promise.resolve({ enabled: true, notifyOnlineReports: true }) } as never,
            notifications as never,
            {} as never,
        );
        vi.spyOn(task, 'stores').mockResolvedValue(channels);
        await task.reconcile(now);
        await task.reconcile(new Date(now.getTime() + 60000));
        const notice = await db.getRepository(AdminNotificationDelivery).findOneByOrFail({
            eventType: 'platform.online.hourly',
        });
        expect(await db.getRepository(AdminNotificationDelivery).count()).toBe(1);
        expect(notice.payload).toMatchObject({
            total: '统计暂不可用',
            shops: [
                { name: '甲店', total: 0, guests: 0, customers: 0, available: true },
                { name: '乙店', total: null, guests: null, customers: null, available: false },
            ],
        });
        expect(new Date(String(notice.expiresAt)).getTime()).toBe(now.getTime() + 10 * 60000);
        expect(notice.silent).toBe(true);
    });

    it.each(['recovered', 'upgraded'])(
        'preserves a %s incident changed while the old Telegram request is sending',
        async state => {
            const incident = await notifications.upsertIncident(ctx(), {
                eventType: 'inventory.variant.low',
                category: 'INVENTORY',
                severity: 'P1',
                fingerprint: 'inventory-race:1',
                title: '库存不足',
                payload: { channelId: '1' },
            });
            if (!incident) throw new Error('Expected a persisted incident');
            const repository = db.getRepository(AdminNotificationDelivery);
            await repository.update(incident.id, {
                deliveryStatus: 'CLAIMED',
                queueJobId: 'old-job',
                claimedBy: 'local-test-worker',
            });
            const runtime = {
                findOne: () => Promise.resolve(null),
                save: (record: unknown) => Promise.resolve(record),
            };
            const actualWorker = new TelegramNotificationWorkerService(
                {
                    rawConnection: {
                        getRepository: (entity: any) =>
                            entity === AdminNotificationRuntime ? runtime : db.getRepository(entity),
                    },
                } as never,
                {} as never,
                { isWorker: true } as never,
                {
                    get: () =>
                        Promise.resolve({
                            enabled: true,
                            tokenConfigured: true,
                            chatId: 'fixture',
                            timezone: 'Asia/Kuala_Lumpur',
                        }),
                } as never,
                {
                    sendMessage: async () => {
                        if (state === 'recovered')
                            await repository.update(incident.id, {
                                eventState: 'RESOLVED',
                                activeFingerprint: null,
                                deliveryStatus: 'PENDING',
                                claimedBy: null,
                                claimedAt: null,
                            });
                        else await repository.update(incident.id, { severity: 'P0', priority: 100 });
                        return { messageId: 'old-message' };
                    },
                } as never,
            );
            const dispatch = vi.spyOn(actualWorker, 'dispatch').mockResolvedValue(true);
            await (actualWorker as unknown as { process(job: unknown): Promise<unknown> }).process({
                data: { deliveryId: String(incident.id) },
            });
            const current = await repository.findOneByOrFail({ id: incident.id });
            expect(current.deliveryStatus).toBe('PENDING');
            expect(current.telegramMessageId).toBeNull();
            if (state === 'recovered') {
                expect(current.eventState).toBe('RESOLVED');
                expect(dispatch).not.toHaveBeenCalled();
            } else {
                expect(current.severity).toBe('P0');
                expect(dispatch).toHaveBeenCalledWith(current.id);
            }
        },
    );
});
