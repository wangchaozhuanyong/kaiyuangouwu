import { CustomerService, RequestContext, TransactionalConnection } from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddStorefrontPageViews1788678000000 } from '../../../dev-server/migrations/1788678000000-add-storefront-page-views';
import { StorefrontPageView } from '../entities/storefront-page-view.entity';

import { StorefrontTrafficService, trafficPublicIp } from './storefront-traffic.service';

// Use the production migration and real queries in a disposable local SQLJS or MySQL database.
const schema = new EntitySchema<StorefrontPageView>({
    name: 'StorefrontPageView',
    target: StorefrontPageView,
    tableName: 'storefront_page_view',
    columns: {
        id: { type: Number, primary: true, generated: true },
        createdAt: { type: Date, createDate: true },
        updatedAt: { type: Date, updateDate: true },
        channelId: { type: Number },
        businessDate: { type: String },
        eventId: { type: String },
        visitorKeyHash: { type: String },
        customerKeyHash: { type: String, nullable: true },
        ipHash: { type: String, nullable: true },
    },
});
const secret = 'test-traffic-signing-secret-not-a-production-credential';
const browser = { 'user-agent': 'Mozilla/5.0 Traffic Browser Test' };
const device = 'traffic-device-00000001';
function ctx(channelId = 1, userId?: string, ip = '203.0.113.10', headers = browser) {
    return { channelId, activeUserId: userId, req: { ip, headers } } as unknown as RequestContext;
}
const page = (visitorId = device) => ({ eventId: randomUUID(), visitorId, pageView: true });

