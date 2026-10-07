import { CurrencyCode, LanguageCode, RequestContext } from '@vendure/core';
import type { Request } from 'express';

/** Values are preferences only; the verified Channel owns the currency allowlist. */
export function publicPagePreferences(ctx: RequestContext, language: unknown, currency: unknown) {
    if (language != null && language !== '' && language !== 'en' && language !== 'zh_Hans')
        throw new Error('Unsupported language');
    if (
        currency != null &&
        currency !== '' &&
        (typeof currency !== 'string' ||
            !ctx.channel.availableCurrencyCodes.includes(currency as CurrencyCode))
    )
        throw new Error('Unsupported currency');
    return {
        languageCode: (language || ctx.languageCode) as LanguageCode,
        currencyCode: (currency || ctx.currencyCode) as CurrencyCode,
    };
}

/** This deployment's internal Nginx SSI proxy connects to the API over loopback. */
export function trustedPublicPageHeaders(req: Request): boolean {
    const address = req.socket?.remoteAddress;
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
