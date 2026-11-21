import express, { json } from 'express';
import { buildSchema, parse, print, validate } from 'graphql';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shopSchema } from './api-extensions';
import { standaloneRechargeApi } from './standalone-api';

describe('standalone recharge HTTP contract', () => {
    let server: Server;
    let origin: string;
    const schema = buildSchema(`scalar DateTime
        type Query { server: String }
        type Mutation { createShopAbuseChallenge(action: String!, target: String!): Challenge }
        type Challenge { id: ID!, imageDataUrl: String!, expiresAt: DateTime! }
        ${print(shopSchema)}`);

    beforeAll(async () => {
        const app = express();
        app.use('/', standaloneRechargeApi('shop-api'));
        app.use(json());
        app.post('/shop-api', (req, res) => res.json(req.body));
        app.post('/storefront-realtime/recharge-events', (req, res) => res.json({ stream: req.body }));
        server = await new Promise(resolve => {
            const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
        });
        origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    });
    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
    });
    const post = (path: string, variables: object) =>
        fetch(origin + path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(variables),
        });

    it.each([
        ['config', {}, 'gptRechargeConfig'],
        ['verify', { code: 'code' }, 'verifyGptRechargeCode'],
        ['query', { code: 'code' }, 'queryGptRechargeCode'],
        ['authorize', { code: 'code', requestKey: 'request' }, 'startGptRechargeAuthorization'],
        ['task', { id: 'id', credential: 'example' }, 'gptRechargeTask'],
        ['challenge', { action: 'RECHARGE_CODE', target: 'code' }, 'createShopAbuseChallenge'],
    ] as const)(
        'dispatches the fixed %s document through the normal Shop API',
        async (action, variables, field) => {
            const response = await post('/api/recharge/' + action, variables);
            expect(response.status).toBe(200);
            const body = await response.json();
            const doc = parse(body.query);
            expect(validate(schema, doc)).toEqual([]);
            expect(body.query).toContain(field);
            expect(body.variables).toEqual(variables);
        },
    );

    it('dispatches events without putting the capability into the URL', async () => {
        const variables = { id: 'id', credential: 'example' };
        expect(await (await post('/api/recharge/events', variables)).json()).toEqual({ stream: variables });
    });
    it('rejects unsupported operations, extra arguments, wrong action families and wrong methods', async () => {
        expect((await post('/api/recharge/products', {})).status).toBe(404);
        expect((await post('/api/recharge/submit', {})).status).toBe(404);
        expect((await post('/api/recharge/config?channel=other', {})).status).toBe(404);
        expect((await post('/api/recharge/config', { query: '{server}' })).status).toBe(400);
        expect((await post('/api/recharge/verify', { code: 'code', session: 'example' })).status).toBe(400);
        expect((await post('/api/recharge/challenge', { action: 'LOGIN', target: 'id' })).status).toBe(400);
        expect((await fetch(origin + '/api/recharge/config')).status).toBe(405);
        expect((await fetch(origin + '/api/recharge/config', { method: 'POST', body: '{}' })).status).toBe(
            415,
        );
    });
    it('preserves other Shop API requests', async () => {
        const original = { query: '{server}' };
        expect(await (await post('/shop-api', original)).json()).toEqual(original);
    });
});
