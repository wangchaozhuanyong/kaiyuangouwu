import {
    AuthenticationStrategy,
    ID,
    Injector,
    NativeAuthenticationData,
    NativeAuthenticationStrategy,
    RequestContext,
    RequestContextService,
    SettingsStoreService,
    User,
} from '@vendure/core';
import { readStorefrontAuthSettings } from '@vendure/storefront-content-plugin';

export const STOREFRONT_INVALID_CREDENTIALS = 'STOREFRONT_INVALID_CREDENTIALS';

export class StorefrontNativeAuthenticationStrategy implements AuthenticationStrategy<NativeAuthenticationData> {
    readonly name = 'native';

    private readonly nativeStrategy = new NativeAuthenticationStrategy();
    private settingsStore: SettingsStoreService;
    private requestContextService: RequestContextService;

    async init(injector: Injector): Promise<void> {
        this.settingsStore = injector.get(SettingsStoreService);
        this.requestContextService = injector.get(RequestContextService);
        await this.nativeStrategy.init(injector);
    }

    defineInputType() {
        return this.nativeStrategy.defineInputType();
    }

    async authenticate(ctx: RequestContext, data: NativeAuthenticationData): Promise<User | string> {
        if (ctx.apiType === 'shop') {
            const settingsCtx = await this.requestContextService.create({
                apiType: 'shop',
                channelOrToken: ctx.channel,
                languageCode: ctx.languageCode,
                currencyCode: ctx.currencyCode,
            });
            settingsCtx.setReplicationMode('master');
            const settings = await readStorefrontAuthSettings(this.settingsStore, settingsCtx);
            if (!settings.emailPasswordEnabled) {
                return STOREFRONT_INVALID_CREDENTIALS;
            }
        }
        const user = await this.nativeStrategy.authenticate(ctx, data);
        if (user) {
            return user;
        }
        return STOREFRONT_INVALID_CREDENTIALS;
    }

    verifyUserPassword(ctx: RequestContext, userId: ID, password: string): Promise<boolean> {
        return this.nativeStrategy.verifyUserPassword(ctx, userId, password);
    }
}
