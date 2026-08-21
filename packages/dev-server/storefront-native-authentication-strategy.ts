import {
    AuthenticationStrategy,
    ID,
    Injector,
    NativeAuthenticationData,
    NativeAuthenticationStrategy,
    RequestContext,
    User,
} from '@vendure/core';

export const STOREFRONT_INVALID_CREDENTIALS = 'STOREFRONT_INVALID_CREDENTIALS';

export class StorefrontNativeAuthenticationStrategy implements AuthenticationStrategy<NativeAuthenticationData> {
    readonly name = 'native';

    private readonly nativeStrategy = new NativeAuthenticationStrategy();

    async init(injector: Injector): Promise<void> {
        await this.nativeStrategy.init(injector);
    }

    defineInputType() {
        return this.nativeStrategy.defineInputType();
    }

    async authenticate(ctx: RequestContext, data: NativeAuthenticationData): Promise<User | string> {
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
