import { Injector, NativeAuthenticationStrategy, RequestContext } from '@vendure/core';

import { AdminTwoFactorService } from './admin-two-factor.service';

/** Keep native password verification available, but never issue a password-only session for enrolled admins. */
export class AdminTwoFactorNativeStrategy extends NativeAuthenticationStrategy {
    private twoFactor: AdminTwoFactorService;

    async init(injector: Injector) {
        await super.init(injector);
        this.twoFactor = injector.get(AdminTwoFactorService);
    }

    async authenticate(ctx: RequestContext, data: { username: string; password: string }) {
        const user = await super.authenticate(ctx, data);
        if (user && (await this.twoFactor.credential(user.id))?.enabledAt) return false;
        return user;
    }
}
