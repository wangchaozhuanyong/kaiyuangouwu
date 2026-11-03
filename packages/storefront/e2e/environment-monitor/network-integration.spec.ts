// organize-imports-ignore -- Preserve ESLint type groups.
import type { StorefrontActivationService } from '../../../store-management-plugin/src/storefront-activation.service';
import type { RequestContextService, TransactionalConnection } from '@vendure/core';
import { Channel, CurrencyCode, LanguageCode, RequestContext } from '@vendure/core';
import type { StorefrontContentService } from '@vendure/storefront-content-plugin';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { buildSchema, graphql, print } from 'graphql';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopAbuseBucket } from '../../../store-management-plugin/src/abuse-protection/entities';
import { ShopAbuseStore } from '../../../store-management-plugin/src/abuse-protection/store';
import {
    EnvironmentMonitorResolver,
    environmentMonitorSchema,
} from '../../../store-management-plugin/src/environment-monitor/environment-monitor.resolver';
import { EnvironmentMonitorService } from '../../../store-management-plugin/src/environment-monitor/environment-monitor.service';
import { StorefrontClientPluginAccessService } from '../../../store-management-plugin/src/storefront-client-plugin-access.service';
import { ShopApi } from '../../src/api';
import { requestEnvironmentNetworkReport } from '../../src/api/environment-monitor';

// Isolated SQL.js and loopback HTTP. Published-store fixtures and IPQS responses are synthetic.
// No dev .env, production database, real customer IP, or paid provider is used.
const bucketSchema = new EntitySchema({
    name: 'ShopAbuseBucket',
    target: ShopAbuseBucket,
    tableName: 'shop_abuse_bucket',
    columns: {
        id: { type: Number, primary: true, generated: true },
        createdAt: { type: Date, createDate: true },
        updatedAt: { type: Date, updateDate: true },
        bucket: { type: String },
        attempts: { type: Number, default: 0 },
        expiresAt: { type: Date },
        blockedUntil: { type: Date, nullable: true },
    },
    indices: [{ columns: ['bucket'], unique: true }],
});

