import { gql } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { useState } from 'react';
import { AdminButton, AdminInput, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { useServerDraft } from '../../hooks/use-server-draft';
import { refreshAfterAdminWrite } from '../../utils/admin-write-readback';
import { toUserFacingError } from '../../utils/user-facing-error';

const RULE = gql`
    fragment SyncRuleFields on CatalogSyncRule {
        id
        sourceChannelId
        sourceCollectionId
        targetChannelId
        includeDescendants
        enabled
        version
        state
        cursor
        lastSyncedAt
        error
    }
`;
export const SYNC_RULES = gql`
    query CatalogSyncRules {
        catalogSyncRules {
            ...SyncRuleFields
        }
    }
    ${RULE}
`;
const ISSUES = gql`
    query CatalogSyncIssues($ruleId: ID!, $skip: Int!) {
        catalogSyncIssues(ruleId: $ruleId, skip: $skip, take: 100) {
            totalItems
            items {
                kind
                sourceId
                state
                error
            }
        }
    }
`;
const SAVE = gql`
    mutation SaveSyncRule($input: CatalogSyncRuleInput!) {
        saveCatalogSyncRule(input: $input) {
            ...SyncRuleFields
        }
    }
    ${RULE}
`;
const PREVIEW = gql`
    mutation PreviewSyncRule($input: CatalogSyncRuleInput!) {
        previewCatalogSyncRule(input: $input) {
            fingerprint
            productCount
            categoryCount
            takeoverCount
            blockers
            items {
                productId
                name
                takeover
                blockers
                pendingReasons
                prices {
                    variantId
                    price
                    currencyCode
                }
            }
        }
    }
`;
const ENABLE = gql`
    mutation EnableSyncRule($id: ID!, $version: Int!, $fingerprint: String!, $acceptTakeover: Boolean!) {
        enableCatalogSyncRule(
            id: $id
            version: $version
            fingerprint: $fingerprint
            acceptTakeover: $acceptTakeover
        ) {
            ...SyncRuleFields
        }
    }
    ${RULE}
`;
const PAUSE = gql`
    mutation PauseSyncRule($id: ID!, $version: Int!) {
        pauseCatalogSyncRule(id: $id, version: $version) {
            ...SyncRuleFields
        }
    }
    ${RULE}
`;
const RECONCILE = gql`
    mutation ReconcileSyncRule($id: ID!) {
        reconcileCatalogSyncRule(id: $id) {
            ...SyncRuleFields
        }
    }
    ${RULE}
`;
interface Rule {
    id: string;
    sourceChannelId: string;
    sourceCollectionId: string;
    targetChannelId: string;
    includeDescendants: boolean;
    enabled: boolean;
    version: number;
    state: string;
    cursor: number;
    error?: string;
    lastSyncedAt?: string;
}
interface Preview {
    fingerprint: string;
    productCount: number;
    categoryCount: number;
    takeoverCount: number;
    blockers: string[];
    items: Array<{
        productId: string;
        name: string;
        takeover: boolean;
        blockers: string[];
        pendingReasons: string[];
        prices: Array<{ variantId: string; price: number | null; currencyCode: string }>;
    }>;
}
interface Props {
    active?: boolean;
    stores: Array<{ id: string; displayName: string; currencyCode: string }>;
    categories: Array<{ id: string; name: string; channelIds: string[] }>;
}
const empty = {
    sourceChannelId: '',
    sourceCollectionId: '',
    targets: [] as string[],
    includeDescendants: true,
};
const control = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm';
const labels: Record<string, string> = {
    DISABLED: '已暂停',
    QUEUED: '等待同步',
    RUNNING: '同步中',
    COMPLETE: '已同步',
    PARTIAL: '部分未完成',
};

export function CatalogContinuousSyncPanel({ stores, categories, active = true }: Props) {
    const rules = useAdminQuery<{ catalogSyncRules: Rule[] }>(SYNC_RULES, {
        pollInterval: 15_000,
        skip: !active,
    });
    const form = useServerDraft('catalog-sync-new-rule', '1', empty);
    const draft = form.draft ?? empty;
    const [issueRuleId, setIssueRuleId] = useState('');
    const [issuePage, setIssuePage] = useState(0);
    const issues = useAdminQuery<{
        catalogSyncIssues: {
            totalItems: number;
            items: Array<{ kind: string; sourceId: string; state: string; error: string }>;
        };
    }>(ISSUES, { variables: { ruleId: issueRuleId, skip: issuePage * 100 }, skip: !active || !issueRuleId });
    const [save, saving] = useMutation<{ saveCatalogSyncRule: Rule }>(SAVE);
    const [preview, previewing] = useMutation<{ previewCatalogSyncRule: Preview }>(PREVIEW);
    const [enable, enabling] = useMutation(ENABLE);
    const [pause, pausing] = useMutation(PAUSE);
    const [reconcile, reconciling] = useMutation(RECONCILE);
    const [selected, setSelected] = useState<{ rule: Rule; preview: Preview } | null>(null);
    const [takeover, setTakeover] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [completedTargets, setCompletedTargets] = useState<string[]>([]);
    const busy =
        saving.loading || previewing.loading || enabling.loading || pausing.loading || reconciling.loading;
    const name = (id: string) => stores.find(s => s.id === id)?.displayName ?? '店铺待核对';
    const change = (value: Partial<typeof empty>) => {
        form.setDraft({ ...draft, ...value });
        setSelected(null);
        setCompletedTargets([]);
        setMessage('');
    };
    const refresh = () => refreshAfterAdminWrite(() => rules.refetch(), setError);
    const create = async () => {
        setError('');
        setMessage('');
        const done = [...completedTargets];
        try {
            for (const targetChannelId of draft.targets.filter(id => !done.includes(id))) {
                const existing = rules.data?.catalogSyncRules.find(
                    r =>
                        r.sourceChannelId === draft.sourceChannelId &&
                        r.sourceCollectionId === draft.sourceCollectionId &&
                        r.targetChannelId === targetChannelId,
                );
                if (existing && existing.includeDescendants === draft.includeDescendants) {
                    done.push(targetChannelId);
                    continue;
                }
                if (existing?.enabled) throw new Error('请先暂停已有规则，再修改是否包含子分类');
                await save({
                    variables: {
                        input: {
                            ...(existing ? { id: existing.id, version: existing.version } : {}),
                            sourceChannelId: draft.sourceChannelId,
                            sourceCollectionId: draft.sourceCollectionId,
                            targetChannelId,
                            includeDescendants: draft.includeDescendants,
                        },
                    },
                });
                done.push(targetChannelId);
                setCompletedTargets([...done]);
            }
            form.accept(empty);
            setCompletedTargets([]);
            setMessage(
                '新建或修改的规则已保存为关闭状态，已有规则保留原状态。请在列表生成预览，再启用持续同步。',
            );
        } catch (cause) {
            setError(toUserFacingError(cause, '部分规则未保存；已成功保存的目标不会重复提交'));
        }
        await refresh();
    };
    const showPreview = async (rule: Rule) => {
        setError('');
        setMessage('');
        setSelected(null);
        setTakeover(false);
        try {
            const result = await preview({
                variables: {
                    input: {
                        id: rule.id,
                        version: rule.version,
                        sourceChannelId: rule.sourceChannelId,
                        sourceCollectionId: rule.sourceCollectionId,
                        targetChannelId: rule.targetChannelId,
                        includeDescendants: rule.includeDescendants,
                    },
                },
            });
            if (result.data) setSelected({ rule, preview: result.data.previewCatalogSyncRule });
        } catch (cause) {
            setError(toUserFacingError(cause, '预览失败，请重试'));
        }
    };
    const execute = async (rule: Rule, action: 'enable' | 'pause' | 'reconcile') => {
        setError('');
        setMessage('');
        try {
            if (action === 'enable' && selected)
                await enable({
                    variables: {
                        id: rule.id,
                        version: rule.version,
                        fingerprint: selected.preview.fingerprint,
                        acceptTakeover: takeover,
                    },
                });
            else if (action === 'pause') await pause({ variables: { id: rule.id, version: rule.version } });
            else await reconcile({ variables: { id: rule.id } });
            setSelected(null);
            setMessage(
                action === 'pause'
                    ? '持续同步已暂停，停止新的同步销售；已接受订单继续履约。'
                    : '操作已受理，请查看各目标的实际同步结果。',
            );
            await refresh();
        } catch (cause) {
            setError(toUserFacingError(cause, '操作失败，请刷新后核对状态'));
        }
    };
    return (
        <section className="space-y-4 rounded-xl bg-white p-4" aria-label="分类持续同步">
            <h2 className="text-lg font-bold">分类持续同步与共用货源</h2>
            <p className="text-sm text-slate-600">
                A 统一维护商品、分类、售价、库存和交付。B
                持续跟随，共用真实库存；跨币种按目标店铺已有手动汇率换算，自动汇率或缺少规则时保持待配置。
            </p>
            {message && <p role="status">{message}</p>}
            {error && (
                <p role="alert" className="text-red-600">
                    {error}
                </p>
            )}
            <div className="grid gap-3 lg:grid-cols-2">
                <AdminField label="来源店铺">
                    <AdminSelect
                        aria-label="持续同步来源店铺"
                        className={control}
                        value={draft.sourceChannelId}
                        disabled={busy}
                        onChange={e =>
                            change({ sourceChannelId: e.target.value, sourceCollectionId: '', targets: [] })
                        }
                    >
                        <option value="">请选择来源经营店铺</option>
                        {stores.map(s => (
                            <option key={s.id} value={s.id}>
                                {s.displayName}
                            </option>
                        ))}
                    </AdminSelect>
                </AdminField>
                <AdminField label="来源分类">
                    <AdminSelect
                        aria-label="持续同步来源分类"
                        className={control}
                        value={draft.sourceCollectionId}
                        disabled={busy || !draft.sourceChannelId}
                        onChange={e => change({ sourceCollectionId: e.target.value })}
                    >
                        <option value="">请选择分类</option>
                        {categories
                            .filter(c => c.channelIds.includes(draft.sourceChannelId))
                            .map(c => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                    </AdminSelect>
                </AdminField>
            </div>
            <label className="flex items-center gap-2">
                <AdminInput
                    type="checkbox"
                    checked={draft.includeDescendants}
                    disabled={busy}
                    onChange={e => change({ includeDescendants: e.target.checked })}
                />
                包含全部子分类及全部分页，分类层级持续跟随
            </label>
            <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">目标店铺</legend>
                <div className="flex flex-wrap gap-4">
                    {stores
                        .filter(s => s.id !== draft.sourceChannelId)
                        .map(s => (
                            <label key={s.id} className="flex items-center gap-2">
                                <AdminInput
                                    type="checkbox"
                                    disabled={busy || !draft.sourceChannelId}
                                    checked={draft.targets.includes(s.id)}
                                    onChange={() =>
                                        change({
                                            targets: draft.targets.includes(s.id)
                                                ? draft.targets.filter(id => id !== s.id)
                                                : [...draft.targets, s.id],
                                        })
                                    }
                                />
                                {s.displayName} · {s.currencyCode}
                            </label>
                        ))}
                </div>
            </fieldset>
            <AdminButton
                type="button"
                className={control}
                disabled={busy || !draft.sourceCollectionId || !draft.targets.length}
                onClick={() => void create()}
            >
                保存为关闭的规则
            </AdminButton>
            <div className="flex items-center justify-between">
                <h3 className="font-bold">各目标同步状态</h3>
                <AdminButton
                    refreshPage
                    className={control}
                    disabled={busy || rules.loading}
                    onClick={() => void rules.refetch()}
                >
                    刷新同步状态
                </AdminButton>
            </div>
            {rules.loading && !rules.data ? <p role="status">正在读取同步规则…</p> : null}
            {rules.error && (
                <p role="alert">
                    同步状态更新失败，已显示的数据保留。
                    <AdminButton onClick={() => void rules.refetch()}>重试读取</AdminButton>
                </p>
            )}
            {rules.data?.catalogSyncRules.length === 0 && <p>尚未建立持续同步规则，现有店铺经营不受影响。</p>}
            <div className="space-y-3">
                {rules.data?.catalogSyncRules.map(rule => (
                    <article key={rule.id} className="space-y-2 border-b border-slate-100 py-3">
                        <h4 className="font-semibold">
                            {name(rule.sourceChannelId)} /{' '}
                            {categories.find(c => c.id === rule.sourceCollectionId)?.name ?? '来源分类待核对'}{' '}
                            → {name(rule.targetChannelId)}
                        </h4>
                        <p className="text-sm">
                            {labels[rule.state] ?? '状态待核对'}
                            {rule.state === 'RUNNING' ? ` · 已处理到商品 ${rule.cursor}` : ''} ·{' '}
                            {rule.includeDescendants ? '含子分类' : '仅当前分类'} ·{' '}
                            {rule.lastSyncedAt
                                ? `上次完成：${new Date(rule.lastSyncedAt).toLocaleString()}`
                                : '尚未完成同步'}
                        </p>
                        {rule.error && (
                            <p role="alert" className="text-red-600">
                                {rule.error}
                            </p>
                        )}
                        {rule.state === 'PARTIAL' && (
                            <AdminButton
                                className={control}
                                onClick={() => {
                                    setIssueRuleId(rule.id);
                                    setIssuePage(0);
                                }}
                            >
                                查看逐项原因
                            </AdminButton>
                        )}
                        <div className="flex flex-wrap gap-2">
                            <AdminButton
                                className={control}
                                disabled={busy}
                                onClick={() => void showPreview(rule)}
                            >
                                生成同步预览
                            </AdminButton>
                            {rule.enabled && (
                                <>
                                    <AdminButton
                                        className={control}
                                        disabled={busy}
                                        onClick={() => void execute(rule, 'reconcile')}
                                    >
                                        重新对账／续做失败项
                                    </AdminButton>
                                    <AdminButton
                                        className={control}
                                        disabled={busy}
                                        onClick={() => void execute(rule, 'pause')}
                                    >
                                        暂停同步销售
                                    </AdminButton>
                                </>
                            )}
                        </div>
                    </article>
                ))}
            </div>
            {issueRuleId && (
                <div aria-label="同步逐项原因" className="space-y-2">
                    <h3 className="font-semibold">待处理项目</h3>
                    {issues.loading && !issues.data && <p role="status">正在读取逐项原因…</p>}
                    {issues.error && (
                        <p role="alert">
                            原因读取失败。
                            <AdminButton onClick={() => void issues.refetch()}>重试读取</AdminButton>
                        </p>
                    )}
                    <ul>
                        {issues.data?.catalogSyncIssues.items.map(item => (
                            <li key={`${item.kind}-${item.sourceId}`}>
                                {item.kind} #{item.sourceId} · {item.state === 'PENDING' ? '待配置' : '失败'}
                                ：{item.error}
                            </li>
                        ))}
                    </ul>
                    {issues.data?.catalogSyncIssues.totalItems === 0 && <p>没有待处理项目。</p>}
                    <div className="flex gap-2">
                        <AdminButton
                            disabled={issuePage === 0 || issues.loading}
                            onClick={() => setIssuePage(page => page - 1)}
                        >
                            上一页原因
                        </AdminButton>
                        <AdminButton
                            disabled={
                                issues.loading ||
                                !issues.data ||
                                (issuePage + 1) * 100 >= issues.data.catalogSyncIssues.totalItems
                            }
                            onClick={() => setIssuePage(page => page + 1)}
                        >
                            下一页原因
                        </AdminButton>
                        <AdminButton onClick={() => setIssueRuleId('')}>关闭原因</AdminButton>
                    </div>
                </div>
            )}
            {selected && (
                <div className="space-y-3" aria-label="持续同步预览">
                    <h3 className="font-bold">
                        同步到 {name(selected.rule.targetChannelId)}：{selected.preview.productCount} 个商品，
                        {selected.preview.categoryCount} 个分类
                    </h3>
                    <p className="text-sm">
                        已有配置接管 {selected.preview.takeoverCount}{' '}
                        个。库存、卡密和文件共用来源；现有客户、订单和收款配置保持归目标店铺。
                    </p>
                    {selected.preview.blockers.map(reason => (
                        <p role="alert" key={reason} className="text-red-600">
                            {reason}
                        </p>
                    ))}
                    <div className="max-h-80 overflow-auto">
                        <table className="admin-mobile-record-table w-full text-left text-sm">
                            <thead>
                                <tr>
                                    <th>商品</th>
                                    <th>目标标价</th>
                                    <th>处理说明</th>
                                </tr>
                            </thead>
                            <tbody>
                                {selected.preview.items.map(item => (
                                    <tr key={item.productId}>
                                        <td data-label="商品">{item.name}</td>
                                        <td data-label="目标标价">
                                            {item.prices
                                                .map(p =>
                                                    p.price == null
                                                        ? `${p.variantId}：待配置`
                                                        : `${p.variantId}：${(p.price / 100).toFixed(2)} ${p.currencyCode}`,
                                                )
                                                .join('；')}
                                        </td>
                                        <td data-label="处理说明">
                                            {[...item.blockers, ...(item.pendingReasons ?? [])].join('；') ||
                                                (item.takeover ? '将接管已有经营设置' : '由来源统一管理')}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {selected.preview.takeoverCount > 0 && (
                        <label className="flex items-center gap-2">
                            <AdminInput
                                type="checkbox"
                                checked={takeover}
                                disabled={busy}
                                onChange={e => setTakeover(e.target.checked)}
                            />
                            已核对并确认接管预览中的已有经营配置
                        </label>
                    )}
                    {!selected.rule.enabled && (
                        <AdminButton
                            className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
                            disabled={
                                busy ||
                                selected.preview.blockers.length > 0 ||
                                (selected.preview.takeoverCount > 0 && !takeover)
                            }
                            onClick={() => void execute(selected.rule, 'enable')}
                        >
                            启用此分类持续同步
                        </AdminButton>
                    )}
                </div>
            )}
        </section>
    );
}
