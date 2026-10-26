import type { Injector, RequestContext } from '@vendure/core';
import type { SMTPTransportOptions } from '@vendure/email-plugin';
import addressparser from 'nodemailer/lib/addressparser';

export interface StorefrontEmailSender {
    from: string;
    smtpPassword: string;
}

export function productionEmailSmtpTransport(
    host: string,
    port: number,
    secure: boolean,
    user: string | undefined,
    password: string | undefined,
): SMTPTransportOptions {
    if (!user || !password) {
        throw new Error('SMTP_USER and SMTP_PASSWORD must both be configured in production');
    }
    if (host.toLowerCase() === 'smtp.resend.com') {
        const validTlsMode =
            (secure && (port === 465 || port === 2465)) ||
            (!secure && (port === 25 || port === 587 || port === 2587));
        if (user !== 'resend') throw new Error('SMTP_USER must be resend when SMTP_HOST is smtp.resend.com');
        if (!validTlsMode) {
            throw new Error('SMTP_PORT and SMTP_SECURE do not form a supported Resend TLS configuration');
        }
    }
    return { type: 'smtp', host, port, secure, requireTLS: !secure, auth: { user, pass: password } };
}

/** Server-only, opt-in identities for independently verified storefront domains. */
export function parseStorefrontEmailSenders(
    configured: string | undefined,
    environment: NodeJS.ProcessEnv,
): ReadonlyMap<string, StorefrontEmailSender> {
    const senders = new Map<string, StorefrontEmailSender>();
    if (!configured?.trim()) return senders;
    const invalid = () => new Error('Invalid VENDURE_EMAIL_SENDERS configuration');
    let entries: unknown;
    try {
        entries = JSON.parse(configured);
    } catch {
        throw invalid();
    }
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw invalid();
    for (const [host, entry] of Object.entries(entries)) {
        // Exact primary hosts only: no parent-host fallback, URL paths, ports or credentials.
        if (
            !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(host) ||
            !entry ||
            typeof entry !== 'object' ||
            Array.isArray(entry)
        )
            throw invalid();
        const { from, passwordEnv } = entry as Record<string, unknown>;
        if (
            Object.keys(entry).some(key => key !== 'from' && key !== 'passwordEnv') ||
            typeof from !== 'string' ||
            /[\r\n\0]/u.test(from) ||
            typeof passwordEnv !== 'string' ||
            !/^SMTP_PASSWORD_[A-Z0-9_]+$/u.test(passwordEnv)
        )
            throw invalid();
        const mailboxes = addressparser(from, { flatten: true });
        const address = mailboxes[0]?.address;
        const domain = address?.split('@')[1]?.toLowerCase();
        if (
            mailboxes.length !== 1 ||
            !address ||
            !/^[^\s<>@]+@[^\s<>@]+$/u.test(address) ||
            !domain ||
            (domain !== host && !domain.endsWith(`.${host}`))
        )
            throw invalid();
        const smtpPassword = environment[passwordEnv]?.trim();
        // Never include input values or secrets in a configuration error.
        if (!smtpPassword) throw new Error('A configured storefront SMTP password is missing');
        senders.set(host, { from, smtpPassword });
    }
    return senders;
}

export function emailSenderForStorefront(
    senders: ReadonlyMap<string, StorefrontEmailSender>,
    storefrontUrl: string,
): StorefrontEmailSender | undefined {
    return senders.get(new URL(storefrontUrl).hostname);
}

export function createStorefrontSmtpTransport(
    fallback: SMTPTransportOptions,
    senders: ReadonlyMap<string, StorefrontEmailSender>,
    storefrontUrlForContext: (injector: Injector, ctx: RequestContext) => Promise<string>,
): (injector?: Injector, ctx?: RequestContext) => Promise<SMTPTransportOptions> {
    return async (injector, ctx) => {
        // EmailProcessor.init() resolves settings without a request context before any job exists.
        if (!ctx || !senders.size) return fallback;
        if (!injector) throw new Error('Storefront SMTP routing requires an injector');
        const sender = emailSenderForStorefront(senders, await storefrontUrlForContext(injector, ctx));
        if (!sender) return fallback;
        return { ...fallback, auth: { ...fallback.auth, pass: sender.smtpPassword } };
    };
}
