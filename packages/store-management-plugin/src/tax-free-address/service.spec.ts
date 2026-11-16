import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomBytes, randomUUID } from 'node:crypto';
import { request as sendHttp } from 'node:http';
import type { AddressInfo } from 'node:net';
import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddTaxFreeAddress1794787200000 } from '../../../dev-server/migrations/1794787200000-add-tax-free-address';

import { ADDRESS_TOOL_ORIGIN, TaxFreeAddressController } from './controller';
import {
    TaxFreeAddressEntity as Address,
    TaxFreeAddressFingerprint as Fingerprint,
    TaxFreeAddressPool as Pool,
} from './entities';
import { ADDRESS_CAPACITY, addressAt, addressFingerprint } from './generator';
import { browserIdentity } from './identity';
import { TaxFreeAddressService } from './service';

const baseColumns = {
    id: { type: Number, primary: true, generated: true },
    createdAt: { type: Date, createDate: true },
    updatedAt: { type: Date, updateDate: true },
} as const;
const entities = [
    new EntitySchema({
        name: 'TaxFreeAddressPool',
        target: Pool,
        tableName: 'tax_free_address_pool',
        columns: { ...baseColumns, cursor: { type: Number }, revision: { type: Number } },
    }),
    new EntitySchema({
        name: 'TaxFreeAddressFingerprint',
        target: Fingerprint,
        tableName: 'tax_free_address_fingerprint',
        columns: {
            ...baseColumns,
            fingerprint: { type: String },
            requestKey: { type: String, nullable: true },
            browserHash: { type: String, nullable: true },
            channelId: { type: String, nullable: true },
            claimedAt: { type: Date, nullable: true },
        },
    }),
    new EntitySchema({
        name: 'TaxFreeAddressEntity',
        target: Address,
        tableName: 'tax_free_address',
        columns: {
            ...baseColumns,
            fingerprint: { type: String },
            country: { type: String },
            line1: { type: String },
            city: { type: String },
            state: { type: String },
            postalCode: { type: String },
            status: { type: String },
            usedAt: { type: Date, nullable: true },
        },
    }),
];
const mysqlPort = Number(process.env.TAX_ADDRESS_MYSQL_PORT || 0);
describe('tax-free address isolated database', () => {
    let db: DataSource;
    let service: TaxFreeAddressService;
    let secret: string;
    const budgets = { consume: vi.fn() };
    const contexts = () => {
        const headers = new Map<string, unknown>();
        return {
            apiType: 'shop',
            channelId: 1,
            activeUserId: undefined,
            req: {
                ip: '192.0.2.10',
                secure: true,
                headers: {} as Record<string, string>,
                res: {
                    getHeader: (name: string) => headers.get(name),
                    setHeader: (name: string, value: unknown) => headers.set(name, value),
                },
            },
            headers,
        } as any;
    };
    const browser = async () => {
        const ctx = contexts();
        await service.status(ctx.req);
        ctx.req.headers.cookie = ctx.headers.get('Set-Cookie').split(';')[0];
        return ctx;
    };
    const admin = () => ({ ...contexts(), apiType: 'admin', activeUserId: 9 });
    beforeAll(async () => {
        // Explicit loopback, disposable database only; never load .env or production configuration.
        db = new DataSource(
            mysqlPort
                ? {
                      type: 'mysql',
                      host: '127.0.0.1',
                      port: mysqlPort,
                      username: 'root',
                      password: '',
                      database: 'tax_address_test',
                      entities,
                      extra: { connectionLimit: 12 },
                  }
                : { type: 'sqljs', entities },
        );
        await db.initialize();
        const runner = db.createQueryRunner();
        await new AddTaxFreeAddress1794787200000().up(runner);
        await runner.release();
    }, 30_000);
    afterAll(async () => {
        if (db?.isInitialized) await db.destroy();
    });
    beforeEach(async () => {
        for (const entity of [Address, Fingerprint, Pool]) await db.getRepository(entity).clear();
        await db.getRepository(Pool).insert({ id: 1, cursor: 0, revision: 0 });
        secret = randomBytes(32).toString('hex');
        budgets.consume.mockReset().mockResolvedValue({ allowed: true });
        service = new TaxFreeAddressService(
            { rawConnection: db } as any,
            { authOptions: { cookieOptions: { secret } } } as any,
            budgets as any,
        );
    });
    it('serves anonymous same-origin HTTP only and never forwards a storefront or admin API', async () => {
        const current = service;
        const host = 'address-tool.example.test';
        @Module({
            controllers: [TaxFreeAddressController],
            providers: [
                { provide: TaxFreeAddressService, useFactory: () => current },
                { provide: ADDRESS_TOOL_ORIGIN, useValue: new URL('https://' + host) },
            ],
        })
        class FixtureModule {}
        const app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
        app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
        try {
            await app.listen(0, '127.0.0.1');
            const port = (app.getHttpServer().address() as AddressInfo).port;
            const http = (path: string, headers = {}, data?: string) =>
                new Promise<{
                    status: number;
                    headers: Record<string, string | string[] | undefined>;
                    text: string;
                }>((resolve, reject) => {
                    const req = sendHttp(
                        {
                            hostname: '127.0.0.1',
                            port,
                            path,
                            method: data ? 'POST' : 'GET',
                            headers: {
                                Host: host,
                                'X-Forwarded-Proto': 'https',
                                ...(data ? { 'Content-Type': 'application/json' } : {}),
                                ...headers,
                            },
                        },
                        res => {
                            let text = '';
                            res.setEncoding('utf8').on('data', chunk => {
                                text += chunk;
                            });
                            res.on('end', () =>
                                resolve({ status: res.statusCode ?? 500, headers: res.headers, text }),
                            );
                            res.on('error', reject);
                        },
                    );
                    req.on('error', reject).end(data);
                });
            const status = await http('/api/address/status');
            expect(status.status).toBe(200);
            expect(status.headers['cache-control']).toBe('private, no-store');
            const setCookie = status.headers['set-cookie']?.[0] ?? '';
            expect(setCookie).toMatch(
                /^__Host-tax_address_browser=.+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict; Secure$/,
            );
            expect(setCookie).not.toContain('Domain=');
            expect(JSON.parse(status.text)).toMatchObject({ nextAllowedAt: null });
            expect((await service.list()).generated).toBe(0);
            for (const path of ['/shop-api', '/admin-api', '/dashboard', '/api/address/list']) {
                expect((await http(path)).status).toBe(404);
            }
            expect((await http('/api/address/status', { Host: 'shop.example.test' })).status).toBe(404);
            expect((await http('/api/address/status', { 'Sec-Fetch-Site': 'same-site' })).status).toBe(403);
            const payload = JSON.stringify({ requestId: randomUUID() });
            const cookie = setCookie.split(';')[0];
            expect(
                (
                    await http(
                        '/api/address/claim',
                        { Origin: 'https://shop.example.test', Cookie: cookie },
                        payload,
                    )
                ).status,
            ).toBe(403);
            expect((await service.list()).generated).toBe(0);
            const receipt = await http(
                '/api/address/claim',
                { Origin: 'https://' + host, Cookie: cookie },
                payload,
            );
            expect(receipt.status).toBe(200);
            expect(Object.keys(JSON.parse(receipt.text).address)).toEqual([
                'id',
                'country',
                'line1',
                'city',
                'state',
                'postalCode',
                'status',
                'createdAt',
                'usedAt',
            ]);
            expect((await service.list()).used).toBe(1);
        } finally {
            await app.close();
        }
    });
    it('anonymous empty-pool claim replenishes 100; replay returns one receipt and cooldown uses server time', async () => {
        const ctx = await browser();
        const requestId = randomUUID();
        const first = await service.claimPublic(ctx.req, requestId);
        expect(first.address.country).toBe('United States');
        expect(first.address.status).toBe('used');
        expect(first.address.postalCode).toMatch(/^\d{5}$/);
        expect(await service.list()).toMatchObject({ unused: 99, used: 1, retained: 100, generated: 100 });
        expect((await service.claimPublic(ctx.req, requestId)).address).toEqual(first.address);
        await expect(service.claimPublic(ctx.req, randomUUID())).rejects.toThrow('COOLDOWN');
        await db
            .getRepository(Fingerprint)
            .createQueryBuilder()
            .update()
            .set({ claimedAt: new Date(Date.now() - 299_000) })
            .where('1 = 1')
            .execute();
        await expect(service.claimPublic(ctx.req, randomUUID())).rejects.toThrow('COOLDOWN');
        await db
            .getRepository(Fingerprint)
            .createQueryBuilder()
            .update()
            .set({ claimedAt: new Date(Date.now() - 300_001) })
            .where('1 = 1')
            .execute();
        expect((await service.claimPublic(ctx.req, randomUUID())).address.id).not.toBe(first.address.id);
    });
    it('signed identity ignores storefront sessions and rejects forged cookies and excessive claims', async () => {
        const ctx = await browser();
        const id = browserIdentity(ctx.req, secret);
        expect(ctx.req.headers.cookie).not.toContain(secret);
        ctx.req.headers.cookie += '; other_site_session=fixture';
        expect(browserIdentity(ctx.req, secret)).toBe(id);
        await service.claimPublic(ctx.req, randomUUID());
        await expect(service.claimPublic(ctx.req, randomUUID())).rejects.toThrow('COOLDOWN');
        ctx.req.headers.cookie = ctx.req.headers.cookie.split(';')[0] + 'tampered';
        await expect(service.claimPublic(ctx.req, randomUUID())).rejects.toThrow('BROWSER_REQUIRED');
        budgets.consume.mockResolvedValueOnce({ allowed: false });
        await expect(service.claimPublic(ctx.req, randomUUID())).rejects.toThrow('RATE_LIMIT');
        expect((await service.list()).generated).toBe(100);
    });
    it('deletion preserves fingerprints and receipts, including when the generation cursor is rewound', async () => {
        const ctx = await browser();
        const requestId = randomUUID();
        const claimed = await service.claimPublic(ctx.req, requestId);
        const before = await service.list({ status: 'used' });
        expect((await service.clearUsed(before.revision)).count).toBe(1);
        expect((await service.list()).generated).toBe(100);
        await expect(service.claimPublic(ctx.req, requestId)).rejects.toThrow('RESULT_EXPIRED');
        await db.getRepository(Pool).update(1, { cursor: 0 });
        await service.generateAdmin(100);
        expect(await db.getRepository(Address).existsBy({ line1: claimed.address.line1 })).toBe(false);
        expect((await service.list()).generated).toBe(200);
    });
    it('retains at most 1000 addresses, pruning oldest used records while preserving unused and permanent history', async () => {
        for (let n = 0; n < 10; n++) await service.generateAdmin(100);
        await expect(service.generateAdmin(1)).rejects.toThrow('CAPACITY');
        const rows = await db.getRepository(Address).find({ order: { id: 'ASC' }, take: 101 });
        for (let n = 0; n < rows.length; n++) {
            await db
                .getRepository(Address)
                .update(rows[n].id, { status: 'used', usedAt: new Date(1000 + n) });
        }
        await service.generateAdmin(100);
        expect(await service.list()).toMatchObject({ retained: 1000, unused: 999, used: 1, generated: 1100 });
        expect(await db.getRepository(Address).existsBy({ id: rows[0].id })).toBe(false);
        expect(await db.getRepository(Address).existsBy({ id: rows[100].id })).toBe(true);
        expect(await db.getRepository(Fingerprint).count()).toBe(1100);
    }, 30_000);
    it('generation exhaustion rolls back pruning and manual clear checks the reviewed revision', async () => {
        const ctx = await browser();
        await service.claimPublic(ctx.req, randomUUID());
        const reviewed = await service.list();
        await service.generateAdmin(1);
        await expect(service.clearUsed(reviewed.revision)).rejects.toThrow('CONFLICT');
        await db.getRepository(Pool).update(1, { cursor: ADDRESS_CAPACITY - 1 });
        const before = await service.list();
        await expect(service.generateAdmin(100)).rejects.toThrow('EXHAUSTED');
        expect(await service.list()).toEqual(before);
        expect((await db.getRepository(Pool).findOneByOrFail({ id: 1 })).cursor).toBe(ADDRESS_CAPACITY - 1);
    });
    it('admin claim is atomic, idempotent, excludes browser cooldown and rejects a stale unused selection', async () => {
        await service.generateAdmin(2);
        const rows = (await service.list()).items;
        const ctx = admin();
        const requestId = randomUUID();
        expect((await service.claimAdmin(ctx, requestId, rows[0].id)).nextAllowedAt).toBeNull();
        expect((await service.claimAdmin(ctx, requestId, rows[0].id)).address.id).toBe(rows[0].id);
        await expect(service.claimAdmin(ctx, randomUUID(), rows[0].id)).rejects.toThrow('ALREADY_USED');
        expect((await service.claimAdmin(ctx, randomUUID(), rows[1].id)).address.id).toBe(rows[1].id);
    });
    it('migration replay never resets cursor/receipts; rollback cannot erase the ledger', async () => {
        await service.generateAdmin(1);
        const runner = db.createQueryRunner();
        await new AddTaxFreeAddress1794787200000().up(runner);
        await runner.release();
        expect((await db.getRepository(Pool).findOneByOrFail({ id: 1 })).cursor).toBe(1);
        expect(await db.getRepository(Fingerprint).count()).toBe(1);
        await expect(new AddTaxFreeAddress1794787200000().down()).rejects.toThrow('Permanent');
    });
    it.skipIf(!mysqlPort)(
        'MySQL parallel empty-pool claims share the row lock across service instances and only refill twice',
        async () => {
            const visitors = await Promise.all(Array.from({ length: 101 }, browser));
            const other = new TaxFreeAddressService(
                { rawConnection: db } as any,
                { authOptions: { cookieOptions: { secret } } } as any,
                budgets as any,
            );
            const claims = await Promise.all(
                visitors.map((visitor, index) =>
                    (index % 2 ? service : other).claimPublic(visitor.req, randomUUID()),
                ),
            );
            expect(new Set(claims.map(row => row.address.id)).size).toBe(101);
            expect(await service.list()).toMatchObject({
                retained: 200,
                used: 101,
                unused: 99,
                generated: 200,
            });
            const ctx = await browser();
            const requestId = randomUUID();
            const retries = await Promise.all(
                Array.from({ length: 12 }, () => service.claimPublic(ctx.req, requestId)),
            );
            expect(new Set(retries.map(row => row.address.id)).size).toBe(1);
            const results = await Promise.allSettled(
                Array.from({ length: 8 }, () => service.claimPublic(ctx.req, randomUUID())),
            );
            expect(results.every(result => result.status === 'rejected')).toBe(true);
        },
        30_000,
    );
});
it('all 89,000 original street combinations are unique, with stable normalized fingerprints', () => {
    const keys = new Set<string>();
    for (let cursor = 0; cursor < ADDRESS_CAPACITY; cursor++) {
        const row = addressAt(cursor);
        keys.add(row.fingerprint);
        expect(row.postalCode).toMatch(/^\d{5}$/);
    }
    expect(keys.size).toBe(ADDRESS_CAPACITY);
    expect(addressFingerprint(' 123  MAIN St ')).toBe(addressFingerprint('123 Main St'));
    expect(() => addressAt(ADDRESS_CAPACITY)).toThrow('EXHAUSTED');
});
