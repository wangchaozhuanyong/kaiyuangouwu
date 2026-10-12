import type { AccountApi } from './account';
import type { ShopApiContext } from './client-context';

import { CustomerIdentityApi } from './customer-identity';

export type { AccountApi };
type AccountModule = Pick<typeof import('./account'), 'AccountApi'>;
type LazyAccountMethod = Exclude<keyof AccountApi, 'customerIdentity'>;

// The concrete account surface is exhaustive: adding an API requires preserving it here.
const lazyMethods: Record<LazyAccountMethod, true> = {
    customerAddresses: true,
    customerRecentOrders: true,
    activeCustomer: true,
    uploadCustomerAvatar: true,
    customerAvatarHistory: true,
    restoreCustomerAvatar: true,
    removeCustomerAvatar: true,
    dataSubjectRequests: true,
    exportPersonalData: true,
    requestAccountClosure: true,
    cancelAccountClosure: true,
    fraudRiskCases: true,
    appealFraudRiskCase: true,
    customerOrders: true,
    customerOrderCounts: true,
    order: true,
    digitalDeliveryStatuses: true,
    claimDigitalDelivery: true,
    orderAdditionalPaymentQuote: true,
    addPaymentToModifiedOrder: true,
    createModifiedOrderUsdtQuote: true,
    useModifiedOrderReferralBalance: true,
    orderByConfirmationToken: true,
    createOrderConfirmationToken: true,
    cancelMyAuthorizedOrder: true,
    confirmFulfillmentDelivery: true,
    login: true,
    authenticateWithGoogle: true,
    refreshCustomerVerification: true,
    verifyCustomerAccount: true,
    requestPasswordReset: true,
    resetPassword: true,
    logout: true,
    createAddress: true,
    updateAddress: true,
    deleteAddress: true,
};

function accountSignal(value: unknown): value is AbortSignal {
    // A signal from another frame has a different constructor but the same native contract.
    return (
        value !== null &&
        typeof value === 'object' &&
        'aborted' in value &&
        typeof value.aborted === 'boolean' &&
        'addEventListener' in value &&
        typeof value.addEventListener === 'function' &&
        'removeEventListener' in value &&
        typeof value.removeEventListener === 'function'
    );
}

/** One lazily created account domain per API context; calls and mutations are never replayed. */
export function lazyAccountApi(
    ctx: ShopApiContext,
    loadModule: () => Promise<AccountModule> = () => import('./account'),
): AccountApi {
    const identity = new CustomerIdentityApi(ctx);
    const target = { customerIdentity: identity.customerIdentity.bind(identity) };
    const methods = new Map<LazyAccountMethod, (...args: unknown[]) => Promise<unknown>>();
    let domain: Promise<AccountApi> | undefined;
    const load = () => {
        if (!domain) {
            domain = Promise.resolve()
                .then(loadModule)
                .then(module => new module.AccountApi(ctx))
                .catch(error => {
                    domain = undefined;
                    throw error;
                });
        }
        return domain;
    };
    const wait = async (signal?: AbortSignal): Promise<AccountApi> => {
        if (!signal) return load();
        if (signal.aborted) throw signal.reason ?? new DOMException('Request aborted', 'AbortError');
        let removeAbort: () => void = () => undefined;
        try {
            const account = await Promise.race([
                load(),
                new Promise<undefined>(resolve => {
                    const abort = () => resolve(undefined);
                    signal.addEventListener('abort', abort, { once: true });
                    removeAbort = () => signal.removeEventListener('abort', abort);
                    if (signal.aborted) abort();
                }),
            ]);
            if (signal.aborted) throw signal.reason ?? new DOMException('Request aborted', 'AbortError');
            return account ?? load();
        } finally {
            removeAbort();
        }
    };
    return new Proxy(target, {
        get(object, property, receiver) {
            if (property === 'customerIdentity') return Reflect.get(object, property, receiver);
            if (typeof property !== 'string' || !Object.hasOwn(lazyMethods, property)) return undefined;
            const name = property as LazyAccountMethod;
            let method = methods.get(name);
            if (!method) {
                method = async (...args) => {
                    const signal = args.find(accountSignal);
                    const account = await wait(signal);
                    if (signal?.aborted)
                        throw signal.reason ?? new DOMException('Request aborted', 'AbortError');
                    return Reflect.apply(account[name].bind(account), account, args);
                };
                methods.set(name, method);
            }
            return method;
        },
    }) as AccountApi;
}
