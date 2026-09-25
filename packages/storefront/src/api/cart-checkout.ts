import type { CartController } from '../cart/cart-controller';
import type { CartCommand, CartCommandResult } from '../cart/cart-intents';
import type {
    CustomerAddressInput,
    CustomerDeliveryEmail,
    Order,
    PaymentMethod,
    ShippingMethod,
    StoreCommerceMode,
    StoreCouponPage,
    StoreCouponPageOptions,
    StoreCouponUsageRecord,
    StoreCustomerCoupon,
    StorefrontCart,
    StorefrontCheckoutSession,
    StorefrontUsdtCheckoutQuote,
} from '../types';

import { cartLineCanSelect } from '../product-availability';

import { BaseDomainApi } from './base-domain-api';
import {
    cartFields,
    cartResultFields,
    checkoutResultFields,
    customerCouponFields,
    orderFields,
} from './fragments';
import { ShopApiError, type ErrorResult } from './helpers';

export class CartCheckoutApi extends BaseDomainApi {
    controller?: CartController;
    private readonly paymentMethodRequests = new Map<
        string,
        { expiresAt: number; promise: Promise<PaymentMethod[]>; data?: PaymentMethod[] }
    >();

    connect(controller: CartController): void {
        this.controller = controller;
        controller.repository.setTransport({
            read: signal => this.readCart(signal),
            apply: command => this.applyCommand(command),
            recover: (id, cancel) => this.recoverCommand(id, cancel),
        });
    }

    private async applyCommand(input: CartCommand): Promise<CartCommandResult> {
        const result = await this.request<{ applyStorefrontCartCommand: CartCommandResult }>(
            `
            mutation ApplyStorefrontCartCommand($input: StorefrontCartCommandInput!) {
                applyStorefrontCartCommand(input: $input) { ${commandResultFields} }
            }`,
            { input },
            undefined,
            20_000,
            true,
        );
        return hydrateCommandResult(result.applyStorefrontCartCommand);
    }

    private async recoverCommand(commandId: string, cancel: boolean): Promise<CartCommandResult> {
        const result = await this.request<{ recoverStorefrontCartCommand: CartCommandResult }>(
            `
            mutation RecoverStorefrontCartCommand($cartId: ID!, $commandId: String!, $cancel: Boolean!) {
                recoverStorefrontCartCommand(cartId: $cartId, commandId: $commandId, cancel: $cancel) { ${commandResultFields} }
            }`,
            { cartId: this.controller?.repository.snapshot?.id, commandId, cancel },
            undefined,
            20_000,
            true,
        );
        return hydrateCommandResult(result.recoverStorefrontCartCommand);
    }

    async cart(signal?: AbortSignal): Promise<StorefrontCart> {
        return this.controller ? this.controller.read() : this.readCart(signal);
    }

    private async readCart(signal?: AbortSignal): Promise<StorefrontCart> {
        const result = await this.request<{ storefrontCart: StorefrontCart }>(
            `
            query StorefrontCart {
                storefrontCart { ${cartFields} }
            }
        `,
            undefined,
            signal,
        );
        return result.storefrontCart;
    }

    async addItem(productVariantId: string, expectedRevision: number, quantity = 1): Promise<StorefrontCart> {
        if (this.controller) {
            const acknowledged = await this.controller.execute({
                changes: { add: [{ productVariantId, quantity }] },
            });
            return acknowledged.cart;
        }
        const result = await this.request<{ addStorefrontCartItem: StorefrontCart & ErrorResult }>(
            `
                mutation AddStorefrontCartItem(
                    $productVariantId: ID!
                    $quantity: Int!
                    $expectedRevision: Int!
                ) {
                    addStorefrontCartItem(
                        input: { productVariantId: $productVariantId, quantity: $quantity }
                        expectedRevision: $expectedRevision
                    ) {
                        ${cartResultFields}
                    }
                }
            `,
            { productVariantId, quantity, expectedRevision },
        );
        return this.assertCart(result.addStorefrontCartItem);
    }

