import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ForbiddenError, internal_getRequestContext, parseContext } from '@vendure/core';

// Public browsing and account bootstrap are explicit. Customer data, mutations
// and new Shop API fields still require their existing authorization.
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
]);
const publicMutations = new Set([
    'recordStorefrontPageView',
    'login',
    'authenticate',
    'logout',
    'registerCustomerAccount',
    'registerCustomerWithReferral',
    'verifyCustomerAccount',
    'refreshCustomerVerification',
    'requestPasswordReset',
    'resetPassword',
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
        if (ctx.activeUserId) return next.handle();
        const allowed = parent === 'Query' ? publicQueries : publicMutations;
        if (!allowed.has(parsed.info.fieldName)) throw new ForbiddenError();
        return next.handle();
    }
}
