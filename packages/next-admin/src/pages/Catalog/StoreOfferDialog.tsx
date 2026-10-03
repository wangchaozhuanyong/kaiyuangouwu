import { gql } from '@apollo/client';
import { useMutation, useQuery } from '@apollo/client/react';
import { useState } from 'react';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { toUserFacingError } from '../../utils/user-facing-error';

const OFFER = gql`
    query MyOffer($productId: ID!) {
        myProductSalesOffer(productId: $productId)
    }
`;
const SAVE = gql`
    mutation SaveMyOffer($input: MyProductSalesOfferInput!) {
        updateMyProductSalesOffer(input: $input)
    }
`;
interface Offer {
    productId: string;
    ownerChannelId: string;
    state: string;
    version: number;
    variants: Array<{ id: string; name: string; price: number | null; currencyCode: string }>;
}

export function StoreOfferDialog({
    productId,
    onClose,
    onSaved,
}: {
    productId: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const query = useQuery<{ myProductSalesOffer: Offer }>(OFFER, {
        variables: { productId },
        fetchPolicy: 'network-only',
    });
    const [save, status] = useMutation(SAVE);
    const [prices, setPrices] = useState<Record<string, string>>({});
    const [state, setState] = useState<string | null>(null);
    const [error, setError] = useState('');
    const offer = query.data?.myProductSalesOffer;
    const submit = async () => {
        if (!offer) return;
        try {
            const updatedPrices = Object.entries(prices).map(([variantId, value]) => ({
                variantId,
                price: Number(value),
            }));
            if (
                updatedPrices.some(
                    p => !prices[p.variantId].trim() || !Number.isSafeInteger(p.price) || p.price < 0,
                )
            )
                throw new Error('售价须填写非负整数的最小货币单位');
            await save({
                variables: {
                    input: {
                        productId,
                        version: offer.version,
                        state: state ?? (offer.state === 'ACTIVE' ? 'ACTIVE' : 'PAUSED'),
                        prices: updatedPrices,
                    },
                },
            });
            onSaved();
            onClose();
        } catch (e) {
            setError(toUserFacingError(e, '保存失败，请检查售价与授权'));
        }
    };
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <AccessibleDialogSurface
                accessibleName="本店商品经营设置"
                onRequestClose={onClose}
                className="max-h-[85vh] w-full max-w-xl overflow-auto rounded-xl bg-white p-6 shadow-xl"
            >
                <div className="flex justify-between gap-4">
                    <h2 className="flex items-center gap-2 text-lg font-bold">
                        本店商品经营设置
                        <FeatureHelpButton topic="catalog.store-offer" title="本店商品经营设置" />
                    </h2>
                    <button onClick={onClose} aria-label="关闭经营设置">
                        关闭
                    </button>
                </div>
                <p className="my-3 text-sm text-slate-500">
                    修改本店售价与销售状态。维护店铺管理商品资料、规格及来源交付资源。
                </p>
                {query.loading && <p role="status">读取本店授权中…</p>}
                {(query.error || error) && (
                    <p role="alert" className="text-red-600 dark:text-red-400 text-sm">
                        {error || toUserFacingError(query.error, '授权读取失败，请重试')}
                    </p>
                )}
                {offer && (
                    <div className="space-y-4">
                        <p className="text-sm">
                            授权状态：
                            {offer.state === 'ACTIVE'
                                ? '启用'
                                : offer.state === 'PENDING'
                                  ? '待配置'
                                  : offer.state === 'PAUSED'
                                    ? '暂停'
                                    : '已撤销'}
                        </p>
                        <label className="block text-sm">
                            本店销售状态
                            <select
                                className="ml-3 rounded-lg border border-slate-200 p-2"
                                disabled={offer.state === 'REVOKED'}
                                value={state ?? (offer.state === 'ACTIVE' ? 'ACTIVE' : 'PAUSED')}
                                onChange={e => setState(e.target.value)}
                            >
                                <option value="ACTIVE">启用销售</option>
                                <option value="PAUSED">暂停销售</option>
                            </select>
                        </label>
                        {offer.variants.map(v => (
                            <label key={v.id} className="flex items-center justify-between gap-4 text-sm">
                                {v.name} · {v.currencyCode}
                                <input
                                    aria-label={`${v.name}本店售价`}
                                    type="number"
                                    step="1"
                                    min="0"
                                    disabled={offer.state === 'REVOKED'}
                                    value={prices[v.id] ?? (v.price == null ? '' : String(v.price))}
                                    onChange={e => setPrices({ ...prices, [v.id]: e.target.value })}
                                    className="w-40 rounded-lg border border-slate-200 p-2"
                                />
                            </label>
                        ))}
                        <p className="text-xs text-slate-500">
                            售价按最小货币单位填写，例如 CNY 100 表示
                            ¥1.00。库存为零显示缺货，卡密还需平台供货授权。
                        </p>
                        <button
                            disabled={status.loading || offer.state === 'REVOKED'}
                            onClick={() => void submit()}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                        >
                            {status.loading ? '保存并回读…' : '保存本店设置'}
                        </button>
                    </div>
                )}
            </AccessibleDialogSurface>
        </div>
    );
}