    async setLineQuantity(
        lineId: string,
        quantity: number,
        expectedRevision: number,
    ): Promise<StorefrontCart> {
        if (this.controller) {
            const acknowledged = await this.controller.execute({
                changes: { lines: [{ lineId, quantity }] },
            });
            return acknowledged.cart;
        }
        const result = await this.request<{
            setStorefrontCartLineQuantity: StorefrontCart & ErrorResult;
        }>(
            `
                mutation SetStorefrontCartLineQuantity(
                    $lineId: ID!
                    $quantity: Int!
                    $expectedRevision: Int!
                ) {
                    setStorefrontCartLineQuantity(
                        lineId: $lineId
                        quantity: $quantity
                        expectedRevision: $expectedRevision
                    ) {
                        ${cartResultFields}
                    }
                }
            `,
            { lineId, quantity, expectedRevision },
        );
        return this.assertCart(result.setStorefrontCartLineQuantity);
    }

    async removeLines(lineIds: string[], expectedRevision: number): Promise<StorefrontCart> {
        if (this.controller) {
            const acknowledged = await this.controller.execute({ changes: { remove: lineIds } });
            return acknowledged.cart;
        }
        const result = await this.request<{ removeStorefrontCartLines: StorefrontCart & ErrorResult }>(
            `
                mutation RemoveStorefrontCartLines($lineIds: [ID!]!, $expectedRevision: Int!) {
                    removeStorefrontCartLines(
                        lineIds: $lineIds
                        expectedRevision: $expectedRevision
                    ) {
                        ${cartResultFields}
                    }
                }
            `,
            { lineIds, expectedRevision },
        );
        return this.assertCart(result.removeStorefrontCartLines);
    }

    async setLinesSelected(
        lineIds: string[],
        selected: boolean,
        expectedRevision: number,
    ): Promise<StorefrontCart> {
        if (this.controller) {
            const cart = this.controller.getSnapshot().cart ?? (await this.controller.read());
            const acknowledged = await this.controller.execute({
                changes: {
                    lines: lineIds.map(lineId => ({
                        lineId,
                        selected:
                            selected &&
                            Boolean(cart.lines.find(line => line.id === lineId && cartLineCanSelect(line))),
                    })),
                },
            });
            return acknowledged.cart;
        }
        const result = await this.request<{
            setStorefrontCartLinesSelected: StorefrontCart & ErrorResult;
        }>(
            `
                mutation SetStorefrontCartLinesSelected(
                    $lineIds: [ID!]!
                    $selected: Boolean!
                    $expectedRevision: Int!
                ) {
                    setStorefrontCartLinesSelected(
                        lineIds: $lineIds
                        selected: $selected
                        expectedRevision: $expectedRevision
                    ) {
                        ${cartResultFields}
                    }
                }
            `,
            { lineIds, selected, expectedRevision },
        );
        return this.assertCart(result.setStorefrontCartLinesSelected);
    }

    async setAllLinesSelected(selected: boolean, expectedRevision: number): Promise<StorefrontCart> {
        if (this.controller) {
            const cart = this.controller.getSnapshot().cart ?? (await this.controller.read());
            const lines = cart.lines;
            return (
                await this.controller.execute({
                    changes: {
                        lines: lines.map(line => ({
                            lineId: line.id,
                            selected: selected && cartLineCanSelect(line),
                        })),
                    },
                })
            ).cart;
        }
        const result = await this.request<{
            setAllStorefrontCartLinesSelected: StorefrontCart & ErrorResult;
        }>(
            `
                mutation SetAllStorefrontCartLinesSelected(
                    $selected: Boolean!
                    $expectedRevision: Int!
                ) {
                    setAllStorefrontCartLinesSelected(
                        selected: $selected
                        expectedRevision: $expectedRevision
                    ) {
                        ${cartResultFields}
                    }
                }
            `,
            { selected, expectedRevision },
        );
        return this.assertCart(result.setAllStorefrontCartLinesSelected);
    }

    async beginCheckout(expectedRevision: number): Promise<StorefrontCheckoutSession> {
        if (this.controller) {
            const acknowledged = await this.controller.execute({ beginCheckout: true });
            if (!acknowledged.session) throw new Error('Checkout session is no longer available.');
            return acknowledged.session;
        }
        const result = await this.request<{
            beginStorefrontCheckout: StorefrontCheckoutSession & ErrorResult;
        }>(
            `
                mutation BeginStorefrontCheckout($expectedRevision: Int!) {
                    beginStorefrontCheckout(expectedRevision: $expectedRevision) {
                        ${checkoutResultFields}
                    }
                }
            `,
            { expectedRevision },
        );
        return this.assertCheckoutSession(result.beginStorefrontCheckout);
    }

