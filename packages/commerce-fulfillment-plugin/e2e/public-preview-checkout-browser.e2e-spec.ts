import {
    Allocation,
    ConfigService,
    Country,
    CountryService,
    Customer,
    CustomerService,
    FulfillmentLine,
    LanguageCode,
    Order,
    Payment,
    Permission,
    Release,
    RoleService,
    Sale,
    StockLevel,
} from '@vendure/core';
import { writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

import { CouponLedgerEntry } from '../../store-management-plugin/src/entities/coupon-ledger-entry.entity';
import { CouponOrderAllocation } from '../../store-management-plugin/src/entities/coupon-order-allocation.entity';
import { CustomerCoupon } from '../../store-management-plugin/src/entities/customer-coupon.entity';
import { StoreCommerceSettingsService } from '../../store-management-plugin/src/store-commerce-settings.service';
import { StorefrontCartCheckout } from '../../storefront-cart-plugin/src/entities/storefront-cart-checkout.entity';
import { StorefrontCart } from '../../storefront-cart-plugin/src/entities/storefront-cart.entity';
import {
    CheckoutResourceHold,
    DigitalOrderReservation,
    DigitalVariantConfig,
} from '../src/entities/digital-product.entity';
import { ManualDigitalDelivery } from '../src/entities/manual-digital-delivery.entity';

// Importing this fixture registers its existing three native simulations and shared Nest setup.
import { previewSimulationFixture } from './public-preview-simulation.e2e-spec';

const reportPath = resolve(
    __dirname,
    '../../../docs/public-preview-closure-20261006/browser-checkout-backend-acceptance.json',
);
const mysql = process.env.DB === 'mysql' && process.env.ORDER_CLOSURE_MYSQL === '1';

it(
    'accepts a naturally prepared browser checkout and controlled native payment without seeded order state',
    async () => {
        const fixture = previewSimulationFixture();
        const {
            server,
            connection,
            adminCtx,
            ctx,
            resources,
            physicalId,
            digitalId,
            digitalConfigId,
            couponCampaignId,
        } = fixture;
        const configuredIdentity = server.app.get(ConfigService).entityOptions.entityIdStrategy;
        if (!configuredIdentity) throw new Error('Browser preview fixture requires an entity ID strategy');
        const identity = configuredIdentity;
        const email = 'synthetic-browser-preview@example.invalid';
        // Match the existing native cart-checkout fixture's customer channel provisioning.
        // Owner cart APIs can work without it, but authenticated coupon/delivery APIs cannot.
        const roles = server.app.get(RoleService);
        await roles.assignRoleToChannel(adminCtx, (await roles.getCustomerRole(adminCtx)).id, ctx.channelId);
        const customer = await server.app.get(CustomerService).create(
            adminCtx,
            {
                firstName: 'Synthetic',
                lastName: 'Browser Preview',
                emailAddress: email,
            },
            'local-checkout-fixture',
        );
        if (!('id' in customer)) throw new Error(customer.message);
        const provisioned = await connection.getRepository(adminCtx, Customer).findOneOrFail({
            where: { id: customer.id },
            relations: ['user', 'user.roles', 'user.roles.channels'],
        });
        expect(
            provisioned.user?.roles.some(
                role =>
                    role.permissions.includes(Permission.Authenticated) &&
                    role.channels.some(channel => String(channel.id) === String(ctx.channelId)),
            ),
            'The synthetic customer must be authenticated on its actual checkout channel',
        ).toBe(true);
        // The imported native simulations did not exercise a delivery destination. Ensure
        // this isolated browser fixture has its selected country through the real service.
        if (!(await connection.getRepository(adminCtx, Country).findOneBy({ code: 'GB' }))) {
            await server.app.get(CountryService).create(adminCtx, {
                code: 'GB',
                enabled: true,
                translations: [
                    { languageCode: LanguageCode.zh_Hans, name: '合成英国测试区域' },
                    { languageCode: LanguageCode.en, name: 'Synthetic United Kingdom' },
                ],
            });
        }
        const commerce = server.app.get(StoreCommerceSettingsService);
        const previous = await commerce.get(adminCtx);
        await connection.withTransaction(adminCtx, tx =>
            commerce.update(tx, {
                expectedUpdatedAt: previous.updatedAt,
                pricesIncludeTax: false,
                countryCode: 'GB',
                taxRate: 0,
                shippingMethodNameZh: '本地合成配送',
                shippingMethodNameEn: 'Synthetic local delivery',
                shippingDescriptionZh: '本地隔离验证，不实际发货',
                shippingDescriptionEn: 'Isolated local acceptance, no shipment',
                baseRate: 0,
                freeShippingThreshold: 0,
                shippingTaxRate: 0,
                shippingPriceIncludesTax: false,
                estimateMinDays: 1,
                estimateMaxDays: 3,
                blockedPostalPrefixes: '',
            }),
        );
        let preparedProof: { phase: Order['state']; orderId: string } | undefined;
        let settlementVerified = false;
        let finish!: () => void;
        const completion = new Promise<void>(done => {
            finish = done;
        });

        async function snapshot() {
            const order = await connection.getRepository(ctx, Order).findOne({
                where: { customer: { id: (customer as Customer).id }, salesChannelId: ctx.channelId },
                order: { id: 'DESC' },
                relations: ['lines', 'lines.productVariant', 'payments', 'shippingLines'],
            });
            if (!order)
                return { phase: 'WAITING_FOR_BROWSER', preparedObserved: Boolean(preparedProof) } as const;
            const physical = order.lines.find(line => String(line.productVariantId) === String(physicalId));
            const digital = order.lines.find(line => String(line.productVariantId) === String(digitalId));
            const hold = await connection
                .getRepository(ctx, CheckoutResourceHold)
                .findOneBy({ orderId: order.id });
            const reservation = digital
                ? await connection
                      .getRepository(ctx, DigitalOrderReservation)
                      .findOneBy({ orderLineId: digital.id })
                : null;
            const coupon = await connection
                .getRepository(ctx, CustomerCoupon)
                .findOneBy({ customerId: (customer as Customer).id, promotionId: couponCampaignId });
            const allocation = coupon
                ? await connection
                      .getRepository(ctx, CouponOrderAllocation)
                      .findOneBy({ orderId: order.id, customerCouponId: coupon.id })
                : null;
            const stock = await connection
                .getRepository(ctx, StockLevel)
                .findOneByOrFail({ productVariantId: physicalId });
            const digitalConfig = await connection
                .getRepository(ctx, DigitalVariantConfig)
                .findOneByOrFail({ id: digitalConfigId });
            const cart = await connection.getRepository(ctx, StorefrontCart).findOne({
                where: {
                    channelId: ctx.channelId,
                    ownerType: 'CUSTOMER',
                    ownerId: (customer as Customer).id,
                },
                relations: ['lines'],
            });
            const checkout = await connection
                .getRepository(ctx, StorefrontCartCheckout)
                .findOneBy({ orderId: order.id });
            return {
                phase: order.state,
                orderId: String(identity.encodeId(order.id)),
                preparedObserved: Boolean(preparedProof),
                customerId: String((customer as Customer).id),
                currencyCode: order.currencyCode,
                totalWithTax: order.totalWithTax,
                quantity: order.totalQuantity,
                physicalLineId: physical?.id,
                digitalLineId: digital?.id,
                deliveryEmail: order.customFields.deliveryEmail,
                shippingLineCount: order.shippingLines.length,
                couponCodes: order.couponCodes,
                holdState: hold?.state,
                outstandingPhysical: physical ? await resources.outstandingAllocation(ctx, physical.id) : 0,
                stockAllocated: stock.stockAllocated,
                digitalAvailable: digitalConfig.availableQuantity,
                digitalReservation: reservation
                    ? {
                          state: reservation.state,
                          consumed: reservation.consumedQuantity,
                          released: reservation.releasedQuantity,
                      }
                    : null,
                coupon: coupon
                    ? {
                          id: coupon.id,
                          status: coupon.status,
                          lockedOrderId: coupon.lockedOrderId,
                          usedAt: coupon.usedAt,
                      }
                    : null,
                couponAllocation: allocation
                    ? { status: allocation.status, usedAt: allocation.usedAt }
                    : null,
                cart: cart
                    ? {
                          state: cart.state,
                          checkoutOrderId: cart.checkoutOrderId,
                          quantity: cart.lines.reduce((quantity, line) => quantity + line.quantity, 0),
                      }
                    : null,
                checkout: checkout
                    ? { state: checkout.state, completed: Boolean(checkout.completedAt) }
                    : null,
                payments: order.payments.map(payment => ({
                    state: payment.state,
                    testPayment: payment.metadata?.public?.testPayment === true,
                })),
            };
        }
        async function confirmPrepared(orderId: string) {
            const proof = await snapshot();
            expect(proof).toMatchObject({
                phase: 'ArrangingPayment',
                orderId,
                currencyCode: 'GBP',
                quantity: 2,
                shippingLineCount: 1,
                holdState: 'HELD',
                outstandingPhysical: 1,
                stockAllocated: 1,
                digitalAvailable: 2,
                digitalReservation: { state: 'HELD', consumed: 0, released: 0 },
                coupon: { status: 'LOCKED', usedAt: null },
                couponAllocation: { status: 'LOCKED', usedAt: null },
                cart: { state: 'PAYMENT_PENDING', quantity: 2 },
                checkout: { state: 'PREPARED', completed: false },
                payments: [],
            });
            if (!('totalWithTax' in proof)) throw new Error('Browser did not create an order');
            expect(proof.totalWithTax).toBeGreaterThan(0);
            expect(proof.deliveryEmail).toMatch(/@example\.invalid$/);
            expect(proof.couponCodes).toHaveLength(1);
            preparedProof = proof as { phase: Order['state']; orderId: string };
            return proof;
        }
        async function confirmSettled() {
            expect(preparedProof, 'The actual browser must prepare the order before payment').toBeDefined();
            const settled = await snapshot();
            expect(settled).toMatchObject({
                phase: 'PaymentSettled',
                preparedObserved: true,
                currencyCode: 'GBP',
                quantity: 2,
                holdState: 'RELEASED',
                outstandingPhysical: 0,
                stockAllocated: 0,
                digitalAvailable: 3,
                digitalReservation: { state: 'RELEASED', consumed: 0, released: 1 },
                coupon: { status: 'AVAILABLE', lockedOrderId: null, usedAt: null },
                couponAllocation: { status: 'RELEASED', usedAt: null },
                cart: { state: 'OPEN', checkoutOrderId: null, quantity: 0 },
                checkout: { state: 'PLACED', completed: true },
                payments: [{ state: 'Settled', testPayment: true }],
            });
            if (
                !('orderId' in settled) ||
                !settled.physicalLineId ||
                !settled.digitalLineId ||
                !settled.coupon
            )
                throw new Error('Browser checkout resources are incomplete');
            expect(settled.orderId).toBe((preparedProof as typeof settled).orderId);
            const orderId = identity.decodeId(settled.orderId);
            expect(
                await connection.getRepository(ctx, Payment).count({ where: { order: { id: orderId } } }),
            ).toBe(1);
            expect(
                await connection
                    .getRepository(ctx, Allocation)
                    .count({ where: { orderLine: { id: settled.physicalLineId } } }),
            ).toBe(1);
            expect(
                await connection
                    .getRepository(ctx, Release)
                    .count({ where: { orderLine: { id: settled.physicalLineId } } }),
            ).toBe(1);
            expect(
                await connection
                    .getRepository(ctx, Sale)
                    .count({ where: { orderLine: { id: settled.physicalLineId } } }),
            ).toBe(0);
            expect(
                await connection
                    .getRepository(ctx, FulfillmentLine)
                    .count({ where: { orderLineId: settled.digitalLineId } }),
            ).toBe(0);
            expect(
                await connection.getRepository(ctx, ManualDigitalDelivery).count({ where: { orderId } }),
            ).toBe(0);
            expect(
                await connection
                    .getRepository(ctx, CouponLedgerEntry)
                    .count({ where: { customerCouponId: settled.coupon.id, eventType: 'REDEEMED' } }),
            ).toBe(0);
            const report = {
                environment: mysql ? 'disposable-local-mysql' : 'disposable-local-sqljs',
                naturalCheckoutPreparation: preparedProof,
                controlledPaymentSettlement: settled,
                externalCharge: false,
                saleCount: 0,
                realDigitalFulfillmentCount: 0,
                redeemedCouponLedgerCount: 0,
            };
            writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
            return report;
        }
        function json(response: ServerResponse, status: number, value: unknown) {
            response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify(value));
        }
        async function readOrderId(request: IncomingMessage) {
            let body = '';
            for await (const chunk of request) {
                body += String(chunk);
                if (body.length > 1024) throw new Error('Local fixture request is too large');
            }
            return String(JSON.parse(body).orderId ?? '');
        }
        const { createServer } = await import('vite');
        const react = (await import('@vitejs/plugin-react')).default;
        const tailwindcss = (await import('@tailwindcss/vite')).default;
        const frontend = await createServer({
            configFile: false,
            root: resolve(__dirname, '../../storefront'),
            resolve: { dedupe: ['react', 'react-dom'] },
            plugins: [
                tailwindcss(),
                react(),
                {
                    name: 'synthetic-preview-checkout-controls',
                    configureServer(vite) {
                        vite.middlewares.use((request, response, next) => {
                            if (!request.url?.startsWith('/__public-preview-fixture/')) return next();
                            void (async () => {
                                if (request.url === '/__public-preview-fixture/status')
                                    return json(response, 200, await snapshot());
                                if (
                                    request.url === '/__public-preview-fixture/prepared' &&
                                    request.method === 'POST'
                                )
                                    return json(
                                        response,
                                        200,
                                        await confirmPrepared(await readOrderId(request)),
                                    );
                                if (
                                    request.url === '/__public-preview-fixture/finish' &&
                                    request.method === 'POST'
                                ) {
                                    const report = await confirmSettled();
                                    settlementVerified = true;
                                    json(response, 200, {
                                        result: 'PASS',
                                        passed: true,
                                        report: reportPath,
                                        summary: {
                                            naturallyPrepared: report.naturalCheckoutPreparation?.phase,
                                            payment: 'Settled (controlled simulation)',
                                            hold: report.controlledPaymentSettlement.holdState,
                                            coupon: report.controlledPaymentSettlement.coupon?.status,
                                            cart: report.controlledPaymentSettlement.cart?.state,
                                            cartQuantity: report.controlledPaymentSettlement.cart?.quantity,
                                            checkout: report.controlledPaymentSettlement.checkout?.state,
                                            redeemedCouponLedger: report.redeemedCouponLedgerCount,
                                            sale: report.saleCount,
                                            digitalDelivery: report.realDigitalFulfillmentCount,
                                            externalCharge: report.externalCharge,
                                        },
                                        settlement: report.controlledPaymentSettlement,
                                    });
                                    return;
                                }
                                if (
                                    request.url === '/__public-preview-fixture/shutdown' &&
                                    request.method === 'POST'
                                ) {
                                    expect(
                                        settlementVerified,
                                        'Capture the PASS result before shutting down the owned fixture',
                                    ).toBe(true);
                                    json(response, 200, { result: 'PASS', shutdown: true });
                                    finish();
                                    return;
                                }
                                json(response, 404, { message: 'Unknown synthetic fixture control' });
                            })().catch(error =>
                                json(response, 409, {
                                    message:
                                        error instanceof Error
                                            ? error.message
                                            : 'Local fixture assertion failed',
                                }),
                            );
                        });
                    },
                },
            ],
            define: {
                'import.meta.env.VITE_SHOP_API_URL': JSON.stringify('/shop-api'),
                'import.meta.env.VITE_CLIENT_CHANNEL_SWITCHING': JSON.stringify('true'),
            },
            server: {
                host: '127.0.0.1',
                port: 0,
                proxy: { '/shop-api': `http://127.0.0.1:${mysql ? 37488 : 37487}` },
            },
        });
        try {
            await frontend.listen();
            const address = frontend.httpServer?.address();
            if (!address || typeof address === 'string')
                throw new Error('The loopback checkout fixture did not start');
            const params = new URLSearchParams({
                channel: ctx.channel.token,
                storeCode: ctx.channel.code,
                email,
                physical: String(identity.encodeId(physicalId)),
                digital: String(identity.encodeId(digitalId)),
                campaign: String(identity.encodeId(couponCampaignId)),
                currency: 'GBP',
                country: 'GB',
                language: 'en',
                controlledPayment: '1',
            });
            const url = `http://127.0.0.1:${address.port}/e2e/public-preview-checkout/controls.html?${params}`;
            writeFileSync(
                resolve(
                    __dirname,
                    '../../../docs/public-preview-closure-20261006/browser-checkout-ready.json',
                ),
                JSON.stringify({ url, reportPath, synthetic: true }, null, 2) + '\n',
            );
            process.stdout.write(`PUBLIC_PREVIEW_CHECKOUT_READY ${url}\n`);
            await completion;
        } finally {
            await frontend.close();
        }
    },
    20 * 60_000,
);
