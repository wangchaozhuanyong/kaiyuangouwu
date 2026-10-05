import {
    CountryService,
    CurrencyCode,
    Customer,
    CustomerService,
    LanguageCode,
    Order,
    PaymentMethod,
    PaymentMethodService,
    PaymentService,
    RequestContext,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

import { CheckoutResourcesService } from '../../commerce-fulfillment-plugin/src/checkout-resources.service';
export function registerPaymentCustomerAcceptance(
    state: () => {
        server: any;
        connection: TransactionalConnection;
        platform: RequestContext;
        a: RequestContext;
        b: RequestContext;
    },
) {
    it('uses one platform payment with independent switches and gates actual payment creation', async () => {
        const { server, connection, platform, a, b } = state();
        const methods: PaymentMethodService = server.app.get(PaymentMethodService);
        const method = await connection.withTransaction(platform, tx =>
            methods.create(tx, {
                code: 'controlled-test-payment-platform',
                enabled: true,
                handler: {
                    code: 'controlled-test-payment-handler',
                    arguments: [
                        { name: 'channelId', value: String(platform.channelId) },
                        { name: 'allowAllOrders', value: 'true' },
                    ],
                },
                checker: { code: 'controlled-test-payment-checker', arguments: [] },
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Platform test payment',
                        description: 'Synthetic',
                    },
                    { languageCode: LanguageCode.zh_Hans, name: '平台测试支付', description: 'Synthetic' },
                ],
            }),
        );
        expect((await methods.getStorePaymentOptions(a)).some(m => m.id === method.id && !m.enabled)).toBe(
            true,
        );
        await methods.setStorePaymentOptionEnabled(a, method.id, true);
        await methods.setStorePaymentOptionEnabled(b, method.id, true);
        await methods.setStorePaymentOptionEnabled(a, method.id, false);
        expect(await methods.getActivePaymentMethods(a)).toHaveLength(0);
        const shopB = new RequestContext({
            apiType: 'shop',
            channel: b.channel,
            currencyCode: CurrencyCode.USD,
            languageCode: LanguageCode.en,
            isAuthorized: true,
            authorizedAsOwnerOnly: true,
        });
        expect((await methods.getActivePaymentMethods(shopB)).map(m => m.id)).toContain(method.id);
        expect((await methods.findOne(b, method.id))?.handler.args).toEqual([]);
        expect((await methods.findAll(b)).items[0].handler.args).toEqual([]);
        await expect(methods.update(b, { id: method.id, enabled: false })).rejects.toThrow('平台管理中心');
        const order = await connection.rawConnection.getRepository(Order).save(
            new Order({
                code: `PAY-${randomUUID()}`,
                state: 'ArrangingPayment',
                active: true,
                salesChannelId: b.channelId,
                channels: [b.channel],
                currencyCode: CurrencyCode.USD,
                couponCodes: [],
                shippingAddress: {},
                billingAddress: {},
                subTotal: 1200,
                subTotalWithTax: 1200,
                lines: [],
                payments: [],
            }),
        );
        expect(
            (await methods.getEligiblePaymentMethods(shopB, order)).some(
                m => m.code === method.code && m.isEligible,
            ),
        ).toBe(true);
        const payments: PaymentService = server.app.get(PaymentService);
        await expect(payments.createPayment(shopB, order, 1200, method.code, {})).rejects.toThrow(
            '结算占用已失效',
        );
        const resources: CheckoutResourcesService = server.app.get(CheckoutResourcesService);
        await connection.withTransaction(shopB, tx => resources.reserve(tx, order, []));
        expect((await resources.hold(shopB, order.id))?.state).toBe('HELD');
        expect(
            await connection.withTransaction(shopB, tx =>
                payments.createPayment(tx, order, 1200, method.code, {}),
            ),
        ).toMatchObject({ state: 'Settled', amount: 1200 });
        await methods.setStorePaymentOptionEnabled(b, method.id, false);
        await expect(
            server.app.get(PaymentService).createPayment(shopB, order, 1200, method.code, {}),
        ).rejects.toThrow();
        expect((await methods.getMethodAndOperations(shopB, method.code, true)).paymentMethod.id).toBe(
            method.id,
        );
        await methods.setStorePaymentOptionEnabled(b, method.id, true);
        await methods.update(platform, { id: method.id, enabled: false });
        expect(await methods.getActivePaymentMethods(shopB)).toHaveLength(0);
        expect((await methods.getStorePaymentOptions(b)).find(m => m.id === method.id)).toMatchObject({
            enabled: true,
            platformEnabled: false,
            effectiveEnabled: false,
        });
        expect(await methods.getActivePaymentMethods(platform)).toHaveLength(0);
        expect(
            await connection.rawConnection
                .getRepository(PaymentMethod)
                .count({ where: { code: method.code } }),
        ).toBe(1);
    });
    it('protects shared customer identity and addresses while retaining platform and owner writes', async () => {
        const { server, connection, platform, a, b } = state();
        const customers: CustomerService = server.app.get(CustomerService);
        const user = await connection.rawConnection.getRepository(User).save(
            new User({
                identifier: `customer-${randomUUID()}@example.invalid`,
                verified: true,
                roles: [],
            }),
        );
        const customer = await connection.rawConnection.getRepository(Customer).save(
            new Customer({
                firstName: 'Shared',
                lastName: 'Customer',
                emailAddress: user.identifier,
                user,
                channels: [platform.channel, a.channel, b.channel],
            }),
        );
        await expect(customers.update(a, { id: customer.id, firstName: 'Store overwrite' })).rejects.toThrow(
            '共享客户',
        );
        await expect(customers.softDelete(b, customer.id)).rejects.toThrow('共享客户');
        const countries = await server.app.get(CountryService).findAll(platform);
        const address = await customers.createAddress(platform, customer.id, {
            streetLine1: 'Synthetic address',
            countryCode: countries.items[0].code,
        });
        await expect(customers.updateAddress(a, { id: address.id, streetLine1: 'Other' })).rejects.toThrow(
            '共享客户',
        );
        await expect(customers.deleteAddress(b, address.id)).rejects.toThrow('共享客户');
        await expect(
            customers.createAddress(b, customer.id, {
                streetLine1: 'Other',
                countryCode: countries.items[0].code,
            }),
        ).rejects.toThrow('共享客户');
        const owner = new RequestContext({
            apiType: 'shop',
            channel: b.channel,
            languageCode: LanguageCode.en,
            isAuthorized: true,
            authorizedAsOwnerOnly: true,
            session: { user: { id: user.id, channelPermissions: [] } } as any,
        });
        await customers.update(owner, { id: customer.id, firstName: 'Owner' });
        await customers.updateAddress(owner, { id: address.id, streetLine1: 'Owner address' });
        expect((await customers.findOne(a, customer.id))?.firstName).toBe('Owner');
        await customers.update(platform, { id: customer.id, lastName: 'Platform maintained' });
        const anonymous = new RequestContext({
            apiType: 'shop',
            channel: a.channel,
            languageCode: LanguageCode.en,
            isAuthorized: true,
            authorizedAsOwnerOnly: true,
        });
        expect(
            (
                (await customers.createOrUpdate(anonymous, {
                    emailAddress: customer.emailAddress,
                    firstName: 'Anonymous overwrite',
                })) as Customer
            ).firstName,
        ).toBe('Owner');
    });
}
