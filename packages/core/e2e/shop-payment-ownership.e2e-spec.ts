import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import {
    ChannelService,
    Customer,
    isGraphQlErrorResult,
    mergeConfig,
    Order,
    OrderService,
    PaymentMethodHandler,
    PaymentMethodService,
    RequestContext,
    RequestContextService,
    Role,
    SessionService,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

// Local synthetic payment only: no provider, real customer, fulfillment or production access.
const paymentCalls: Array<{ userId: string | undefined; ownerOnly: boolean }> = [];
const handler = new PaymentMethodHandler({
    code: 'shop-payment-owner-fixture',
    description: [{ languageCode: LanguageCode.en, value: 'Local payment ownership regression' }],
    args: {},
    createPayment: (ctx, _order, amount) => {
        paymentCalls.push({ userId: ctx.activeUserId?.toString(), ownerOnly: ctx.authorizedAsOwnerOnly });
        return { amount, state: 'Settled', transactionId: `local-owner-fixture-${paymentCalls.length}` };
    },
    settlePayment: () => ({ success: true }),
});
const config = mergeConfig(testConfig(), {
    apiOptions: { port: 37397, hostname: '127.0.0.1' },
    paymentOptions: { paymentMethodHandlers: [handler] },
});
registerInitializer(
    'sqljs',
    new SqljsInitializer(
        path.resolve(__dirname, '../../../docs/local-validation/catalog-payment-fixes-20261017/payment-db'),
    ),
);
const { server, shopClient } = createTestEnvironment(config);
const payment = gql`
    mutation {
        addPaymentToOrder(input: { method: "shop-payment-owner-fixture", metadata: {} }) {
            ... on Order {
                id
                state
                payments {
                    state
                    amount
                }
            }
            ... on ErrorResult {
                errorCode
            }
        }
    }
`;
let connection: TransactionalConnection;
let context: RequestContext;
let customers: Customer[];
let foreignChannelId: string | number;

beforeAll(async () => {
    await server.init({
        initialData: { ...initialData, collections: [], paymentMethods: [], shippingMethods: [] },
        customerCount: 2,
    });
    connection = server.app.get(TransactionalConnection);
    context = await server.app.get(RequestContextService).create({ apiType: 'admin' });
    customers = await connection.getRepository(context, Customer).find({
        relations: ['user', 'user.roles'],
        order: { id: 'ASC' },
    });
    const superAdminRole = await connection.getRepository(context, Role).findOneByOrFail({
        code: SUPER_ADMIN_ROLE_CODE,
    });
    const dualUser = customers[0].user;
    if (!dualUser) throw new Error('The synthetic customer has no user');
    dualUser.roles.push(superAdminRole);
    await connection.getRepository(context, User).save(dualUser);
    await server.app.get(PaymentMethodService).create(context, {
        code: handler.code,
        enabled: true,
        handler: { code: handler.code, arguments: [] },
        translations: [{ languageCode: LanguageCode.en, name: 'Local fixture', description: '' }],
    });
    const foreign = await server.app.get(ChannelService).create(context, {
        code: 'payment-owner-foreign-fixture',
        token: 'payment-owner-foreign-fixture',
        defaultLanguageCode: LanguageCode.en,
        currencyCode: CurrencyCode.GBP,
        pricesIncludeTax: true,
    });
    if (isGraphQlErrorResult(foreign)) throw new Error(foreign.message);
    foreignChannelId = foreign.id;
}, TEST_SETUP_TIMEOUT_MS);

afterAll(async () => {
    await server.destroy();
});

describe('Shop payment ownership for users with management roles', () => {
    it.each([
        { name: 'administrator who is also the customer', actor: 'dual', order: 'own', allowed: true },
        { name: 'ordinary customer', actor: 'customer', order: 'own', allowed: true },
        { name: 'guest with a server-bound order', actor: 'guest', order: 'own', allowed: true },
        {
            name: 'administrator pointing at another registered customer',
            actor: 'dual',
            order: 'other',
            allowed: false,
        },
        {
            name: 'administrator pointing at another sales channel',
            actor: 'dual',
            order: 'foreign',
            allowed: false,
        },
        {
            name: 'administrator pointing at an inactive order',
            actor: 'dual',
            order: 'inactive',
            allowed: false,
        },
        { name: 'administrator without an active order', actor: 'dual', order: 'none', allowed: false },
    ] as const)('$name', async test => {
        const sessions = server.app.get(SessionService);
        const buyer = test.actor === 'customer' ? customers[1] : customers[0];
        if (test.actor === 'guest') {
            const guestSession = await sessions.createAnonymousSession();
            shopClient.setAuthToken(guestSession.token);
        } else {
            // "test" is the existing generated-customer fixture password, never a real credential.
            const loggedIn = await shopClient.asUserWithCredentials(buyer.emailAddress, 'test');
            expect(loggedIn).not.toHaveProperty('errorCode');
        }
        const session = await sessions.getSessionFromToken(shopClient.getAuthToken());
        if (!session) throw new Error('The synthetic Shop session is missing');
        if (test.order === 'none') {
            await sessions.unsetActiveOrder(context, session);
        } else {
            const owner = test.order === 'other' ? customers[1] : buyer;
            const order = await server.app
                .get(OrderService)
                .create(context, test.actor === 'guest' ? undefined : owner.user?.id);
            // Seed only the checkout prerequisite, retaining the real HTTP identity and payment pipeline.
            await connection.getRepository(context, Order).update(order.id, {
                state: 'ArrangingPayment',
                active: test.order !== 'inactive',
                subTotal: 3800,
                subTotalWithTax: 3800,
                salesChannelId: test.order === 'foreign' ? foreignChannelId : context.channelId,
            });
            await sessions.setActiveOrder(context, session, order);
        }
        const callsBefore = paymentCalls.length;
        const result = (await shopClient.query(payment)).addPaymentToOrder;
        if (test.allowed) {
            expect(result).not.toHaveProperty('errorCode');
            expect(result.state).toBe('PaymentSettled');
            expect(result.payments).toEqual([{ state: 'Settled', amount: 3800 }]);
            expect(paymentCalls).toHaveLength(callsBefore + 1);
            expect(paymentCalls.at(-1)?.ownerOnly).toBe(test.actor !== 'dual');
        } else {
            expect(result.errorCode).toBe('NO_ACTIVE_ORDER_ERROR');
            expect(paymentCalls).toHaveLength(callsBefore);
        }
    });
});