describe('environment monitor through ShopApi, HTTP, resolver, admission and SQL budgets', () => {
    let db: DataSource;
    let server: Server;
    let origin: string;
    let providerCalls: number;
    let lastCacheControl: string | undefined;
    let enabled: Map<string, boolean>;
    let sourceIp: string;
    let vendorFailure: boolean;
    let freeCalls: number;
    let freeFailure: boolean;
    let liveFree: boolean;
    let proxyUnavailable: boolean;
    let whoisAvailable: boolean;
    const nativeFetch = globalThis.fetch;
    const schema = buildSchema(
        `type Query { _environmentTest: Boolean }\n${print(environmentMonitorSchema)}`,
    );
    const context = (code: string) =>
        new RequestContext({
            apiType: 'shop',
            channel: new Channel({
                id: code === 'http-store-a' ? 1 : 2,
                code,
                token: code,
                defaultLanguageCode: LanguageCode.en,
                defaultCurrencyCode: CurrencyCode.USD,
            }),
            languageCode: LanguageCode.en,
            currencyCode: CurrencyCode.USD,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
    const client = (code = 'http-store-a') =>
        new ShopApi({
            code,
            defaultLanguageCode: 'en',
            currencyCode: 'USD',
            countryCode: 'US',
            locale: 'en-US',
            label: 'Synthetic HTTP fixture',
        });

    beforeEach(async () => {
        db = await new DataSource({
            type: 'sqljs',
            entities: [bucketSchema],
            synchronize: true,
        }).initialize();
        providerCalls = 0;
        freeCalls = 0;
        freeFailure = false;
        liveFree = false;
        proxyUnavailable = false;
        whoisAvailable = false;
        vendorFailure = false;
        sourceIp = '8.8.8.8';
        lastCacheControl = undefined;
        enabled = new Map([
            ['http-store-a', true],
            ['http-store-b', false],
        ]);
        const contexts = {
            create: (options: { channelOrToken: Channel }) =>
                Promise.resolve(context(options.channelOrToken.code)),
        };
        const content = {
            findPublished: (ctx: RequestContext) =>
                Promise.resolve(
                    enabled.get(ctx.channel.code)
                        ? [
                              {
                                  type: 'CLIENT_PLUGINS',
                                  items: [
                                      {
                                          enabled: true,
                                          settings: { pluginCode: 'environment-monitor-entry' },
                                      },
                                  ],
                              },
                          ]
                        : [],
                ),
        };
        const admission = new StorefrontClientPluginAccessService(
            contexts as unknown as RequestContextService,
            content as unknown as StorefrontContentService,
        );
        const budgets = new ShopAbuseStore({ rawConnection: db } as TransactionalConnection);
        const activation = {
            assertActive: () => Promise.resolve(undefined),
        } as unknown as StorefrontActivationService;
        const resolver = new EnvironmentMonitorResolver(
            new EnvironmentMonitorService(admission, activation, budgets),
        );
        server = createServer((incomingRequest, incomingResponse) => {
            void (async (req, res) => {
                const chunks: Buffer[] = [];
                for await (const chunk of req) chunks.push(Buffer.from(chunk));
                const body = JSON.parse(Buffer.concat(chunks).toString());
                const code = String(req.headers['vendure-token'] || 'http-store-a');
                // This is the synthetic trusted address of the loopback fixture; forwarding headers do not select it.
                const request = Object.assign(req, { ip: sourceIp }) as unknown as ExpressRequest;
                const rootValue = {
                    environmentNetworkReport: (args: { observedIpv4?: string; observedIpv6?: string }) =>
                        resolver.environmentNetworkReport(
                            context(code),
                            request,
                            res as unknown as ExpressResponse,
                            args.observedIpv4,
                            args.observedIpv6,
                        ),
                };
                const result = await graphql({
                    schema,
                    source: body.query,
                    variableValues: body.variables,
                    rootValue,
                });
                lastCacheControl = res.getHeader('Cache-Control')?.toString();
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(result));
            })(incomingRequest, incomingResponse).catch(() => {
                incomingResponse.statusCode = 500;
                incomingResponse.end('Local verification request failed');
            });
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Loopback address missing');
        origin = `http://127.0.0.1:${address.port}`;
        vi.stubEnv('ENVIRONMENT_MONITOR_IPQS_KEY', '');
        vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
            const url = new URL(String(input), origin);
            if (url.hostname === 'ipqualityscore.com') {
                providerCalls++;
                expect(url.searchParams.get('ip')).toBe(sourceIp);
                expect(new Headers(init?.headers).has('IPQS-KEY')).toBe(true);
                if (vendorFailure) return Promise.reject(new Error('synthetic upstream failure'));
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            success: true,
                            country_code: 'US',
                            timezone: 'America/New_York',
                            zip_code: '00123',
                            fraud_score: 0,
                            vpn: false,
                            proxy: false,
                            connection_type: 'residential',
                        }),
                    ),
                );
            }
            if (url.hostname === 'ip.guide') {
                if (liveFree) return Promise.resolve(nativeFetch(url, init));
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            ip: sourceIp,
                            location: {
                                country: 'United States',
                                city: 'Synthetic city',
                                timezone: 'America/New_York',
                                latitude: 40.7,
                                longitude: -74,
                            },
                        }),
                    ),
                );
            }
            if (url.hostname === 'free.freeipapi.com') {
                // All location data in this suite is synthetic, including the postcode.
                if (proxyUnavailable) return Promise.reject(new Error('synthetic proxy provider outage'));
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            ipAddress: sourceIp,
                            ipVersion: 4,
                            zipCode: '00123',
                            countryCode: 'US',
                            countryName: 'United States',
                            cityName: 'Synthetic city',
                            latitude: 40.7,
                            longitude: -74,
                            isProxy: false,
                        }),
                    ),
                );
            }
            if (url.hostname === 'ipwho.is') {
                if (!whoisAvailable)
                    return Promise.reject(new Error('synthetic postal fallback unavailable'));
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            success: true,
                            ip: sourceIp,
                            postal: '00123',
                            country: 'United States',
                            country_code: 'US',
                            city: 'Synthetic city',
                            timezone: { id: 'America/New_York' },
                            latitude: 40.7,
                            longitude: -74,
                        }),
                    ),
                );
            }
            if (url.hostname === 'ip-db.com') {
                if (liveFree) return Promise.resolve(nativeFetch(url, init));
                freeCalls++;
                if (freeFailure) return Promise.reject(new Error('synthetic free service outage'));
                if (typeof init?.body !== 'string') throw new Error('Expected JSON request body');
                const body = JSON.parse(init.body);
                if (body.method === 'initialize')
                    return Promise.resolve(
                        new Response(JSON.stringify({ result: { protocolVersion: '2025-03-26' } })),
                    );
                if (body.method === 'notifications/initialized')
                    return Promise.resolve(new Response(null, { status: 202 }));
                expect(body.params).toEqual({ name: 'check_ip', arguments: { ip: sourceIp } });
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            result: {
                                structuredContent: {
                                    ip: sourceIp,
                                    score: 0,
                                    country_code: 'US',
                                    network_type: 'datacenter',
                                    organization: 'Synthetic HTTP owner',
                                    asn: 64500,
                                },
                            },
                        }),
                    ),
                );
            }
            if (url.origin !== origin)
                return Promise.reject(new Error('Unexpected non-loopback network request'));
            return Promise.resolve(nativeFetch(url, init));
        });
    });
    it.runIf(process.env.ENVIRONMENT_MONITOR_LIVE_IPDB_CHECK === '1')(
        'reads live keyless data through the complete local HTTP chain using a fixed public test IP',
        async () => {
            liveFree = true;
            sourceIp = '8.8.8.8';
            const report = await requestEnvironmentNetworkReport(client());
            expect(report.provider).toBe('IPDB');
            expect(report.maskedIp).toBe('8.8.*.*');
            expect(report.countryCode).toBe('US');
            expect(report.ip).toBe('8.8.8.8');
            expect(report.geoProvider).toBe('IPGUIDE');
            expect(typeof report.fraudScore).toBe('number');
            expect(report.fraudScore).toBeGreaterThanOrEqual(0);
            expect(report.fraudScore).toBeLessThanOrEqual(100);
            expect(lastCacheControl).toBe('no-store');
        },
    );
    afterEach(async () => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        server?.closeAllConnections();
        if (server) await new Promise<void>(resolve => server.close(() => resolve()));
        if (db?.isInitialized) await db.destroy();
    });

    it('works without an account key through the keyless provider and SQL admission', async () => {
        await expect(requestEnvironmentNetworkReport(client())).resolves.toMatchObject({
            provider: 'IPDB',
            ip: '8.8.8.8',
            maskedIp: '8.8.*.*',
            fraudScore: 0,
            proxy: false,
            vpn: null,
        });
        expect(providerCalls).toBe(0);
        expect(lastCacheControl).toBe('no-store');
        expect(freeCalls).toBe(3);
        // Trusted client admission, daily lookup quota, postal minute and short-burst budgets.
        expect(await db.getRepository(ShopAbuseBucket).count()).toBe(4);
    });
    it('shares the free daily budget across shops, allows cache hits and never invents a score when exhausted', async () => {
        vi.stubEnv('ENVIRONMENT_MONITOR_FREE_DAILY_LIMIT', '1');
        const api = client();
        expect((await requestEnvironmentNetworkReport(api)).cached).toBe(false);
        expect((await requestEnvironmentNetworkReport(api)).cached).toBe(true);
        expect(freeCalls).toBe(3);
        enabled.set('http-store-b', true);
        sourceIp = '1.1.1.1';
        expect(await requestEnvironmentNetworkReport(client('http-store-b'))).toMatchObject({
            ip: '1.1.1.1',
            lookupIssue: 'DAILY_LIMIT',
            provider: 'REQUEST',
            fraudScore: null,
            proxy: null,
        });
        expect(freeCalls).toBe(3);
        expect(providerCalls).toBe(0);
        sourceIp = '8.8.8.8';
        expect((await requestEnvironmentNetworkReport(api)).cached).toBe(true);
    });
    it('admits the 900th new lookup, blocks the 901st without vendor calls, and recovers when the 24h window expires', async () => {
        vi.stubEnv('ENVIRONMENT_MONITOR_FREE_DAILY_LIMIT', '');
        const bucket = createHash('sha256').update('environment-monitor:free:daily').digest('hex');
        const repository = db.getRepository(ShopAbuseBucket);
        // Seed only this isolated SQL database; no real upstream quota is consumed.
        await repository.insert({
            bucket,
            attempts: 899,
            expiresAt: new Date(Date.now() + 86_400_000),
            blockedUntil: null,
        });
        const api = client();
        expect(await requestEnvironmentNetworkReport(api)).toMatchObject({ provider: 'IPDB', cached: false });
        expect((await repository.findOneByOrFail({ bucket })).attempts).toBe(900);
        expect(freeCalls).toBe(3);
        sourceIp = '1.1.1.1';
        expect(await requestEnvironmentNetworkReport(api)).toMatchObject({
            lookupIssue: 'DAILY_LIMIT',
            fraudScore: null,
        });
        expect(freeCalls).toBe(3);
        expect(providerCalls).toBe(0);
        expect((await repository.findOneByOrFail({ bucket })).attempts).toBe(900);
        await repository.update({ bucket }, { expiresAt: new Date(Date.now() - 1_000) });
        expect(await requestEnvironmentNetworkReport(api)).toMatchObject({
            provider: 'IPDB',
            lookupIssue: null,
        });
        expect((await repository.findOneByOrFail({ bucket })).attempts).toBe(1);
        expect(freeCalls).toBe(6);
    });
    it('transports distinct browser IPv4/IPv6 through GraphQL and returns an actual provider postcode field', async () => {
        const report = await requestEnvironmentNetworkReport(client(), undefined, () =>
            Promise.resolve({
                ipv4: '8.8.8.8',
                ipv6: '2001:4860:4860::8888',
            }),
        );
        expect(report).toMatchObject({
            ip: '8.8.8.8',
            ipv4: '8.8.8.8',
            ipv6: '2001:4860:4860::8888',
            addressSource: 'BROWSER',
            postalCode: '00123',
            geoProvider: 'FREEIPAPI',
        });
        expect(lastCacheControl).toBe('no-store');
    });
    it('keeps connection metadata usable during a keyless provider outage', async () => {
        freeFailure = true;
        await expect(requestEnvironmentNetworkReport(client())).resolves.toMatchObject({
            provider: 'REQUEST',
            ip: '8.8.8.8',
            maskedIp: '8.8.*.*',
            fraudScore: null,
        });
        expect(providerCalls).toBe(0);
        expect(freeCalls).toBe(1);
    });
    it('refreshes a partial network report immediately after recovery and caches only the complete result', async () => {
        const api = client();
        whoisAvailable = true;
        proxyUnavailable = true;
        const first = await requestEnvironmentNetworkReport(api);
        expect(first).toMatchObject({ postalCode: '00123', proxy: null, fraudScore: 0, cached: false });
        proxyUnavailable = false;
        const recovered = await requestEnvironmentNetworkReport(api);
        expect(recovered).toMatchObject({ postalCode: '00123', proxy: false, fraudScore: 0, cached: false });
        expect(freeCalls).toBe(6);
        expect((await requestEnvironmentNetworkReport(api)).cached).toBe(true);
        expect(freeCalls).toBe(6);
        expect(lastCacheControl).toBe('no-store');
    });
    it('enforces current published shop admission before returning even a cached extended report', async () => {
        vi.stubEnv('ENVIRONMENT_MONITOR_IPQS_KEY', 'synthetic-http-placeholder');
        const api = client();
        await expect(requestEnvironmentNetworkReport(api)).resolves.toMatchObject({
            provider: 'IPQS',
            fraudScore: 0,
            vpn: false,
            tor: null,
        });
        await requestEnvironmentNetworkReport(api);
        expect(providerCalls).toBe(1);
        enabled.set('http-store-a', false);
        await expect(requestEnvironmentNetworkReport(api)).rejects.toThrow('尚未开启');
        await expect(requestEnvironmentNetworkReport(client('http-store-b'))).rejects.toThrow('尚未开启');
        expect(providerCalls).toBe(1);
        expect(lastCacheControl).toBe('no-store');
    });
    it('limits real HTTP calls through the existing atomic SQL store', async () => {
        const api = client();
        for (let index = 0; index < 5; index++) await requestEnvironmentNetworkReport(api);
        await expect(requestEnvironmentNetworkReport(api)).rejects.toThrow('RATE_LIMIT');
        expect(providerCalls).toBe(0);
        expect((await db.getRepository(ShopAbuseBucket).find())[0].attempts).toBe(5);
    });
    it('propagates extended lookup failure without fabricating an IP reputation score', async () => {
        vi.stubEnv('ENVIRONMENT_MONITOR_IPQS_KEY', 'synthetic-http-placeholder');
        vendorFailure = true;
        await expect(requestEnvironmentNetworkReport(client())).resolves.toMatchObject({
            ip: '8.8.8.8',
            lookupIssue: 'UNAVAILABLE',
            fraudScore: null,
        });
        expect(providerCalls).toBe(1);
        expect(lastCacheControl).toBe('no-store');
    });
    it('rejects non-public addresses and arbitrary lookup arguments', async () => {
        sourceIp = '127.0.0.1';
        await expect(requestEnvironmentNetworkReport(client())).rejects.toThrow('ADDRESS_UNAVAILABLE');
        await expect(
            client().request('query { environmentNetworkReport(ip: "8.8.8.8") { maskedIp } }'),
        ).rejects.toThrow('Unknown argument');
        expect(providerCalls).toBe(0);
    });
});
