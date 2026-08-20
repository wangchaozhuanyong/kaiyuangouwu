import {
    AuthenticationStrategy,
    ID,
    Injector,
    NativeAuthenticationData,
    NativeAuthenticationStrategy,
    RequestContext,
    User,
    UserService,
} from '@vendure/core';

export const STOREFRONT_ACCOUNT_NOT_FOUND = 'STOREFRONT_ACCOUNT_NOT_FOUND';
export const STOREFRONT_INVALID_PASSWORD = 'STOREFRONT_INVALID_PASSWORD';

export class StorefrontNativeAuthenticationStrategy implements AuthenticationStrategy<NativeAuthenticationData> {
    readonly name = 'native';

    private readonly nativeStrategy = new NativeAuthenticationStrategy();
    private storefrontUserService: UserService;

    async init(injector: Injector): Promise<void> {
        await this.nativeStrategy.init(injector);
        this.storefrontUserService = injector.get(UserService);
    }

    defineInputType() {
        return this.nativeStrategy.defineInputType();
    }

    async authenticate(ctx: RequestContext, data: NativeAuthenticationData): Promise<User | string> {
        const user = await this.nativeStrategy.authenticate(ctx, data);
        if (user) {
            return user;
        }

        const account = await this.storefrontUserService.getUserByEmailAddress(ctx, data.username);
        return account ? STOREFRONT_INVALID_PASSWORD : STOREFRONT_ACCOUNT_NOT_FOUND;
    }

    verifyUserPassword(ctx: RequestContext, userId: ID, password: string): Promise<boolean> {
        return this.nativeStrategy.verifyUserPassword(ctx, userId, password);
    }
}
