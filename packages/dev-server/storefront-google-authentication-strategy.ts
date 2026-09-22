import {
    AuthenticationStrategy,
    ExternalAuthenticationService,
    Injector,
    RequestContext,
    SettingsStoreService,
    User,
} from '@vendure/core';
import { readStorefrontAuthSettings } from '@vendure/storefront-content-plugin';
import { OAuth2Client } from 'google-auth-library';
import { DocumentNode } from 'graphql';
import gql from 'graphql-tag';

export const STOREFRONT_GOOGLE_AUTH_UNAVAILABLE = 'STOREFRONT_GOOGLE_AUTH_UNAVAILABLE';
export const STOREFRONT_GOOGLE_AUTH_INVALID = 'STOREFRONT_GOOGLE_AUTH_INVALID';
export const STOREFRONT_GOOGLE_CONSENT_REQUIRED = 'STOREFRONT_GOOGLE_CONSENT_REQUIRED';
const DATA_CONSENT_SERVICE_TOKEN = 'STORE_DATA_CONSENT_SERVICE';

interface RegistrationConsentRecorder {
    assertRegistrationConsent(
        ctx: RequestContext,
        input: StorefrontGoogleAuthenticationData,
    ): Promise<{
        terms: { version: string; digest: string };
        privacy: { version: string; digest: string };
        locale: string;
    }>;
    recordRegistrationByEmail(
        ctx: RequestContext,
        emailAddress: string,
        source: 'GOOGLE_REGISTRATION',
        snapshots: {
            terms: { version: string; digest: string };
            privacy: { version: string; digest: string };
            locale: string;
        },
    ): Promise<void>;
}

export type StorefrontGoogleAuthenticationData = {
    credential: string;
    termsAccepted: boolean;
    privacyAcknowledged: boolean;
    locale: string;
};

export class StorefrontGoogleAuthenticationStrategy implements AuthenticationStrategy<StorefrontGoogleAuthenticationData> {
    readonly name = 'google';

    private externalAuthenticationService: ExternalAuthenticationService;
    private settingsStore: SettingsStoreService;
    private consents: RegistrationConsentRecorder;
    private readonly clients = new Map<string, OAuth2Client>();

    init(injector: Injector): void {
        this.externalAuthenticationService = injector.get(ExternalAuthenticationService);
        this.settingsStore = injector.get(SettingsStoreService);
        this.consents = injector.get(DATA_CONSENT_SERVICE_TOKEN);
    }

    defineInputType(): DocumentNode {
        return gql`
            input StorefrontGoogleAuthInput {
                credential: String!
                termsAccepted: Boolean!
                privacyAcknowledged: Boolean!
                locale: String!
            }
        `;
    }

    async authenticate(
        ctx: RequestContext,
        data: StorefrontGoogleAuthenticationData,
    ): Promise<User | string> {
        const settings = await readStorefrontAuthSettings(this.settingsStore, ctx);
        if (!settings.googleEnabled || !settings.googleClientId) {
            return STOREFRONT_GOOGLE_AUTH_UNAVAILABLE;
        }

        try {
            const client = this.googleClient(settings.googleClientId);
            const ticket = await client.verifyIdToken({
                idToken: data.credential,
                audience: settings.googleClientId,
            });
            const payload = ticket.getPayload();
            if (!payload?.sub || !payload.email || payload.email_verified !== true) {
                return STOREFRONT_GOOGLE_AUTH_INVALID;
            }
            const existing = await this.externalAuthenticationService.findCustomerUser(
                ctx,
                this.name,
                payload.sub,
            );
            if (existing) return existing;

            let consentSnapshots;
            try {
                consentSnapshots = await this.consents.assertRegistrationConsent(ctx, data);
            } catch {
                return STOREFRONT_GOOGLE_CONSENT_REQUIRED;
            }

            const user = await this.externalAuthenticationService.createCustomerAndUser(ctx, {
                strategy: this.name,
                externalIdentifier: payload.sub,
                verified: true,
                emailAddress: payload.email,
                firstName: payload.given_name || payload.name || '',
                lastName: payload.family_name || '',
            });
            await this.consents.recordRegistrationByEmail(
                ctx,
                payload.email,
                'GOOGLE_REGISTRATION',
                consentSnapshots,
            );
            return user;
        } catch {
            return STOREFRONT_GOOGLE_AUTH_INVALID;
        }
    }

    private googleClient(clientId: string): OAuth2Client {
        const existing = this.clients.get(clientId);
        if (existing) return existing;
        const client = new OAuth2Client(clientId);
        this.clients.set(clientId, client);
        return client;
    }
}
