import { ApolloLink, Observable } from '@apollo/client';
import { getOperationAST, parse, type DocumentNode, type SelectionSetNode } from 'graphql';
import { hasAcceptedMutationResult } from '../utils/admin-mutation-feedback';

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
        /order|fulfillment|refund|payment|aftersales|autocard|profit|manualdigitaldelivery|checkoutdelivery|digitaldelivery|physicalreturn|migratedigitalinventory/iu,
    ],
    ['customers', /customer|address/iu],
    ['marketing', /promotion|coupon|referral|withdrawal|marketing|flashsale|sharing/iu],
    ['storefront', /catalogsyncrule|storefront|contentblock|review|traffic|translation|systemannouncement/iu],
    [
        'settings',
        /catalogsyncrule|channel|seller|store(?!front)|commerce|settings|finance|currency|rate|shipping|tax|country|zone|role|administrator|platformownership|job|scheduledtask|apikey|incident|govern(?:ed|ance)|dataretention|datasubject|migratedigitalinventory/iu,
    ],
    [
        'plugins',
        /gptrecharge|icloud|twofactor|imagegeneration|imageprovider|imageskill|image(?:model|promptskill|output)|clientplugin|telegram|incident/iu,
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
const documentDomains = new WeakMap<DocumentNode, ResourceDomain[]>();
const offlineResourceFields = new Set([
    'confirmOfflinePayment',
    'retryOfflinePaymentReview',
    'prepareOfflinePaymentRefund',
    'prepareLegacyOfflineOrder',
    'submitLegacyOfflineOrder',
]);
/** Root fields, including fragments and aliases, describe data; variables and context never do. */
export function resourceDomains(document: DocumentNode): ResourceDomain[] {
    const cached = documentDomains.get(document);
    if (cached) return cached;
    const fragments = new Map(
        document.definitions.flatMap(definition =>
            definition.kind === 'FragmentDefinition'
                ? [[definition.name.value, definition.selectionSet] as const]
                : [],
        ),
    );
    const fields: string[] = [];
    const seen = new Set<string>();
    const collect = (selection: SelectionSetNode) => {
        for (const entry of selection.selections) {
            if (entry.kind === 'Field') {
                if (!authTransitionFields.has(entry.name.value)) fields.push(entry.name.value);
            } else if (entry.kind === 'InlineFragment') collect(entry.selectionSet);
            else if (!seen.has(entry.name.value)) {
                seen.add(entry.name.value);
                const fragment = fragments.get(entry.name.value);
                if (fragment) collect(fragment);
            }
        }
    };
    const operation = getOperationAST(document);
    if (operation) collect(operation.selectionSet);
    const names = fields.join(' ');
    const domains = domainRules.filter(([, pattern]) => pattern.test(names)).map(([domain]) => domain);
    if (fields.some(field => offlineResourceFields.has(field))) {
        for (const domain of ['catalog', 'orders', 'marketing'] as const)
            if (!domains.includes(domain)) domains.push(domain);
    }
    documentDomains.set(document, domains);
    return domains;
}
export function resourceMatchesDomains(document: DocumentNode | string, domains: readonly ResourceDomain[]) {
    // String support is for source-document tooling; opaque Runtime identities are never parsed.
    const resource = resourceDomains(typeof document === 'string' ? parse(document) : document);
    return resource.some(domain => domains.includes(domain));
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
                        if (
                            !emitted &&
                            initialScope === scope() &&
                            result.data &&
                            hasAcceptedMutationResult(result.data)
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
