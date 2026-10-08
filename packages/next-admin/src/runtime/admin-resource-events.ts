import { ApolloLink, Observable } from '@apollo/client';
import { getOperationAST, type DocumentNode } from 'graphql';
import { extractMutationFailureDetails } from '../utils/admin-mutation-feedback';

export const RESOURCE_INVALIDATION_EVENT = 'vendure:admin-resources-invalidated';
export type ResourceDomain =
    'catalog' | 'orders' | 'customers' | 'marketing' | 'storefront' | 'settings' | 'plugins';
let pendingWrites = 0;
const writeListeners = new Set<() => void>();
export const pendingAdminWrites = () => pendingWrites;
export const subscribeAdminWrites = (listener: () => void) => {
    writeListeners.add(listener);
    return () => {
        writeListeners.delete(listener);
    };
};
function publishWriteState(delta: number) {
    pendingWrites += delta;
    writeListeners.forEach(listener => listener());
}
const domainRules: Array<[ResourceDomain, RegExp]> = [
    [
        'catalog',
        /product|catalog|stock|inventory|supplier|purchase|asset|collection|facet|optiongroup|digitalvariant|physicalvariant|physicalreturn|inspectaftersalesreturn|updateaftersalesreplacement/iu,
    ],
    [
        'orders',
        /order|fulfillment|refund|payment|aftersales|autocard|profit|manualdigitaldelivery|checkoutdelivery|digitaldelivery|physicalreturn/iu,
    ],
    ['customers', /customer|address/iu],
    ['marketing', /promotion|coupon|referral|withdrawal|marketing|flashsale|sharing/iu],
    ['storefront', /storefront|contentblock|review|traffic|translation|systemannouncement/iu],
    [
        'settings',
        /channel|seller|store(?!front)|commerce|settings|finance|currency|rate|shipping|tax|country|zone|role|administrator|platformownership|job|scheduledtask|apikey|incident|govern(?:ed|ance)|dataretention|datasubject/iu,
    ],
    [
        'plugins',
        /icloud|twofactor|imagegeneration|imageprovider|imageskill|image(?:model|promptskill|output)|clientplugin|telegram|incident/iu,
    ],
];
// Session transitions own their existing redirect/cache lifecycle, rather than page refresh.
const authTransitionFields = new Set([
    'adminBeginLogin',
    'adminVerifyLoginTwoFactor',
    'adminLogout',
    'login',
    'logout',
    'completeInitialPasswordChange',
]);
export function resourceDomains(document: DocumentNode): ResourceDomain[] {
    const operation = getOperationAST(document);
    const fields =
        operation?.selectionSet.selections
            .filter(selection => selection.kind === 'Field')
            .map(selection => selection.name.value)
            .filter(name => !authTransitionFields.has(name))
            .join(' ') ?? '';
    return domainRules.filter(([, pattern]) => pattern.test(fields)).map(([domain]) => domain);
}
export function resourceMatchesDomains(key: string, domains: ResourceDomain[]) {
    return domainRules.some(([domain, pattern]) => domains.includes(domain) && pattern.test(key));
}
export function invalidateAdminResources(domains: ResourceDomain[], reason: 'write' | 'event' = 'write') {
    if (domains.length && typeof window !== 'undefined')
        window.dispatchEvent(new CustomEvent(RESOURCE_INVALIDATION_EVENT, { detail: { domains, reason } }));
}

/** This read-side link does not retry, deduplicate or reinterpret business writes. */
export function createResourceInvalidationLink(scope: () => string) {
    return new ApolloLink((operation, forward) => {
        if (getOperationAST(operation.query)?.operation !== 'mutation') return forward(operation);
        const initialScope = scope();
        let emitted = false;
        return new Observable(observer => {
            let finished = false;
            publishWriteState(1);
            const finish = () => {
                if (!finished) {
                    finished = true;
                    publishWriteState(-1);
                }
            };
            let subscription: { unsubscribe(): void } | undefined;
            try {
                subscription = forward(operation).subscribe({
                    next: result => {
                        const errors = (result as { errors?: unknown[] }).errors;
                        if (
                            !emitted &&
                            initialScope === scope() &&
                            result.data &&
                            !errors?.length &&
                            !extractMutationFailureDetails(result.data)
                        ) {
                            emitted = true;
                            invalidateAdminResources(resourceDomains(operation.query));
                        }
                        observer.next(result);
                    },
                    error: error => {
                        finish();
                        observer.error(error);
                    },
                    complete: () => {
                        finish();
                        observer.complete();
                    },
                });
            } catch (error) {
                finish();
                observer.error(error);
            }
            return () => {
                subscription?.unsubscribe();
                finish();
            };
        });
    });
}
