import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ForbiddenError, internal_getRequestContext, parseContext } from '@vendure/core';

// This is an allow-list of account bootstrap operations, not a list of known
// catalog queries. New Shop API fields stay private until explicitly reviewed.
const publicQueries = new Set([
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

        // Responses may contain authenticated catalog data; never permit a
        // shared proxy/browser response cache to serve them to another visitor.
        parsed.res.setHeader('Cache-Control', 'private, no-store');
        parsed.res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
        if (ctx.activeUserId) return next.handle();
        const allowed = parent === 'Query' ? publicQueries : publicMutations;
        if (!allowed.has(parsed.info.fieldName)) throw new ForbiddenError();
        return next.handle();
    }
}
