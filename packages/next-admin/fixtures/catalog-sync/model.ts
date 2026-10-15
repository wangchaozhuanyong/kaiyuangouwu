import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';

interface Rule {
    __typename: 'CatalogSyncRule';
    id: string;
    version: number;
    sourceChannelId: string;
    sourceCollectionId: string;
    targetChannelId: string;
    includeDescendants: boolean;
    enabled: boolean;
    state: string;
    cursor: number;
    lastSyncedAt: string | null;
    error: string | null;
}
export function createCatalogSyncFixture(options: { takeover?: boolean; failReadback?: boolean } = {}) {
    const state = {
        rules: [] as Rule[],
        operations: [] as Array<{ name: string; variables: Record<string, unknown> }>,
        failReads: 0,
    };
    const stores = [
        { id: 'a', displayName: '来源店铺 A', currencyCode: 'CNY' },
        { id: 'b', displayName: '销售店铺 B', currencyCode: 'MYR' },
        { id: 'c', displayName: '销售店铺 C', currencyCode: 'CNY' },
    ];
    const categories = [
        { id: 'source-category', name: '会员服务', channelIds: ['a'], parentId: null },
        { id: 'source-child', name: '月度订阅', channelIds: ['a'], parentId: 'source-category' },
    ];
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    state.operations.push({
                        name: operation.operationName ?? '',
                        variables: structuredClone(operation.variables),
                    });
                    queueMicrotask(() => {
                        try {
                            const variables = operation.variables;
                            let data: Record<string, unknown>;
                            const find = () => {
                                const rule = state.rules.find(r => r.id === variables.id);
                                if (!rule) throw new Error('规则不存在');
                                return rule;
                            };
                            switch (operation.operationName) {
                                case 'PlatformCatalog':
                                    data = {
                                        platformCatalogProducts: {
                                            totalItems: 102,
                                            items: [],
                                            categories,
                                            channels: stores.map(store => ({
                                                ...store,
                                                assignedCount: 0,
                                                coverageDenominator: 102,
                                            })),
                                            ownershipReviewCount: 0,
                                            unassignedCount: 102,
                                        },
                                    };
                                    break;
                                case 'PlatformResources':
                                    data = { platformCatalogResources: [] };
                                    break;
                                case 'CatalogSyncRules':
                                    if (state.failReads > 0) {
                                        state.failReads--;
                                        throw new Error('合成读取失败');
                                    }
                                    data = { catalogSyncRules: state.rules.map(rule => ({ ...rule })) };
                                    break;
                                case 'SaveSyncRule': {
                                    const input = variables.input as Omit<
                                        Rule,
                                        | '__typename'
                                        | 'enabled'
                                        | 'state'
                                        | 'cursor'
                                        | 'lastSyncedAt'
                                        | 'error'
                                    >;
                                    const current = input.id
                                        ? state.rules.find(rule => rule.id === input.id)
                                        : null;
                                    const rule: Rule = {
                                        ...input,
                                        id: current?.id ?? String(state.rules.length + 1),
                                        version: (current?.version ?? 0) + 1,
                                        __typename: 'CatalogSyncRule',
                                        enabled: false,
                                        state: 'DISABLED',
                                        cursor: 0,
                                        lastSyncedAt: null,
                                        error: null,
                                    };
                                    if (current) Object.assign(current, rule);
                                    else state.rules.push(rule);
                                    if (options.failReadback) state.failReads = 1;
                                    data = { saveCatalogSyncRule: { ...rule } };
                                    break;
                                }
                                case 'PreviewSyncRule': {
                                    const input = variables.input as { id: string; version: number };
                                    data = {
                                        previewCatalogSyncRule: {
                                            fingerprint: `fixture-${input.id}-${input.version}`,
                                            productCount: 102,
                                            categoryCount: 2,
                                            takeoverCount: options.takeover ? 1 : 0,
                                            blockers: [],
                                            items: Array.from({ length: 102 }, (_, index) => ({
                                                productId: String(index + 1),
                                                name: `合成商品 ${index + 1}`,
                                                takeover: Boolean(options.takeover && index === 0),
                                                blockers: [],
                                                pendingReasons: [],
                                                prices: [
                                                    {
                                                        variantId: `v${index + 1}`,
                                                        price: index === 2 ? null : 600,
                                                        currencyCode: 'MYR',
                                                    },
                                                ],
                                            })),
                                        },
                                    };
                                    break;
                                }
                                case 'EnableSyncRule': {
                                    const rule = find();
                                    if (
                                        rule.version !== variables.version ||
                                        variables.fingerprint !== `fixture-${rule.id}-${rule.version}`
                                    )
                                        throw new Error('规则已变化，请刷新并重新预览');
                                    if (options.takeover && !variables.acceptTakeover)
                                        throw new Error('请先确认接管');
                                    rule.enabled = true;
                                    rule.state = 'QUEUED';
                                    rule.version++;
                                    data = { enableCatalogSyncRule: { ...rule } };
                                    break;
                                }
                                case 'PauseSyncRule': {
                                    const rule = find();
                                    rule.enabled = false;
                                    rule.state = 'DISABLED';
                                    rule.version++;
                                    data = { pauseCatalogSyncRule: { ...rule } };
                                    break;
                                }
                                case 'ReconcileSyncRule': {
                                    const rule = find();
                                    rule.state = 'QUEUED';
                                    data = { reconcileCatalogSyncRule: { ...rule } };
                                    break;
                                }
                                case 'CatalogSyncIssues':
                                    data = { catalogSyncIssues: { totalItems: 0, items: [] } };
                                    break;
                                default:
                                    data = {};
                            }
                            observer.next({ data });
                            observer.complete();
                        } catch (error) {
                            observer.error(error);
                        }
                    });
                }),
        ),
    });
    return { client, state, stores, categories };
}