    async preparePayment(expectedRevision: number): Promise<StorefrontCheckoutSession> {
        if (this.controller) {
            const acknowledged = await this.controller.execute({ preparePayment: true });
            if (!acknowledged.session) throw new Error('Checkout session is no longer available.');
            return acknowledged.session;
        }
        const result = await this.request<{
            prepareStorefrontCartPayment: StorefrontCheckoutSession & ErrorResult;
        }>(
            `
                mutation PrepareStorefrontCartPayment($expectedRevision: Int!) {
                    prepareStorefrontCartPayment(expectedRevision: $expectedRevision) {
                        ${checkoutResultFields}
                    }
                }
            `,
            { expectedRevision },
        );
        return this.assertCheckoutSession(result.prepareStorefrontCartPayment);
    }

    async reopenCart(expectedRevision: number): Promise<StorefrontCart> {
        if (this.controller) {
            const acknowledged = await this.controller.execute({ reopen: true });
            return acknowledged.cart;
        }
        const result = await this.request<{ reopenStorefrontCart: StorefrontCart & ErrorResult }>(
            `
                mutation ReopenStorefrontCart($expectedRevision: Int!) {
                    reopenStorefrontCart(expectedRevision: $expectedRevision) {
                        ${cartResultFields}
                    }
                }
            `,
            { expectedRevision },
        );
        return this.assertCart(result.reopenStorefrontCart);
    }

    async myCouponsPage(
        options: StoreCouponPageOptions = {},
        signal?: AbortSignal,
    ): Promise<StoreCouponPage<StoreCustomerCoupon>> {
        const result = await this.request<{ myStorefrontCouponsPage: StoreCouponPage<StoreCustomerCoupon> }>(
            `query MyStorefrontCouponsPage($options: StoreCouponPageOptions) {
                myStorefrontCouponsPage(options: $options) { items { ${customerCouponFields} } totalItems }
            }`,
            { options },
            signal,
        );
        return result.myStorefrontCouponsPage;
    }

    async myCouponUsageRecordsPage(
        options: StoreCouponPageOptions = {},
        signal?: AbortSignal,
    ): Promise<StoreCouponPage<StoreCouponUsageRecord>> {
        const result = await this.request<{
            myStorefrontCouponUsageRecordsPage: StoreCouponPage<StoreCouponUsageRecord>;
        }>(
            `query MyStorefrontCouponUsageRecordsPage($options: StoreCouponPageOptions) {
                myStorefrontCouponUsageRecordsPage(options: $options) { items {
                id customerCouponId campaignId campaignName campaignKind appearanceTheme status currencyCode
                minimumSpend discountAmount discountRate savedAmount usedAt refundedAt orderId orderCode
            } totalItems } }`,
            { options },
            signal,
        );
        return result.myStorefrontCouponUsageRecordsPage;
    }

    async myAvailableCoupons(signal?: AbortSignal): Promise<StoreCustomerCoupon[]> {
        const items: StoreCustomerCoupon[] = [];
        while (true) {
            const page = await this.myCouponsPage(
                { skip: items.length, take: 200, statuses: ['AVAILABLE', 'RETURNED', 'LOCKED'] },
                signal,
            );
            items.push(...page.items);
            if (!page.items.length || items.length >= page.totalItems) return items;
        }
    }

    async myCoupons(signal?: AbortSignal): Promise<StoreCustomerCoupon[]> {
        const result = await this.request<{ myStorefrontCoupons: StoreCustomerCoupon[] }>(
            `
                query MyStorefrontCoupons {
                    myStorefrontCoupons { ${customerCouponFields} }
                }
            `,
            undefined,
            signal,
        );
        return result.myStorefrontCoupons;
    }

    async myCouponUsageRecords(signal?: AbortSignal): Promise<StoreCouponUsageRecord[]> {
        const result = await this.request<{
            myStorefrontCouponUsageRecords: StoreCouponUsageRecord[];
        }>(
            `
                query MyStorefrontCouponUsageRecords {
                    myStorefrontCouponUsageRecords {
                        id
                        customerCouponId
                        campaignId
                        campaignName
                        campaignKind
                        appearanceTheme
                        status
                        currencyCode
                        minimumSpend
                        discountAmount
                        discountRate
                        savedAmount
                        usedAt
                        refundedAt
                        orderId
                        orderCode
                    }
                }
            `,
            undefined,
            signal,
        );
        return result.myStorefrontCouponUsageRecords;
    }

