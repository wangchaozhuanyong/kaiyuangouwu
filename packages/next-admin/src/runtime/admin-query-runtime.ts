import { getOperationAST, print, type DocumentNode } from 'graphql';

export type RefreshReason = 'manual' | 'activation' | 'reconnect' | 'event' | 'write';
export interface ResourcePolicy {
    staleTime: number;
    pollInterval: number;
    stage: number;
}
export interface ResourceOwner {
    page: string;
    active: boolean;
    loading: boolean;
    hasData: boolean;
    error?: unknown;
    fetch: () => Promise<unknown>;
}
interface Resource {
    owners: Map<string, ResourceOwner>;
    policy: ResourcePolicy;
    updatedAt: number;
    invalidatedAt: number;
    pending?: Promise<unknown>;
}
export interface PageQueryState {
    resources: number;
    loading: boolean;
    refreshing: boolean;
    failed: number;
    hasData: boolean;
}

const documents = new WeakMap<DocumentNode, string>();
export function canonicalValue(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
    return `{${Object.keys(value)
        .sort()
        .filter(key => (value as Record<string, unknown>)[key] !== undefined)
        .map(key => `${JSON.stringify(key)}:${canonicalValue((value as Record<string, unknown>)[key])}`)
        .join(',')}}`;
}
export function resourceIdentity(
    document: DocumentNode,
    variables: unknown,
    context: unknown,
    scope: string,
) {
    let source = documents.get(document);
    if (!source) {
        source = print(document);
        documents.set(document, source);
    }
    return `${scope}|${source}|${canonicalValue(variables)}|${canonicalValue(context)}`;
}

/** Policies describe data, never a merchant name or domain. */
export function queryPolicy(document: DocumentNode, variables?: Record<string, any>): ResourcePolicy {
    const name = getOperationAST(document)?.name?.value ?? '';
    const realtime =
        /SystemOps|Telegram.*(?:Logs|Panel)|CardPool|AutoCard.*(?:Stock|Deliver)|ContentTranslationAudit/u.test(
            name,
        );
    const report = /Dashboard|Traffic|ReferralOverview/u.test(name);
    const config =
        /ServerConfig|ActiveChannel|CatalogChannels|StockLocations|CommerceMode|Countries|Zones|TaxCategories/u.test(
            name,
        );
    const aiJob = /ProductAiImage.*(?:Job|Task)|ImageGenerationTask/u.test(name);
    const secondary =
        /CatalogProductOperations/u.test(name) ||
        (/CatalogChannelAssignments/u.test(name) && Boolean(variables?.options?.filter?.id?.in));
    const primary = /^(?:GetProducts|GetOrders|GetCustomers)$/u.test(name);
    return {
        staleTime: config ? 300_000 : report ? 60_000 : 30_000,
        pollInterval: aiJob ? 2_500 : realtime ? 15_000 : report ? 60_000 : 0,
        stage: secondary ? 2 : primary ? 1 : 0,
    };
}