describe('storefront traffic persistence', () => {
    let db: DataSource;
    let manager: DataSource | undefined;
    let database: string;
    let service: StorefrontTrafficService;
    beforeEach(async () => {
        if (process.env.DB === 'mysql') {
            database = `traffic_service_${randomUUID().replaceAll('-', '')}`;
            const localFixture = {
                host: '127.0.0.1',
                port: Number(process.env.E2E_MYSQL_PORT || 3306),
                username: 'root',
                password: 'password',
            };
            manager = await new DataSource({ type: 'mysql', ...localFixture }).initialize();
            await manager.query(`CREATE DATABASE \`${database}\``);
            db = await new DataSource({
                type: 'mysql',
                ...localFixture,
                database,
                entities: [schema],
                synchronize: false,
            }).initialize();
        } else {
            db = await new DataSource({ type: 'sqljs', entities: [schema], synchronize: false }).initialize();
        }
        await db.query('CREATE TABLE channel (id INTEGER PRIMARY KEY)');
        await db.query('INSERT INTO channel VALUES (1), (2)');
        await new AddStorefrontPageViews1788678000000().up(db.createQueryRunner());
        service = new StorefrontTrafficService(
            {
                getRepository: () => db.getRepository(StorefrontPageView),
            } as unknown as TransactionalConnection,
            {
                findOneByUserId: (_ctx: RequestContext, id: string) =>
                    Promise.resolve(id === 'admin' ? undefined : { id }),
            } as unknown as CustomerService,
            { signingSecret: secret } as never,
        );
    });
    afterEach(async () => {
        vi.useRealTimers();
        await db?.destroy();
        if (manager) {
            await manager.query(`DROP DATABASE \`${database}\``);
            await manager.destroy();
            manager = undefined;
        }
    });

    it('counts concurrent retries once using the database constraint', async () => {
        const input = page();
        await Promise.all([service.record(ctx(), input), service.record(ctx(), input)]);
        await service.record(ctx(), page());
        expect((await service.report(ctx(), 1)).days[0]).toMatchObject({
            visitorCount: 1,
            pageViewCount: 2,
            ipCount: 1,
        });
    });

    it('distinguishes devices sharing an IP and keeps a device stable across network changes', async () => {
        await service.record(ctx(), page());
        await service.record(ctx(), page('traffic-device-00000002'));
        await service.record(ctx(1, undefined, '198.51.100.20'), page());
        expect((await service.report(ctx(), 1)).days[0]).toMatchObject({
            visitorCount: 2,
            pageViewCount: 3,
            ipCount: 2,
        });
    });

    it('links anonymous views, login, logout and multiple logged-in devices without counting login as a view', async () => {
        const input = page();
        await service.record(ctx(), input);
        await service.record(ctx(), page());
        await service.record(ctx(1, 'customer-a'), { ...input, pageView: false });
        await service.record(ctx(1, 'customer-a'), page('traffic-device-00000002'));
        await service.record(ctx(), page());
        expect((await service.report(ctx(), 1)).days[0]).toMatchObject({ visitorCount: 1, pageViewCount: 4 });
    });

    it('isolates channels even when the same event ID is used', async () => {
        const input = page();
        await service.record(ctx(1), input);
        await service.record(ctx(2), input);
        await service.record(ctx(2), page());
        expect((await service.report(ctx(1), 1)).days[0].pageViewCount).toBe(1);
        expect((await service.report(ctx(2), 1)).days[0].pageViewCount).toBe(2);
    });

    it('does not allow an event to be reassigned to a different browser', async () => {
        const input = page();
        await service.record(ctx(), input);
        expect(
            await service.record(ctx(1, 'attacker'), {
                ...input,
                visitorId: 'different-browser-0001',
                pageView: false,
            }),
        ).toMatchObject({ recorded: false });
        expect((await db.getRepository(StorefrontPageView).find())[0].customerKeyHash).toBeNull();
    });

    it('rejects bots, opted-out browsers, administrator sessions and malformed inputs', async () => {
        expect(
            await service.record(ctx(1, undefined, '203.0.113.10', { 'user-agent': 'Googlebot' }), page()),
        ).toMatchObject({ recorded: false });
        expect(
            await service.record(
                ctx(1, undefined, '203.0.113.10', {
                    ...browser,
                    cookie: 'storefront_analytics_opt_out=1',
                } as typeof browser),
                page(),
            ),
        ).toMatchObject({ recorded: false });
        expect(await service.record(ctx(1, 'admin'), page())).toMatchObject({ recorded: false });
        await expect(service.record(ctx(), { ...page(), eventId: 'invalid' })).rejects.toThrow();
        await expect(service.record(ctx(), page('invalid'))).rejects.toThrow();
        expect(await db.getRepository(StorefrontPageView).count()).toBe(0);
    });

    it('shows missing and incomplete data explicitly and rejects unsupported report ranges', async () => {
        expect((await service.report(ctx(), 7)).days.every(day => day.visitorCount === null)).toBe(true);
        await service.record(ctx(1, undefined, '127.0.0.1'), page());
        expect((await service.report(ctx(), 1)).days[0]).toMatchObject({
            visitorCount: 1,
            pageViewCount: 1,
            ipCount: null,
        });
        await expect(service.report(ctx(), 100000)).rejects.toThrow();
    });

    it('uses server UTC+8 days, prevents a retry crossing midnight from creating a second view and salts hashes daily', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-05T15:59:59Z'));
        const input = page();
        await service.record(ctx(), input);
        vi.setSystemTime(new Date('2026-09-05T16:00:01Z'));
        await service.record(ctx(), input);
        await service.record(ctx(), page());
        const rows = await db.getRepository(StorefrontPageView).find();
        expect(rows.map(row => row.businessDate)).toEqual(['2026-09-05', '2026-09-06']);
        expect(new Set(rows.map(row => row.ipHash)).size).toBe(2);
        expect((await service.report(ctx(), 7)).days.slice(-2).map(day => day.pageViewCount)).toEqual([1, 1]);
    });

    it('persists only digests and returns ISO UTC timestamps', async () => {
        await service.record(ctx(1, 'customer-a'), page());
        const raw = JSON.stringify(await db.getRepository(StorefrontPageView).find());
        for (const value of ['203.0.113.10', device, 'customer-a', secret, browser['user-agent']])
            expect(raw).not.toContain(value);
        expect((await service.report(ctx(), 7)).lastRecordedAt).toMatch(/Z$/u);
    });
});

describe('traffic IP normalization', () => {
    it('normalizes equivalent IPv6 and IPv4-mapped values', () => {
        expect(trafficPublicIp('2001:0db8:0:0:0:0:0:1')).toBe('2001:db8::1');
        expect(trafficPublicIp('::ffff:203.0.113.10')).toBe('203.0.113.10');
    });
    it('does not count private or invalid proxy addresses as public visitors', () => {
        for (const ip of [
            '127.0.0.1',
            '10.0.0.1',
            '192.168.1.1',
            '172.16.0.2',
            '::1',
            'fc00::1',
            'fe80::1',
            'not-an-ip',
        ])
            expect(trafficPublicIp(ip)).toBeNull();
    });
});
