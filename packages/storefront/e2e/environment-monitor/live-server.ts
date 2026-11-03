/** Loopback-only integration harness. No production DB, publication, credentials or persistence. */
import { Channel, CurrencyCode, LanguageCode, RequestContext } from '@vendure/core';
import { buildSchema, graphql, print } from 'graphql';
import { createServer } from 'node:http';
import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';

import { ShopAbuseBucket } from '../../../store-management-plugin/src/abuse-protection/entities';
import { ShopAbuseStore } from '../../../store-management-plugin/src/abuse-protection/store';
import {
    EnvironmentMonitorResolver,
    environmentMonitorSchema,
} from '../../../store-management-plugin/src/environment-monitor/environment-monitor.resolver';
import {
    EnvironmentMonitorService,
    isPublicAddress,
} from '../../../store-management-plugin/src/environment-monitor/environment-monitor.service';
import { StorefrontClientPluginAccessService } from '../../../store-management-plugin/src/storefront-client-plugin-access.service';

import { installRecoverySources } from './recovery-sources';
const controlled = process.argv.includes('--controlled-recovery');
if (controlled) process.env.ENVIRONMENT_MONITOR_IPQS_KEY = '';
const bucket = new EntitySchema({
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
const db = await new DataSource({ type: 'sqljs', entities: [bucket], synchronize: true }).initialize();
const recoveryState = controlled ? installRecoverySources() : null;
const channel = new Channel({
    id: 1,
    code: 'environment-local-live',
    token: 'environment-local-live',
    defaultLanguageCode: LanguageCode.en,
    defaultCurrencyCode: CurrencyCode.MYR,
});
const ctx = new RequestContext({
    apiType: 'shop',
    channel,
    languageCode: LanguageCode.en,
    currencyCode: CurrencyCode.MYR,
    isAuthorized: true,
    authorizedAsOwnerOnly: false,
});
const access = new StorefrontClientPluginAccessService(
    { create: () => Promise.resolve(ctx) } as never,
    {
        findPublished: () =>
            Promise.resolve([
                {
                    type: 'CLIENT_PLUGINS',
                    enabled: true,
                    items: [{ enabled: true, settings: { pluginCode: 'environment-monitor-entry' } }],
                },
            ]),
    } as never,
);
const resolver = new EnvironmentMonitorResolver(
    new EnvironmentMonitorService(
        access,
        { assertActive: () => Promise.resolve(undefined) } as never,
        new ShopAbuseStore({ rawConnection: db } as never),
    ),
);
const schema = buildSchema(`type Query { _local: Boolean }\n${print(environmentMonitorSchema)}`);
const server = createServer((incomingRequest, incomingResponse) => {
    void (async (req, res) => {
        const origin = req.headers.origin;
        if (origin && origin !== 'http://127.0.0.1:5193') {
            res.writeHead(403);
            res.end();
            return;
        }
        res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5193');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.url === '/health') {
            if (recoveryState) res.setHeader('Content-Type', 'application/json');
            res.end(recoveryState ? JSON.stringify(recoveryState()) : 'ok');
            return;
        }
        if (req.method !== 'POST' || req.url !== '/shop-api') {
            res.writeHead(404);
            res.end();
            return;
        }
        try {
            let input = '';
            for await (const chunk of req) {
                input += String(chunk);
                if (input.length > 20000) throw new Error('Request too large');
            }
            const body = JSON.parse(input);
            if (body.testScenario !== (controlled ? 'recovery' : 'live'))
                throw new Error('Unexpected test scenario');
            // Loopback cannot supply a customer's public address. This isolated harness requires
            // the browser observation; it never substitutes the Node process's egress. Production
            // admission continues to use the trusted incoming connection (not these variables).
            const observed = body.variables?.observedIpv4 ?? body.variables?.observedIpv6;
            if (typeof observed !== 'string' || !isPublicAddress(observed))
                throw new Error('ENVIRONMENT_NETWORK_ADDRESS_UNAVAILABLE');
            if (controlled && (observed !== '8.8.8.8' || body.variables?.observedIpv6))
                throw new Error('Unexpected synthetic address');
            const request = Object.assign(req, { ip: observed });
            const result = await graphql({
                schema,
                source: body.query,
                variableValues: body.variables,
                rootValue: {
                    environmentNetworkReport: (args: { observedIpv4?: string; observedIpv6?: string }) =>
                        resolver.environmentNetworkReport(
                            ctx,
                            request as never,
                            res as never,
                            args.observedIpv4,
                            args.observedIpv6,
                        ),
                },
            });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
        } catch {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ errors: [{ message: 'ENVIRONMENT_NETWORK_UNAVAILABLE' }] }));
        }
    })(incomingRequest, incomingResponse).catch(() => {
        incomingResponse.statusCode = 500;
        incomingResponse.end('Local verification request failed');
    });
});
const port = controlled ? 3198 : 3197;
server.listen(port, '127.0.0.1', () =>
    process.stdout.write(
        `Environment ${controlled ? 'synthetic recovery' : 'live'} harness: http://127.0.0.1:${port} (isolated in-memory SQL)` +
            '\n',
    ),
);
const close = () => server.close(() => void db.destroy().then(() => process.exit(0)));
process.once('SIGTERM', close);
process.once('SIGINT', close);