/** Metadata only: Apollo remains the sole shared server-data cache. */
export class AdminQueryRuntime {
    private resources = new Map<string, Resource>();
    private pageListeners = new Map<string, Set<() => void>>();
    private resourceListeners = new Map<string, Set<() => void>>();
    private pageVersions = new Map<string, number>();
    private pageResources = new Map<string, Set<string>>();
    private pages = new Map<string, Promise<PromiseSettledResult<unknown>[]>>();
    private preparations = new Map<string, Set<() => void>>();
    constructor(private now: () => number = Date.now) {}
    subscribePage = (page: string, listener: () => void) => {
        const unsubscribe = this.subscribeTo(this.pageListeners, page, listener);
        return () => {
            unsubscribe();
            if (!this.pageListeners.has(page) && !this.pageResources.has(page))
                this.pageVersions.delete(page);
        };
    };
    subscribeResource = (key: string, listener: () => void) =>
        this.subscribeTo(this.resourceListeners, key, listener);
    pageSnapshot = (page: string) => this.pageVersions.get(page) ?? 0;
    private subscribeTo(subscriptions: Map<string, Set<() => void>>, key: string, listener: () => void) {
        const listeners = subscriptions.get(key) ?? new Set();
        listeners.add(listener);
        subscriptions.set(key, listeners);
        return () => {
            listeners.delete(listener);
            if (!listeners.size) subscriptions.delete(key);
        };
    }
    private indexOwner(key: string, page: string) {
        const keys = this.pageResources.get(page) ?? new Set();
        keys.add(key);
        this.pageResources.set(page, keys);
    }
    private unindexOwner(key: string, page: string) {
        if ([...(this.resources.get(key)?.owners.values() ?? [])].some(owner => owner.page === page)) return;
        const keys = this.pageResources.get(page);
        keys?.delete(key);
        if (!keys?.size) this.pageResources.delete(page);
    }
    preparePage(page: string, callback: () => void) {
        const callbacks = this.preparations.get(page) ?? new Set();
        callbacks.add(callback);
        this.preparations.set(page, callbacks);
        return () => {
            callbacks.delete(callback);
            if (!callbacks.size) this.preparations.delete(page);
        };
    }
    private publish(keys: Iterable<string>, extraPages: string[] = []) {
        const pages = new Set(extraPages);
        for (const key of keys) {
            this.resourceListeners.get(key)?.forEach(listener => listener());
            this.resources.get(key)?.owners.forEach(owner => pages.add(owner.page));
        }
        if (pages.has('@shell')) {
            for (const page of this.pageResources.keys()) pages.add(page);
            for (const page of this.pageListeners.keys()) pages.add(page);
        }
        for (const page of pages) {
            this.pageVersions.set(page, this.pageSnapshot(page) + 1);
            this.pageListeners.get(page)?.forEach(listener => listener());
        }
    }

