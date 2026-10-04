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
    private listeners = new Set<() => void>();
    private version = 0;
    private pages = new Map<string, Promise<PromiseSettledResult<unknown>[]>>();
    private preparations = new Map<string, Set<() => void>>();
    constructor(private now: () => number = Date.now) {}
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    snapshot = () => this.version;
    preparePage(page: string, callback: () => void) {
        const callbacks = this.preparations.get(page) ?? new Set();
        callbacks.add(callback);
        this.preparations.set(page, callbacks);
        return () => {
            callbacks.delete(callback);
            if (!callbacks.size) this.preparations.delete(page);
        };
    }
    private publish() {
        this.version++;
        this.listeners.forEach(listener => listener());
    }

    register(key: string, ownerId: string, owner: ResourceOwner, policy: ResourcePolicy) {
        let resource = this.resources.get(key);
        if (!resource) {
            resource = { owners: new Map(), policy, updatedAt: 0, invalidatedAt: 0 };
            this.resources.set(key, resource);
        }
        resource.owners.set(ownerId, owner);
        resource.policy = policy;
        this.publish();
        // Bound inactive metadata without evicting an open page or its Apollo cache.
        if (this.resources.size > 512) {
            for (const [candidate, item] of this.resources) {
                if (!item.owners.size && !item.pending) this.resources.delete(candidate);
                if (this.resources.size <= 512) break;
            }
        }
        return () => {
            resource!.owners.delete(ownerId);
            this.publish();
        };
    }
    update(key: string, ownerId: string, patch: Partial<ResourceOwner>, networkCompleted = false) {
        const resource = this.resources.get(key);
        const owner = resource?.owners.get(ownerId);
        if (!resource || !owner) return;
        const changed = Object.entries(patch).some(
            ([field, value]) => owner[field as keyof ResourceOwner] !== value,
        );
        Object.assign(owner, patch);
        if (networkCompleted && !owner.error && owner.hasData) {
            resource.updatedAt = this.now();
        }
        if (changed || networkCompleted) this.publish();
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
        for (const [key, item] of this.resources)
            if (predicate(key)) item.invalidatedAt = Math.max(this.now() || 1, item.invalidatedAt + 1);
        this.publish();
    }
    state(page: string): PageQueryState {
        const owners = [...this.resources.values()].flatMap(item => {
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
                this.publish();
            });
        this.publish();
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
            this.publish();
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
