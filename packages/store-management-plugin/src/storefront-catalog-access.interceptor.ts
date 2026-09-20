import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ForbiddenError, internal_getRequestContext, parseContext } from '@vendure/core';

// Anonymous pass-through is explicit. Resolver permissions and services still
// enforce cart ownership and customer-data authorization after this global gate.
const publicQueries = new Set([
    'products',
    'product',
    'search',
    'collections',
    'collection',
    'storefrontCatalog',
    'storefrontProductSales',
    'storefrontProductReviews',
    'activeStorefrontFlashSales',
    'activeStorefrontCoupons',
    'activeSystemAnnouncements',
    'storefrontContentSettings',
    'activeStoreCommerceMode',
    'imageStudioConfig',
    // The mail service authorizes each read with its query code and expiry.
    'icloudQueryMails',
    'me',
    'activeCustomer',
    'myCustomerAvatar',
    'activeChannel',
    'availableCountries',
    'availableStorefrontProvinces',
    'storefrontBranding',
    'storefrontCurrencyConfiguration',
    'storefrontVisualPreset',
    'storefrontContent',
    'validateReferralInviteCode',
    'referralProgram',
    'storefrontCart',
    'activeOrder',
    'eligibleShippingMethods',
    'eligiblePaymentMethods',
    'nextOrderStates',
]);
const publicMutations = new Set([
    'recordStorefrontPageView',
    'recordStorefrontAnalyticsConsent',
    'login',
    'authenticate',
    'logout',
    'registerCustomerWithReferral',
    'verifyCustomerAccount',
    'refreshCustomerVerification',
    'requestPasswordReset',
    'resetPassword',
    'applyStorefrontCartCommand',
    'recoverStorefrontCartCommand',
    'addStorefrontCartItem',
    'setStorefrontCartLineQuantity',
    'removeStorefrontCartLines',
    'setStorefrontCartLinesSelected',
    'setAllStorefrontCartLinesSelected',
    'beginStorefrontCheckout',
    'prepareStorefrontCartPayment',
    'setStorefrontPaymentCurrency',
    'reopenStorefrontCart',
    'addItemToOrder',
    'adjustOrderLine',
    'removeOrderLine',
    'removeAllOrderLines',
    'applyCouponCode',
    'removeCouponCode',
    'setCustomerForOrder',
    'setOrderShippingAddress',
    'setOrderBillingAddress',
    'unsetOrderShippingAddress',
    'unsetOrderBillingAddress',
    'setOrderShippingMethod',
    'setOrderCustomFields',
    'transitionOrderToState',
    'addPaymentToOrder',
]);

@Injectable()
export class StorefrontCatalogAccessInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler) {
        const parsed = parseContext(context);
        if (!parsed.isGraphQL) return next.handle();
        const parent = parsed.info.parentType.name;
        if (parent !== 'Query' && parent !== 'Mutation') return next.handle();
        const ctx = internal_getRequestContext(parsed.req, context);
        if (ctx.apiType !== 'shop') return next.handle();

        // Responses may contain customer data; never permit a
        // shared proxy/browser response cache to serve them to another visitor.
        parsed.res.setHeader('Cache-Control', 'private, no-store');
        parsed.res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
        // Registration must use the audited mutation which requires explicit,
        // versioned terms and privacy evidence.
        if (parent === 'Mutation' && parsed.info.fieldName === 'registerCustomerAccount') {
            throw new ForbiddenError();
        }
        if (ctx.activeUserId) return next.handle();
        const allowed = parent === 'Query' ? publicQueries : publicMutations;
        if (!allowed.has(parsed.info.fieldName)) throw new ForbiddenError();
        return next.handle();
    }
}