    register(key: string, ownerId: string, owner: ResourceOwner, policy: ResourcePolicy) {
        let resource = this.resources.get(key);
        if (!resource) {
            resource = { owners: new Map(), policy, updatedAt: 0, invalidatedAt: 0 };
            this.resources.set(key, resource);
        }
        const previousPage = resource.owners.get(ownerId)?.page;
        resource.owners.set(ownerId, owner);
        if (previousPage && previousPage !== owner.page) this.unindexOwner(key, previousPage);
        this.indexOwner(key, owner.page);
        resource.policy = policy;
        this.publish([key], previousPage ? [previousPage] : []);
        // Bound inactive metadata without evicting an open page or its Apollo cache.
        if (this.resources.size > 512) {
            for (const [candidate, item] of this.resources) {
                if (!item.owners.size && !item.pending) this.resources.delete(candidate);
                if (this.resources.size <= 512) break;
            }
        }
        return () => {
            resource!.owners.delete(ownerId);
            this.unindexOwner(key, owner.page);
            this.publish([key], [owner.page]);
            if (!this.pageResources.has(owner.page) && !this.pageListeners.has(owner.page))
                this.pageVersions.delete(owner.page);
        };
    }
    update(key: string, ownerId: string, patch: Partial<ResourceOwner>, networkCompleted = false) {
        const resource = this.resources.get(key);
        const owner = resource?.owners.get(ownerId);
        if (!resource || !owner) return;
        const changed = Object.entries(patch).some(
            ([field, value]) => owner[field as keyof ResourceOwner] !== value,
        );
        const previousPage = owner.page;
        Object.assign(owner, patch);
        if (previousPage !== owner.page) {
            this.unindexOwner(key, previousPage);
            this.indexOwner(key, owner.page);
        }
        if (networkCompleted && !owner.error && owner.hasData) {
            resource.updatedAt = this.now();
        }
        if (changed || networkCompleted) this.publish([key], [previousPage]);
    }
    isStale(key: string) {
        const item = this.resources.get(key);
        return (
            !item ||
            item.updatedAt === 0 ||
            item.invalidatedAt > 0 ||
            this.now() - item.updatedAt >= item.policy.staleTime
        );
    }
    invalidate(predicate: (key: string) => boolean = () => true) {
        const changed: string[] = [];
        for (const [key, item] of this.resources) {
            if (!predicate(key)) continue;
            item.invalidatedAt = Math.max(this.now() || 1, item.invalidatedAt + 1);
            changed.push(key);
        }
        this.publish(changed);
    }
    state(page: string): PageQueryState {
        const keys = new Set([
            ...(this.pageResources.get(page) ?? []),
            ...(this.pageResources.get('@shell') ?? []),
        ]);
        const owners = [...keys].flatMap(key => {
            const item = this.resources.get(key)!;
            const owner =
                [...item.owners.values()].find(value => value.page === page && value.active) ??
                [...item.owners.values()].find(value => value.page === '@shell' && value.active);
            return owner ? [{ ...owner, pending: Boolean(item.pending) }] : [];
        });
        return {
            resources: owners.length,
            loading: owners.some(owner => owner.loading && !owner.hasData),
            refreshing: owners.some(owner => owner.pending || (owner.loading && owner.hasData)),
            failed: owners.filter(owner => owner.error).length,
            hasData: owners.some(owner => owner.page === page && owner.hasData),
        };
    }
    refreshResource(key: string): Promise<any> {
        const item = this.resources.get(key);
        if (!item) return Promise.resolve(undefined);
        if (item.pending) return item.pending;
        const owner = [...item.owners.values()].find(value => value.active);
        if (!owner) {
            item.invalidatedAt = this.now() || 1;
            return Promise.resolve(undefined);
        }
        // Store the promise before executing fetch so simultaneous callers join it.
        const invalidation = item.invalidatedAt;
        item.pending = Promise.resolve()
            .then(owner.fetch)
            .then(result => {
                item.updatedAt = this.now();
                if (item.invalidatedAt === invalidation) item.invalidatedAt = 0;
                return result;
            })
            .finally(() => {
                item.pending = undefined;
                this.publish([key]);
            });
        this.publish([key]);
        return item.pending;
    }
    refreshPage(page: string, reason: RefreshReason = 'manual'): Promise<PromiseSettledResult<unknown>[]> {
        const existing = this.pages.get(page);
        if (existing)
            return reason === 'write' || reason === 'event'
                ? existing.then(() => this.refreshPage(page, reason))
                : existing;
        const work = (async () => {
            const results: PromiseSettledResult<unknown>[] = [];
            this.preparations.get(page)?.forEach(prepare => prepare());
            if (this.preparations.has(page)) await new Promise(resolve => setTimeout(resolve, 0));
            for (const stage of [0, 1, 2]) {
                const keys = [...this.resources]
                    .filter(
                        ([key, item]) =>
                            item.policy.stage === stage &&
                            (reason === 'manual' || this.isStale(key)) &&
                            [...item.owners.values()].some(
                                owner => (owner.page === page || owner.page === '@shell') && owner.active,
                            ),
                    )
                    .map(([key]) => key);
                results.push(...(await Promise.allSettled(keys.map(key => this.refreshResource(key)))));
                // React commits dependent query variables before the next stage is collected.
                if (stage < 2) await new Promise(resolve => setTimeout(resolve, 0));
            }
            return results;
        })().finally(() => {
            this.pages.delete(page);
            this.publish([], [page]);
        });
        this.pages.set(page, work);
        return work;
    }
}

const runtimes = new WeakMap<object, AdminQueryRuntime>();
export function getQueryRuntime(client: object) {
    let runtime = runtimes.get(client);
    if (!runtime) {
        runtime = new AdminQueryRuntime();
        runtimes.set(client, runtime);
    }
    return runtime;
}
