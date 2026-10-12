import type { Asset, CustomerIdentity } from '../types';

import { BaseDomainApi } from './base-domain-api';

/** Public browsing resolves the session without importing private account operations. */
export class CustomerIdentityApi extends BaseDomainApi {
    async customerIdentity(signal?: AbortSignal): Promise<CustomerIdentity | null> {
        const result = await this.request<{
            activeCustomer: Omit<CustomerIdentity, 'avatar'> | null;
            myCustomerAvatar?: Asset | null;
        }>(
            `query StorefrontCustomerIdentity {
            activeCustomer { id firstName lastName emailAddress phoneNumber }
            myCustomerAvatar { id preview }
        }`,
            undefined,
            signal,
        );
        return result.activeCustomer
            ? { ...result.activeCustomer, avatar: result.myCustomerAvatar ?? null }
            : null;
    }
}
