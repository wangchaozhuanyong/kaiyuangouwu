import { gql } from '@apollo/client';
import { useMutation, useQuery } from '@apollo/client/react';
import { useState } from 'react';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { toUserFacingError } from '../../utils/user-facing-error';

const CONFIGS = gql`
    query PlatformSupply($productId: ID!) {
        platformAutoCardSupplyCatalog(productId: $productId)
    }
`;
const SAVE = gql`
    mutation PlatformSupplySave($input: PlatformAutoCardSupplyInput!) {
        setPlatformAutoCardSupply(input: $input)
    }
`;
interface Supply {
    configurations: Array<{ configId: string; productVariantId: string; name: string; enabled: boolean }>;
    grants: Array<{ channelId: string; productVariantId: string; enabled: boolean; version: number }>;
}

export function PlatformSupplyDialog({
    productId,
    sourceChannelId,
    stores,
    onClose,
}: {
    productId: string;
    sourceChannelId: string;
    stores: Array<{ id: string; displayName: string }>;
    onClose: () => void;
}) {
    const query = useQuery<{ platformAutoCardSupplyCatalog: Supply }>(CONFIGS, {
        variables: { productId },
        fetchPolicy: 'network-only',
    });
    const [save, state] = useMutation(SAVE);
    const [configId, setConfigId] = useState('');
    const [channelId, setChannelId] = useState('');
    const [enabled, setEnabled] = useState(true);
    const [message, setMessage] = useState('');
    const config = query.data?.platformAutoCardSupplyCatalog.configurations.find(
        c => c.configId === configId,
    );
    const grant = query.data?.platformAutoCardSupplyCatalog.grants.find(
        g => g.channelId === channelId && g.productVariantId === config?.productVariantId,
    );
    const submit = async () => {
        if (!config || !channelId) return;
        try {
            await save({
                variables: {
                    input: {
                        configId,
                        channelId,
                        productVariantId: config.productVariantId,
                        enabled,
                        version: grant?.version ?? 0,
                    },
                },
            });
            await query.refetch();
            setMessage('供货授权已回读。目标店铺完成售价和经营配置后可销售。');
        } catch (error) {
            setMessage(toUserFacingError(error, '供货授权保存失败，请先确认销售授权'));
        }
    };
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <AccessibleDialogSurface
                accessibleName="平台卡密供货授权"
                onRequestClose={onClose}
                className="w-full max-w-xl space-y-4 rounded-xl bg-white p-6 shadow-xl"
            >
                <div className="flex justify-between">
                    <h2 className="font-bold text-lg">卡密供货授权</h2>
                    <button onClick={onClose}>关闭</button>
                </div>
                <p className="text-sm text-slate-500">
                    维护店铺提供原始卡池，目标店铺定价并履约。此处不展示卡密内容；撤销后已进入付款的订单按快照继续处理。
                </p>
                {query.loading && <p role="status">读取供货配置中…</p>}
                {query.error && <p role="alert">{toUserFacingError(query.error, '供货配置读取失败')}</p>}
                {!query.loading &&
                    !query.error &&
                    !query.data?.platformAutoCardSupplyCatalog.configurations.length && (
                        <p>维护店铺尚未配置自动发卡，请先在维护店铺完成卡池配置。</p>
                    )}
                <label className="block text-sm">
                    原始发卡配置
                    <select
                        aria-label="原始发卡配置"
                        className="ml-3 rounded-lg border border-slate-200 p-2"
                        value={configId}
                        onChange={e => setConfigId(e.target.value)}
                    >
                        <option value="">选择规格</option>
                        {query.data?.platformAutoCardSupplyCatalog.configurations.map(c => (
                            <option key={c.configId} value={c.configId}>
                                {c.name} · {c.enabled ? '启用' : '来源已停用'}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="block text-sm">
                    目标销售店铺
                    <select
                        aria-label="目标销售店铺"
                        className="ml-3 rounded-lg border border-slate-200 p-2"
                        value={channelId}
                        onChange={e => setChannelId(e.target.value)}
                    >
                        <option value="">选择经营店铺</option>
                        {stores
                            .filter(s => s.id !== sourceChannelId)
                            .map(s => (
                                <option key={s.id} value={s.id}>
                                    {s.displayName}
                                </option>
                            ))}
                    </select>
                </label>
                {grant && (
                    <p className="text-sm">
                        当前授权：{grant.enabled ? '启用' : '暂停'} · 版本 {grant.version}
                    </p>
                )}
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
                    允许来源卡池供货
                </label>
                <button
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                    disabled={state.loading || !config || !channelId}
                    onClick={() => void submit()}
                >
                    保存并回读供货授权
                </button>
                {message && (
                    <p role="status" className="text-sm">
                        {message}
                    </p>
                )}
            </AccessibleDialogSurface>
        </div>
    );
}
