import { gql } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    formatTaxFreeAddress,
    taxFreeAddressFields,
    type TaxFreeAddress,
    type TaxFreeAddressClaim,
} from '../../../../storefront-content-plugin/src/tax-free-address-contract';
import { getAdminQueryScope } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { AdminButton, AdminInput } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { AdminOverlayPortal } from '../../components/AdminOverlayHost';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { PageSizeSelect } from '../../components/PageSizeSelect';
import { SearchInput } from '../../components/SearchInput';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { copyAdminText } from '../../utils/admin-clipboard';
import { normalizePageSize } from '../../utils/pagination';
import { toUserFacingError } from '../../utils/user-facing-error';

interface AddressList {
    items: TaxFreeAddress[];
    totalItems: number;
    unused: number;
    used: number;
    retained: number;
    generated: number;
    revision: number;
    capacity: number;
    limit: number;
}
export const TAX_ADDRESS_LIST = gql`query TaxFreeAddresses($input: TaxFreeAddressListInput) {
    taxFreeAddresses(input: $input) { items { ${taxFreeAddressFields} } totalItems unused used retained generated revision capacity limit }
}`;
export const TAX_ADDRESS_GENERATE = gql`
    mutation GenerateTaxFreeAddresses($count: Int!) {
        generateTaxFreeAddresses(count: $count) {
            count
        }
    }
`;
export const TAX_ADDRESS_TAKE = gql`mutation TakeTaxFreeAddress($id: ID!, $requestId: String!) {
    takeTaxFreeAddress(id: $id, requestId: $requestId) { requestId serverNow nextAllowedAt address { ${taxFreeAddressFields} } }
}`;
export const TAX_ADDRESS_CLEAR = gql`
    mutation ClearUsedTaxFreeAddresses($expectedRevision: Int!) {
        clearUsedTaxFreeAddresses(expectedRevision: $expectedRevision) {
            count
        }
    }
`;
const optionalColumns = [
    ['city', '城市'],
    ['state', '州'],
    ['postalCode', '邮编'],
    ['country', '国家'],
    ['createdAt', '创建时间'],
    ['usedAt', '使用时间'],
] as const;
const secondaryButton =
    'border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50';
const primaryButton =
    'bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50';
const errorText = (error: unknown) => {
    const text = toUserFacingError(error);
    if (text.includes('CAPACITY')) return '地址库已满，不能清理未使用地址。请等待地址被提取。';
    if (text.includes('EXHAUSTED'))
        return '原版 89,000 种街道组合已用尽，需要扩充生成规则；不会重复生成旧地址。';
    if (text.includes('CONFLICT')) return '地址库已更新，请刷新后重新确认清理数量。';
    if (text.includes('ALREADY_USED')) return '该地址已被其他请求提取，请刷新列表。';
    if (text.includes('RESULT_EXPIRED')) return '原请求已完成，地址明细已清理，本次没有重新分配。';
    return '操作未完成或结果无法确认。请刷新核对；生成和清理操作不会自动重试。';
};