    async claimCoupon(campaignId: string): Promise<StoreCustomerCoupon> {
        const result = await this.request<{ claimStorefrontCoupon: StoreCustomerCoupon }>(
            `
                mutation ClaimStorefrontCoupon($campaignId: ID!) {
                    claimStorefrontCoupon(campaignId: $campaignId) { ${customerCouponFields} }
                }
            `,
            { campaignId },
        );
        return result.claimStorefrontCoupon;
    }

    async applyCustomerCoupon(id: string): Promise<StoreCustomerCoupon> {
        if (this.controller) {
            await this.controller.execute({ coupon: { action: 'APPLY', couponId: id } });
            const coupon = (await this.myCoupons()).find(item => item.id === id);
            if (!coupon) throw new Error('Coupon details are unavailable.');
            return coupon;
        }
        const result = await this.request<{ applyStorefrontCoupon: StoreCustomerCoupon }>(
            `
                mutation ApplyOwnedStorefrontCoupon($id: ID!) {
                    applyStorefrontCoupon(id: $id) { ${customerCouponFields} }
                }
            `,
            { id },
        );
        return result.applyStorefrontCoupon;
    }

    async applyBestCustomerCoupon(): Promise<StoreCustomerCoupon | null> {
        if (this.controller) {
            const acknowledged = await this.controller.execute({ coupon: { action: 'BEST' } });
            return (
                (await this.myCoupons()).find(
                    coupon => coupon.lockedOrderId === acknowledged.cart.checkoutOrder?.id,
                ) ?? null
            );
        }
        const result = await this.request<{ applyBestStorefrontCoupon: StoreCustomerCoupon | null }>(
            `
                mutation ApplyBestOwnedStorefrontCoupon {
                    applyBestStorefrontCoupon { ${customerCouponFields} }
                }
            `,
        );
        return result.applyBestStorefrontCoupon;
    }

    async removeCustomerCoupon(id: string): Promise<StoreCustomerCoupon> {
        if (this.controller) {
            await this.controller.execute({ coupon: { action: 'REMOVE', couponId: id } });
            const coupon = (await this.myCoupons()).find(item => item.id === id);
            if (!coupon) throw new Error('Coupon details are unavailable.');
            return coupon;
        }
        const result = await this.request<{ removeStorefrontCoupon: StoreCustomerCoupon }>(
            `
                mutation RemoveOwnedStorefrontCoupon($id: ID!) {
                    removeStorefrontCoupon(id: $id) { ${customerCouponFields} }
                }
            `,
            { id },
        );
        return result.removeStorefrontCoupon;
    }

