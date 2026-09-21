import { useMutation } from '@apollo/client/react';
import { useState } from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    UPDATE_MY_STORE_COMMERCE_CONFIGURATION_MUTATION,
    type MyStoreSettingsResult,
} from '../../graphql/management.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import { FieldArea, FieldInput } from './MyStoreFields';
import { primaryButton } from './settings-ui';
export function MyStoreCommerceEditor({
    commerce,
    onCompleted,
    onError,
}: {
    commerce: MyStoreSettingsResult['myStoreCommerceConfiguration'];
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [updateCommerce, updateState] = useMutation(UPDATE_MY_STORE_COMMERCE_CONFIGURATION_MUTATION);
    const [draft, setDraft] = useState({ ...commerce, countryCode: commerce.countryCode ?? '' });
    const update = <K extends keyof typeof draft>(field: K, value: (typeof draft)[K]) =>
        setDraft(current => ({ ...current, [field]: value }));
    const save = async () => {
        if (!draft.countryCode.trim()) return onError('请填写经营国家或地区代码');
        if (draft.estimateMinDays < 0 || draft.estimateMaxDays < draft.estimateMinDays) {
            return onError('预计送达天数范围不正确');
        }
        try {
            await updateCommerce({
                variables: {
                    input: {
                        expectedUpdatedAt: commerce.updatedAt,
                        pricesIncludeTax: draft.pricesIncludeTax,
                        countryCode: draft.countryCode.trim().toUpperCase(),
                        taxRate: draft.taxRate,
                        shippingMethodNameZh: draft.shippingMethodNameZh.trim(),
                        shippingMethodNameEn: draft.shippingMethodNameEn.trim(),
                        shippingDescriptionZh: draft.shippingDescriptionZh.trim(),
                        shippingDescriptionEn: draft.shippingDescriptionEn.trim(),
                        baseRate: draft.baseRate,
                        freeShippingThreshold: draft.freeShippingThreshold,
                        shippingTaxRate: draft.shippingTaxRate,
                        shippingPriceIncludesTax: draft.shippingPriceIncludesTax,
                        estimateMinDays: draft.estimateMinDays,
                        estimateMaxDays: draft.estimateMaxDays,
                        blockedPostalPrefixes: draft.blockedPostalPrefixes.trim(),
                    },
                },
            });
            await onCompleted('本店税务与配送设置已保存');
        } catch (error) {
            onError(toUserFacingError(error, '保存本店税务与配送设置失败'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    本店税务与配送
                    <FeatureHelpButton topic="settings.payment-shipping" title="本店税务与配送" />
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                    只修改当前店铺的经营规则；承运商凭据仍由平台维护。
                </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <FieldInput
                    label="国家/地区代码"
                    value={draft.countryCode}
                    onChange={value => update('countryCode', value)}
                />
                <NumberField
                    label="商品税率（%）"
                    value={draft.taxRate}
                    onChange={value => update('taxRate', value)}
                />
                <NumberField
                    label={`基础运费（${draft.currencyCode} 最小单位）`}
                    value={draft.baseRate}
                    onChange={value => update('baseRate', value)}
                />
                <NumberField
                    label={`免运费门槛（${draft.currencyCode} 最小单位）`}
                    value={draft.freeShippingThreshold}
                    onChange={value => update('freeShippingThreshold', value)}
                />
                <FieldInput
                    label="配送名称"
                    value={draft.shippingMethodNameZh}
                    onChange={value => update('shippingMethodNameZh', value)}
                />
                <FieldInput
                    label="英文配送名称"
                    value={draft.shippingMethodNameEn}
                    onChange={value => update('shippingMethodNameEn', value)}
                />
                <NumberField
                    label="配送税率（%）"
                    value={draft.shippingTaxRate}
                    onChange={value => update('shippingTaxRate', value)}
                />
                <FieldInput
                    label="禁运邮编前缀"
                    value={draft.blockedPostalPrefixes}
                    onChange={value => update('blockedPostalPrefixes', value)}
                />
                <NumberField
                    label="最少送达天数"
                    value={draft.estimateMinDays}
                    onChange={value => update('estimateMinDays', Math.round(value))}
                />
                <NumberField
                    label="最多送达天数"
                    value={draft.estimateMaxDays}
                    onChange={value => update('estimateMaxDays', Math.round(value))}
                />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                        type="checkbox"
                        checked={draft.pricesIncludeTax}
                        onChange={event => update('pricesIncludeTax', event.target.checked)}
                    />{' '}
                    商品价格含税
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                        type="checkbox"
                        checked={draft.shippingPriceIncludesTax}
                        onChange={event => update('shippingPriceIncludesTax', event.target.checked)}
                    />{' '}
                    运费含税
                </label>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
                <FieldArea
                    label="配送说明"
                    value={draft.shippingDescriptionZh}
                    onChange={value => update('shippingDescriptionZh', value)}
                />
                <FieldArea
                    label="英文配送说明"
                    value={draft.shippingDescriptionEn}
                    onChange={value => update('shippingDescriptionEn', value)}
                />
            </div>
            <div className="mt-4 flex justify-end">
                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={updateState.loading}
                    className={primaryButton}
                >
                    保存税务与配送
                </button>
            </div>
        </section>
    );
}

function NumberField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <FieldInput
            label={label}
            type="number"
            value={String(value)}
            onChange={value => onChange(Number.isFinite(Number(value)) ? Number(value) : 0)}
        />
    );
}