export function TaxFreeAddressModule() {
    const [params, setParams] = useSearchParams();
    const status = params.get('status') === 'used' ? 'used' : 'unused';
    const keyword = (params.get('q') ?? '').slice(0, 80);
    const take = normalizePageSize(params.get('take'));
    const page = Math.min(Math.ceil(1000 / take), Math.max(1, Math.floor(Number(params.get('page'))) || 1));
    const updateParams = useCallback(
        (patch: Record<string, string>) => {
            setParams(current => {
                const next = new URLSearchParams(current);
                Object.entries(patch).forEach(([key, value]) => next.set(key, value));
                return next;
            });
        },
        [setParams],
    );
    const query = useAdminQuery<{ taxFreeAddresses: AddressList }>(TAX_ADDRESS_LIST, {
        variables: { input: { status, keyword, skip: (page - 1) * take, take } },
    });
    const list = query.data?.taxFreeAddresses;
    const totalItems = list?.totalItems;
    useEffect(() => {
        if (query.loading || totalItems === undefined) return;
        const lastPage = Math.max(1, Math.ceil(totalItems / take));
        if (page > lastPage) updateParams({ page: String(lastPage) });
    }, [query.loading, totalItems, page, take, updateParams]);
    const scope = getAdminQueryScope();
    const [feedback, setFeedback] = useState({ scope, text: '', failed: false });
    const notice = feedback.scope === scope ? feedback.text : '';
    const [dialog, setDialog] = useState<
        null | { kind: 'generate' } | { kind: 'clear'; count: number; revision: number }
    >(null);
    const [count, setCount] = useState('100');
    const [columnsOpen, setColumnsOpen] = useState(false);
    const [hidden, setHidden] = useState<string[]>([]);
    const [generate, generating] = useMutation(TAX_ADDRESS_GENERATE);
    const [claim, claiming] = useMutation<{ takeTaxFreeAddress: TaxFreeAddressClaim }>(TAX_ADDRESS_TAKE);
    const [clear, clearing] = useMutation<{ clearUsedTaxFreeAddresses: { count: number } }>(
        TAX_ADDRESS_CLEAR,
    );
    const busy = generating.loading || claiming.loading || clearing.loading;
    const lock = useRef(false);
    const copyRequest = useRef<{ id: string; requestId: string; scope: string } | null>(null);
    const visible = optionalColumns.filter(
        ([key]) => !hidden.includes(key) && (key !== 'usedAt' || status === 'used'),
    );
    const say = (text: string, failed = false) => {
        if (getAdminQueryScope() === scope) setFeedback({ scope, text, failed });
    };
    async function afterWrite(message: string) {
        say(message);
        setDialog(null);
        try {
            await query.refetch();
        } catch {
            say(message + ' 最新列表读取失败，请刷新核对，不要重复执行写入。', true);
        }
    }
    async function copy(row: TaxFreeAddress) {
        if (lock.current) return;
        lock.current = true;
        let address = row;
        try {
            if (row.status === 'unused') {
                const request = copyRequest.current;
                const requestId =
                    request?.id === row.id && request.scope === scope
                        ? request.requestId
                        : crypto.randomUUID();
                copyRequest.current = { id: row.id, requestId, scope };
                const result = await claim({ variables: { id: row.id, requestId } });
                if (!result.data) throw new Error('Missing receipt');
                address = result.data.takeTaxFreeAddress.address;
            }
            if (getAdminQueryScope() !== scope) return;
            try {
                if (!(await copyAdminText(formatTaxFreeAddress(address), '地址')))
                    throw new Error('Clipboard denied');
                if (row.status === 'unused') await afterWrite('地址已提取并复制，已移入“已使用”。');
                else say('地址已复制。');
            } catch {
                if (row.status === 'unused')
                    await afterWrite('地址已提取，但复制失败。可在“已使用”中再次复制。');
                else say('复制失败，请选中地址字段手动复制。', true);
            }
            copyRequest.current = null;
        } catch (error) {
            say(errorText(error), true);
        } finally {
            lock.current = false;
        }
    }
    async function submit() {
        if (!dialog || lock.current) return;
        const amount = Number(count);
        if (dialog.kind === 'generate' && (!Number.isInteger(amount) || amount < 1 || amount > 100)) {
            say('生成数量必须为 1～100 的整数。', true);
            return;
        }
        lock.current = true;
        try {
            if (dialog.kind === 'generate') {
                await generate({ variables: { count: amount } });
                await afterWrite(`已生成 ${amount} 条未使用地址。`);
            } else {
                const result = await clear({ variables: { expectedRevision: dialog.revision } });
                await afterWrite(
                    `已清理 ${result.data?.clearUsedTaxFreeAddresses.count ?? 0} 条已使用地址，永久去重记录已保留。`,
                );
            }
        } catch (error) {
            say(errorText(error), true);
        } finally {
            lock.current = false;
        }
    }
    return (
        <section className="space-y-5" data-admin-page="tax-free-address">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="flex items-center gap-2 text-xl font-semibold">
                    免税地址管理
                    <FeatureHelpButton
                        title="免税地址管理"
                        content={{
                            purpose: '管理全平台共享的美国地址模板，客户端无需登录即可提取。',
                            requirements: [
                                '仅平台超级管理员可管理地址池；各店铺在客户端插件中心启用入口',
                                '客户端同一浏览器每 5 分钟一次，后台手动领取不受此限制',
                            ],
                            example: '未使用库存为零时，客户端下一次提取会自动生成 100 条。',
                            impact: '完整地址最多保留 1000 条，优先清理最早已使用地址；永久指纹与领取回执不随清理删除。',
                        }}
                    />
                </h1>
                <div className="flex flex-wrap gap-2">
                    <AdminButton
                        refreshPage
                        className={secondaryButton}
                        disabled={query.loading || busy}
                        onClick={() => void query.refetch()}
                    >
                        刷新
                    </AdminButton>
                    <AdminButton
                        className={primaryButton}
                        disabled={busy || !list}
                        onClick={() => {
                            setCount('100');
                            setDialog({ kind: 'generate' });
                        }}
                    >
                        生成地址
                    </AdminButton>
                </div>
            </header>
            <dl className="grid grid-cols-2 gap-4 rounded-xl bg-white p-4 lg:grid-cols-4">
                {[
                    ['未使用', list?.unused],
                    ['已使用', list?.used],
                    ['当前保留 / 1000', list?.retained],
                    ['累计生成 / 89000', list?.generated],
                ].map(([label, value]) => (
                    <div key={label}>
                        <dt className="text-sm text-slate-500">{label}</dt>
                        <dd className="mt-1 text-xl font-semibold">{value ?? '—'}</dd>
                    </div>
                ))}
            </dl>
            <p className="text-sm text-slate-500">
                库存用完自动补充 100
                条；清理只删除已使用地址明细，永久去重记录始终保留。生成内容为地址模板，使用前请核对。
            </p>
            {notice && (
                <p
                    className="admin-page-status"
                    data-failed={feedback.failed || undefined}
                    role={feedback.failed ? 'alert' : 'status'}
                >
                    {notice}
                </p>
            )}
            {query.error && (
                <p role="alert" className="admin-page-status" data-failed>
                    地址列表读取失败，请点击刷新。{list ? '已保留当前列表。' : ''}
                </p>
            )}
            <div className="flex flex-wrap gap-2" role="group" aria-label="地址状态">
                {(['unused', 'used'] as const).map(value => (
                    <AdminButton
                        key={value}
                        aria-pressed={status === value}
                        className={
                            status === value
                                ? 'border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700'
                                : secondaryButton
                        }
                        disabled={busy}
                        onClick={() => updateParams({ status: value, page: '1' })}
                    >
                        {value === 'unused' ? '未使用' : '已使用'} ({list?.[value] ?? '—'})
                    </AdminButton>
                ))}
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3">
                <AdminField label="搜索街道地址">
                    <SearchInput
                        aria-label="搜索街道地址"
                        placeholder="输入街道地址"
                        value={keyword}
                        onValueChange={value => updateParams({ q: value, page: '1' })}
                        maxLength={80}
                    />
                </AdminField>
                <div className="flex flex-wrap gap-2">
                    <AdminButton
                        className={secondaryButton}
                        aria-expanded={columnsOpen}
                        onClick={() => setColumnsOpen(value => !value)}
                    >
                        列设置
                    </AdminButton>
                    {status === 'used' && (
                        <AdminButton
                            className={secondaryButton}
                            disabled={busy || !list?.used || query.loading || !!query.error}
                            onClick={() =>
                                list &&
                                setDialog({ kind: 'clear', count: list.used, revision: list.revision })
                            }
                        >
                            清理已使用
                        </AdminButton>
                    )}
                </div>
            </div>
            {columnsOpen && (
                <fieldset className="flex flex-wrap gap-4 rounded-lg bg-white p-4">
                    <legend>显示字段</legend>
                    {optionalColumns.map(([key, label]) => (
                        <label className="inline-flex items-center gap-2" key={key}>
                            <AdminInput
                                type="checkbox"
                                checked={!hidden.includes(key)}
                                onChange={() =>
                                    setHidden(value =>
                                        value.includes(key)
                                            ? value.filter(item => item !== key)
                                            : [...value, key],
                                    )
                                }
                            />
                            {label}
                        </label>
                    ))}
                </fieldset>
            )}
            {query.loading && !list && <p role="status">正在加载地址…</p>}
            {list && (
                <div className="overflow-x-auto">
                    <table className="admin-mobile-record-table w-full text-left text-sm">
                        <thead>
                            <tr>
                                <th className="p-3">街道地址</th>
                                {visible.map(([key, label]) => (
                                    <th className="p-3" key={key}>
                                        {label}
                                    </th>
                                ))}
                                <th className="p-3">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.items.map(row => (
                                <tr key={row.id} className="border-b border-slate-200">
                                    <td className="p-3" data-label="街道地址" lang="en">
                                        {row.line1}
                                    </td>
                                    {visible.map(([key, label]) => (
                                        <td className="p-3" data-label={label} key={key}>
                                            {key === 'createdAt' || key === 'usedAt'
                                                ? row[key]
                                                    ? new Date(row[key]!).toLocaleString()
                                                    : '—'
                                                : row[key]}
                                        </td>
                                    ))}
                                    <td className="p-3" data-label="操作">
                                        <AdminButton
                                            className={secondaryButton}
                                            disabled={busy}
                                            onClick={() => void copy(row)}
                                        >
                                            {row.status === 'unused' ? '提取并复制' : '复制地址'}
                                        </AdminButton>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!list.items.length && (
                        <p className="p-5 text-slate-500">
                            {keyword
                                ? '没有匹配的地址。'
                                : status === 'unused'
                                  ? '暂无未使用地址；下次客户端提取时会自动补货，也可手动生成。'
                                  : '暂无已使用地址。'}
                        </p>
                    )}
                </div>
            )}
            <footer className="flex flex-wrap items-center justify-between gap-3">
                <PageSizeSelect
                    pageSize={take}
                    onPageSizeChange={value => updateParams({ take: String(value), page: '1' })}
                />
                <div className="flex items-center gap-3">
                    <span>
                        共 {list?.totalItems ?? '—'} 条 · 第 {page} 页
                    </span>
                    <AdminButton
                        className={secondaryButton}
                        disabled={page <= 1 || query.loading}
                        onClick={() => updateParams({ page: String(page - 1) })}
                    >
                        上一页
                    </AdminButton>
                    <AdminButton
                        className={secondaryButton}
                        disabled={!list || page * take >= list.totalItems || query.loading}
                        onClick={() => updateParams({ page: String(page + 1) })}
                    >
                        下一页
                    </AdminButton>
                </div>
            </footer>
            {dialog && (
                <AdminOverlayPortal>
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
                        <AccessibleDialogSurface
                            accessibleName={dialog.kind === 'generate' ? '生成地址' : '清理已使用地址'}
                            onRequestClose={() => {
                                if (!busy) setDialog(null);
                            }}
                            className="w-full max-w-md space-y-4 rounded-xl bg-white p-6"
                        >
                            <h2 className="text-lg font-semibold">
                                {dialog.kind === 'generate' ? '生成地址' : '清理已使用地址'}
                            </h2>
                            <form
                                className="space-y-4"
                                onSubmit={event => {
                                    event.preventDefault();
                                    void submit();
                                }}
                            >
                                {dialog.kind === 'generate' ? (
                                    <AdminField
                                        label="生成数量"
                                        description="每次生成 1～100 条；必要时清理最早已使用地址，保留未使用地址。"
                                    >
                                        <AdminInput
                                            aria-label="生成数量"
                                            type="number"
                                            min={1}
                                            max={100}
                                            step={1}
                                            required
                                            autoFocus
                                            value={count}
                                            disabled={busy}
                                            onChange={event => setCount(event.target.value)}
                                        />
                                    </AdminField>
                                ) : (
                                    <p>
                                        将清理全部分页的 {dialog.count}{' '}
                                        条已使用地址明细，无法恢复。永久指纹、领取回执和用户本机记录不受影响。
                                    </p>
                                )}
                                {notice && feedback.failed && <p role="alert">{notice}</p>}
                                <div className="flex justify-end gap-2">
                                    <AdminButton
                                        className={secondaryButton}
                                        disabled={busy}
                                        onClick={() => setDialog(null)}
                                    >
                                        取消
                                    </AdminButton>
                                    <AdminButton
                                        type="submit"
                                        disabled={busy}
                                        aria-busy={busy}
                                        className={primaryButton}
                                    >
                                        {busy
                                            ? '处理中…'
                                            : dialog.kind === 'generate'
                                              ? '生成地址'
                                              : '确认清理'}
                                    </AdminButton>
                                </div>
                            </form>
                        </AccessibleDialogSurface>
                    </div>
                </AdminOverlayPortal>
            )}
        </section>
    );
}