    async applyCouponCode(couponCode: string): Promise<Order> {
        if (this.controller) {
            const acknowledged = await this.controller.execute({
                coupon: { action: 'APPLY_CODE', code: couponCode },
            });
            return requiredOrder(acknowledged);
        }
        const result = await this.request<{ applyCouponCode: Order & ErrorResult }>(
            `
                mutation ApplyStorefrontCoupon($couponCode: String!) {
                    applyCouponCode(couponCode: $couponCode) {
                        __typename
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { couponCode },
        );
        return this.assertOrder(result.applyCouponCode);
    }

    async removeCouponCode(couponCode: string): Promise<Order> {
        if (this.controller) {
            const acknowledged = await this.controller.execute({
                coupon: { action: 'REMOVE_CODE', code: couponCode },
            });
            return requiredOrder(acknowledged);
        }
        const result = await this.request<{ removeCouponCode: Order | null }>(
            `
                mutation RemoveStorefrontCoupon($couponCode: String!) {
                    removeCouponCode(couponCode: $couponCode) { ${orderFields} }
                }
            `,
            { couponCode },
        );
        if (!result.removeCouponCode) {
            throw new Error('The coupon could not be removed from the active order.');
        }
        return result.removeCouponCode;
    }

    async setOrderNote(customerNote: string): Promise<Order> {
        if (this.controller) {
            const acknowledged = await this.controller.execute({ order: { note: customerNote } });
            return requiredOrder(acknowledged);
        }
        const result = await this.request<{ setOrderCustomFields: Order & ErrorResult }>(
            `
                mutation SetStorefrontOrderNote($input: UpdateOrderInput!) {
                    setOrderCustomFields(input: $input) {
                        __typename
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { input: { customFields: { customerNote } } },
        );
        return this.assertOrder(result.setOrderCustomFields);
    }

    async setDeliveryEmail(
        inputOrEmail:
            | string
            | {
                  contactId?: string;
                  emailAddress?: string;
                  confirmEmailAddress?: string;
                  label?: string;
                  saveToAddressBook?: boolean;
                  isDefault?: boolean;
              },
    ): Promise<Order> {
        if (this.controller) {
            const deliveryEmail =
                typeof inputOrEmail === 'string'
                    ? { emailAddress: inputOrEmail, confirmEmailAddress: inputOrEmail }
                    : inputOrEmail;
            return requiredOrder(await this.controller.execute({ deliveryEmail }));
        }
        const input =
            typeof inputOrEmail === 'string'
                ? { emailAddress: inputOrEmail, confirmEmailAddress: inputOrEmail }
                : inputOrEmail;
        const result = await this.request<{ setActiveOrderDeliveryEmail: Order }>(
            `
                mutation SetStorefrontDeliveryEmail($input: SetActiveOrderDeliveryEmailInput!) {
                    setActiveOrderDeliveryEmail(input: $input) { ${orderFields} }
                }
            `,
            { input },
        );
        return result.setActiveOrderDeliveryEmail;
    }

    async myDeliveryEmails(signal?: AbortSignal): Promise<CustomerDeliveryEmail[]> {
        const result = await this.request<{ myDeliveryEmails: CustomerDeliveryEmail[] }>(
            `
                query MyDeliveryEmails {
                    myDeliveryEmails { id emailAddress label isDefault confirmedAt }
                }
            `,
            undefined,
            signal,
        );
        return result.myDeliveryEmails;
    }

    async activeStoreCommerceMode(signal?: AbortSignal): Promise<StoreCommerceMode> {
        const result = await this.request<{ activeStoreCommerceMode: StoreCommerceMode }>(
            `query ActiveStoreCommerceMode { activeStoreCommerceMode }`,
            undefined,
            signal,
        );
        return result.activeStoreCommerceMode;
    }

    async saveDeliveryEmail(input: {
        emailAddress: string;
        confirmEmailAddress: string;
        label?: string;
        isDefault?: boolean;
    }): Promise<CustomerDeliveryEmail> {
        const result = await this.request<{ saveMyDeliveryEmail: CustomerDeliveryEmail }>(
            `
                mutation SaveMyDeliveryEmail($input: SaveCustomerDeliveryEmailInput!) {
                    saveMyDeliveryEmail(input: $input) { id emailAddress label isDefault confirmedAt }
                }
            `,
            { input },
        );
        return result.saveMyDeliveryEmail;
    }

    async setDefaultDeliveryEmail(id: string): Promise<CustomerDeliveryEmail> {
        const result = await this.request<{ setMyDefaultDeliveryEmail: CustomerDeliveryEmail }>(
            `
                mutation SetMyDefaultDeliveryEmail($id: ID!) {
                    setMyDefaultDeliveryEmail(id: $id) { id emailAddress label isDefault confirmedAt }
                }
            `,
            { id },
        );
        return result.setMyDefaultDeliveryEmail;
    }

    async deleteDeliveryEmail(id: string): Promise<boolean> {
        const result = await this.request<{ deleteMyDeliveryEmail: boolean }>(
            `mutation DeleteMyDeliveryEmail($id: ID!) { deleteMyDeliveryEmail(id: $id) }`,
            { id },
        );
        return result.deleteMyDeliveryEmail;
    }

    async setCustomer(input: Record<string, string>): Promise<void> {
        if (this.controller) {
            await this.controller.execute({ order: { customer: input } });
            return;
        }
        const result = await this.request<{ setCustomerForOrder: ErrorResult }>(
            `
                mutation SetCustomer($input: CreateCustomerInput!) {
                    setCustomerForOrder(input: $input) {
                        ... on Order { id }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { input },
        );
        this.assertNoError(result.setCustomerForOrder);
    }

    async setShippingAddress(input: CustomerAddressInput): Promise<Order> {
        if (this.controller) {
            const acknowledged = await this.controller.execute({ order: { shippingAddress: input } });
            return requiredOrder(acknowledged);
        }
        const result = await this.request<{ setOrderShippingAddress: Order & ErrorResult }>(
            `
                mutation SetShippingAddress($input: CreateAddressInput!) {
                    setOrderShippingAddress(input: $input) {
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { input },
        );
        return this.assertOrder(result.setOrderShippingAddress);
    }

    async prepareShipping(input: {
        shippingAddress: CustomerAddressInput;
        selectedShippingMethodId?: string;
        preferredShippingCode?: string;
        defaultShippingCode?: string;
    }): Promise<{
        cart: StorefrontCart;
        order: Order;
        shippingMethods: ShippingMethod[];
        selectedShippingMethodId: string | null;
    }> {
        if (this.controller) {
            const acknowledged = await this.controller.execute({ prepareShipping: input });
            const order = requiredOrder(acknowledged);
            const preparedMethods = acknowledged.shippingMethods ?? (await this.eligibleShippingMethods());
            const selectedShippingMethodId =
                acknowledged.selectedShippingMethodId ??
                preparedMethods.find(method => method.code === order.checkoutShipping?.methodCode)?.id ??
                null;
            return {
                cart: acknowledged.cart,
                order,
                shippingMethods: preparedMethods,
                selectedShippingMethodId,
            };
        }
        await this.setShippingAddress(input.shippingAddress);
        const fallbackMethods = await this.eligibleShippingMethods();
        const selected = selectShippingMethod(fallbackMethods, input);
        if (selected) await this.setShippingMethod(selected.id);
        const cart = await this.readCart();
        return {
            cart,
            order: requiredCartOrder(cart),
            shippingMethods: fallbackMethods,
            selectedShippingMethodId: selected?.id ?? null,
        };
    }

    async eligibleShippingMethods(): Promise<ShippingMethod[]> {
        const result = await this.request<{ eligibleShippingMethods: ShippingMethod[] }>(`
            query EligibleShippingMethods {
                eligibleShippingMethods { id code name description priceWithTax metadata }
            }
        `);
        return result.eligibleShippingMethods;
    }

    async setShippingMethod(id: string): Promise<Order> {
        if (this.controller) {
            const acknowledged = await this.controller.execute({ order: { shippingMethodId: id } });
            return requiredOrder(acknowledged);
        }
        const result = await this.request<{ setOrderShippingMethod: Order & ErrorResult }>(
            `
                mutation SetShippingMethod($id: [ID!]!) {
                    setOrderShippingMethod(shippingMethodId: $id) {
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { id: [id] },
        );
        return this.assertOrder(result.setOrderShippingMethod);
    }

    async setShippingMethodWithCart(id: string): Promise<StorefrontCart> {
        if (this.controller) return (await this.controller.execute({ order: { shippingMethodId: id } })).cart;
        await this.setShippingMethod(id);
        return this.readCart();
    }

    async setCurrencyForOrder(currencyCode: string): Promise<Order> {
        if (this.controller) {
            const acknowledged = await this.controller.execute({ order: { currencyCode } });
            return requiredOrder(acknowledged);
        }
        const result = await this.request<{ setCurrencyCodeForOrder: Order & ErrorResult }>(
            `
                mutation SetStorefrontOrderCurrency($currencyCode: CurrencyCode!) {
                    setCurrencyCodeForOrder(currencyCode: $currencyCode) {
                        __typename
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `,
            { currencyCode },
        );
        return this.assertOrder(result.setCurrencyCodeForOrder);
    }

    async setPaymentCurrencyForOrder(currencyCode: string): Promise<Order> {
        const result = await this.request<{ setStorefrontPaymentCurrency: Order }>(
            `
                mutation SetStorefrontPaymentCurrency($currencyCode: String!) {
                    setStorefrontPaymentCurrency(currencyCode: $currencyCode) {
                        ${orderFields}
                    }
                }
            `,
            { currencyCode },
        );
        return result.setStorefrontPaymentCurrency;
    }

    async eligiblePaymentMethods(signal?: AbortSignal, orderId?: string): Promise<PaymentMethod[]> {
        const cached = orderId ? this.paymentMethodRequests.get(orderId) : undefined;
        if (cached && cached.expiresAt > Date.now()) return cached.promise;
        const promise = this.request<{ eligiblePaymentMethods: PaymentMethod[] }>(
            `
                query EligibleStorefrontPaymentMethods {
                    eligiblePaymentMethods {
                        id
                        code
                        name
                        description
                        isEligible
                        eligibilityMessage
                    }
                }
            `,
            undefined,
            signal,
        ).then(result => {
            const methods = result.eligiblePaymentMethods.filter(
                method => method.code !== 'referral-balance' && method.code !== 'referral-balance-payment',
            );
            if (orderId) {
                const current = this.paymentMethodRequests.get(orderId);
                if (current?.promise === promise) current.data = methods;
            }
            return methods;
        });
        if (orderId) {
            const entry = { expiresAt: Date.now() + 30_000, promise };
            this.paymentMethodRequests.set(orderId, entry);
            void promise.catch(() => {
                if (this.paymentMethodRequests.get(orderId) === entry)
                    this.paymentMethodRequests.delete(orderId);
            });
        }
        return promise;
    }

    prefetchEligiblePaymentMethods(orderId: string): Promise<PaymentMethod[]> {
        return this.eligiblePaymentMethods(undefined, orderId);
    }

    cachedEligiblePaymentMethods(orderId: string): PaymentMethod[] | undefined {
        const cached = this.paymentMethodRequests.get(orderId);
        return cached && cached.expiresAt > Date.now() ? cached.data : undefined;
    }

    async createUsdtCheckoutQuote(signal?: AbortSignal): Promise<StorefrontUsdtCheckoutQuote> {
        const result = await this.request<{
            createStorefrontUsdtCheckoutQuote: StorefrontUsdtCheckoutQuote;
        }>(
            `
                mutation CreateStorefrontUsdtCheckoutQuote {
                    createStorefrontUsdtCheckoutQuote {
                        id
                        fiatCurrencyCode
                        fiatAmount
                        fiatPerUsdtRate
                        markupPercent
                        usdtAmount
                        source
                        network
                        tokenContractAddress
                        receivingAddress
                        receivingAddressFingerprint
                        paymentStatus
                        transactionId
                        settledAt
                        createdAt
                        expiresAt
                    }
                }
            `,
            undefined,
            signal,
        );
        return result.createStorefrontUsdtCheckoutQuote;
    }

    async addPaymentToOrder(method: string, metadata: Record<string, unknown> = {}): Promise<Order> {
        const result = await this.request<{
            addPaymentToOrder: Order & ErrorResult & { paymentErrorMessage?: string };
        }>(
            `
                mutation AddStorefrontPayment($input: PaymentInput!) {
                    addPaymentToOrder(input: $input) {
                        __typename
                        ... on Order { ${orderFields} }
                        ... on ErrorResult { errorCode message }
                        ... on PaymentFailedError { paymentErrorMessage }
                    }
                }
            `,
            { input: { method, metadata } },
        );
        if (result.addPaymentToOrder.paymentErrorMessage?.startsWith('PAYMENT_REVIEW_REQUIRED:'))
            throw new ShopApiError('PAYMENT_REVIEW_REQUIRED', 'PAYMENT_REVIEW_REQUIRED');
        return this.assertOrder(result.addPaymentToOrder);
    }
}

const commandResultFields = `commandId status appliedRevision errorCode message
    cart { ${cartFields} }
    session { checkout { id cartRevision state completedAt } }
    shippingMethods { id code name description priceWithTax metadata }
    selectedShippingMethodId`;
function requiredOrder(result: CartCommandResult): Order {
    if (!result.cart.checkoutOrder) throw new Error('No active checkout order.');
    return result.cart.checkoutOrder;
}
function requiredCartOrder(cart: StorefrontCart): Order {
    if (!cart.checkoutOrder) throw new Error('No active checkout order.');
    return cart.checkoutOrder;
}

function selectShippingMethod(
    methods: ShippingMethod[],
    input: {
        selectedShippingMethodId?: string;
        preferredShippingCode?: string;
        defaultShippingCode?: string;
    },
): ShippingMethod | undefined {
    return (
        methods.find(method => method.id === input.selectedShippingMethodId) ??
        methods.find(method => method.code === input.preferredShippingCode) ??
        methods.find(method => method.code === input.defaultShippingCode) ??
        methods.find(method => method.priceWithTax === 0) ??
        [...methods].sort((left, right) => left.priceWithTax - right.priceWithTax)[0]
    );
}

function hydrateCommandResult(result: CartCommandResult): CartCommandResult {
    return {
        ...result,
        session:
            result.session && result.cart.checkoutOrder
                ? { ...result.session, cart: result.cart, order: result.cart.checkoutOrder }
                : null,
    };
}
