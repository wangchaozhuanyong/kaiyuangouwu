import { Injector, RequestContext, TransactionalConnection } from '@vendure/core';
import { StorefrontMediaManifestService, StoreProfile } from '@vendure/store-management-plugin';
import addressparser from 'nodemailer/lib/addressparser';

import { isChineseEmail, type StorefrontNameFields } from './email-localization';

/** Resolve optional branding using the sending event's channel and existing public-media policy. */
export async function storefrontEmailLogoForChannel(
    ctx: RequestContext,
    injector: Injector,
    storefrontUrl: string,
): Promise<string | undefined> {
    return injector
        .get(TransactionalConnection)
        .getRepository(ctx, StoreProfile)
        .findOne({
            where: { channelId: ctx.channelId },
            relations: { logoAsset: true, logoOnLightAsset: true },
        })
        .then(profile =>
            storefrontEmailLogoUrl(profile, storefrontUrl, identifier =>
                injector
                    .get(StorefrontMediaManifestService)
                    .isPublic(ctx, new URL(storefrontUrl).host, identifier),
            ),
        )
        .catch(() => undefined);
}

/** Change only the display name; the configured, verified sending mailbox remains the transport identity. */
export function storefrontEmailFromAddress(
    configuredFrom: string,
    languageCode: string,
    names: StorefrontNameFields,
): string {
    const mailboxes = addressparser(configuredFrom, { flatten: true });
    const address = mailboxes[0]?.address;
    if (
        /[\r\n\0]/u.test(configuredFrom) ||
        mailboxes.length !== 1 ||
        !address ||
        !/^[^\s<>@]+@[^\s<>@]+$/u.test(address)
    ) {
        throw new Error('VENDURE_EMAIL_FROM must contain one valid sending mailbox');
    }
    const name = (isChineseEmail(languageCode) ? names.storefrontNameZh : names.storefrontNameEn)
        ?.replace(/[\u0000-\u001f\u007f]/gu, ' ')
        .trim();
    // An unconfigured store must not inherit the display name of the platform's SMTP identity.
    return name ? `"${name.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}" <${address}>` : address;
}

interface EmailLogoAsset {
    source: string;
    preview?: string;
}

/** Use only this store's Admin-bound artwork which its existing public-media policy permits. */
export async function storefrontEmailLogoUrl(
    profile: { logoOnLightAsset?: EmailLogoAsset | null; logoAsset?: EmailLogoAsset | null } | null,
    storefrontUrl: string,
    isPublicAsset: (identifier: string) => Promise<boolean>,
): Promise<string | undefined> {
    const origin = new URL(storefrontUrl).origin;
    for (const asset of [profile?.logoOnLightAsset, profile?.logoAsset]) {
        const source = (asset?.preview || asset?.source)?.trim();
        if (!source || /[\u0000-\u001f]/u.test(source)) continue;
        try {
            const url = new URL(/^(?:preview|source)\//u.test(source) ? `/assets/${source}` : source, origin);
            const pathname = decodeURIComponent(url.pathname);
            if (
                url.origin !== origin ||
                !['https:', 'http:'].includes(url.protocol) ||
                url.username ||
                url.password ||
                !/^\/assets\/(?:preview|source)\//u.test(pathname) ||
                pathname.split('/').includes('..') ||
                !(await isPublicAsset(pathname.slice('/assets/'.length)))
            )
                continue;
            // The existing approved PNG preset avoids SVG/WebP-only support in email clients.
            url.search = '';
            url.hash = '';
            url.searchParams.set('preset', 'storefront-thumbnail-fit-320');
            url.searchParams.set('format', 'png');
            return url.toString();
        } catch {
            // Optional branding must not block an order/account notification.
        }
    }
}
