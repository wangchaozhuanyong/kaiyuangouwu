import { useMutation } from '@apollo/client/react';
import { AdminButton, AdminInput } from '../../components/AdminControls';
import { DraftUpdateNotice } from '../../components/DraftUpdateNotice';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    UPDATE_MY_STORE_COMMERCE_CONFIGURATION_MUTATION,
    type MyStoreSettingsResult,
} from '../../graphql/management.graphql';
import { useServerDraft } from '../../hooks/use-server-draft';
import { useStandaloneAdminPage } from '../../hooks/use-standalone-admin-page';
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
    const [updateCommerce, updateState] = useMutation<{
        updateMyStoreCommerceConfiguration: { updatedAt: string };
    }>(UPDATE_MY_STORE_COMMERCE_CONFIGURATION_MUTATION);
    const standalonePage = useStandaloneAdminPage();
    const view = standalonePage?.key;
    const shipping = !view || view === 'shipping';
    const taxes = !view || view === 'business-taxes';
    const regions = !view || view === 'business-regions';
    const draftOwner = useServerDraft('store-commerce', commerce.updatedAt, {
        ...commerce,
        countryCode: commerce.countryCode ?? '',
    });
    const draft = draftOwner.draft ?? { ...commerce, countryCode: commerce.countryCode ?? '' };
    const setDraft = draftOwner.setDraft;
    const update = <K extends keyof typeof draft>(field: K, value: (typeof draft)[K]) =>
        setDraft(current => ({ ...(current ?? draft), [field]: value }));
    const save = async () => {
        if (draftOwner.sourceChanged) return;
        if (!(regions ? draft.countryCode : commerce.countryCode)?.trim())
            return onError('请填写经营国家或地区代码');
        if (shipping && (draft.estimateMinDays < 0 || draft.estimateMaxDays < draft.estimateMinDays)) {
            return onError('预计送达天数范围不正确');
        }
        try {
            const saved = await updateCommerce({
                variables: {
                    input: {
                        expectedUpdatedAt: commerce.updatedAt,
                        pricesIncludeTax: taxes ? draft.pricesIncludeTax : commerce.pricesIncludeTax,
                        countryCode: regions ? draft.countryCode.trim().toUpperCase() : commerce.countryCode,
                        taxRate: taxes ? draft.taxRate : commerce.taxRate,
                        shippingMethodNameZh: shipping
                            ? draft.shippingMethodNameZh.trim()
                            : commerce.shippingMethodNameZh,
                        shippingMethodNameEn: shipping
                            ? draft.shippingMethodNameEn.trim()
                            : commerce.shippingMethodNameEn,
                        shippingDescriptionZh: shipping
                            ? draft.shippingDescriptionZh.trim()
                            : commerce.shippingDescriptionZh,
                        shippingDescriptionEn: shipping
                            ? draft.shippingDescriptionEn.trim()
                            : commerce.shippingDescriptionEn,
                        baseRate: shipping ? draft.baseRate : commerce.baseRate,
                        freeShippingThreshold: shipping
                            ? draft.freeShippingThreshold
                            : commerce.freeShippingThreshold,
                        shippingTaxRate: shipping ? draft.shippingTaxRate : commerce.shippingTaxRate,
                        shippingPriceIncludesTax: shipping
                            ? draft.shippingPriceIncludesTax
                            : commerce.shippingPriceIncludesTax,
                        estimateMinDays: shipping ? draft.estimateMinDays : commerce.estimateMinDays,
                        estimateMaxDays: shipping ? draft.estimateMaxDays : commerce.estimateMaxDays,
                        blockedPostalPrefixes: shipping
                            ? draft.blockedPostalPrefixes.trim()
                            : commerce.blockedPostalPrefixes,
                    },
                },
            });
            draftOwner.accept(
                draft,
                saved.data?.updateMyStoreCommerceConfiguration.updatedAt ?? commerce.updatedAt,
            );
            await onCompleted(`${standalonePage?.title ?? '本店税务与配送设置'}已保存`);
        } catch (error) {
            onError(toUserFacingError(error, '保存本店税务与配送设置失败'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            {draftOwner.sourceChanged && <DraftUpdateNotice onReload={draftOwner.reload} />}
            <div className="admin-section-title-line mb-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    {standalonePage?.title ?? '本店税务与配送'}
                    <FeatureHelpButton
                        topic="settings.payment-shipping"
                        title="本店税务与配送"
                        description={'只修改当前店铺的经营规则；承运商凭据仍由平台维护。'}
                    />
                </h2>
                <p className="text-xs text-slate-500">
                    {shipping
                        ? '运费、配送规则与预计送达'
                        : taxes
                          ? '商品税率与含税口径'
                          : '本店经营国家或地区'}
                </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {regions && (
                    <FieldInput
                        label="国家/地区代码"
                        value={draft.countryCode}
                        onChange={value => update('countryCode', value)}
                    />
                )}
                {taxes && (
                    <NumberField
                        label="商品税率（%）"
                        value={draft.taxRate}
                        onChange={value => update('taxRate', value)}
                    />
                )}
                {shipping && (
                    <NumberField
                        label={`基础运费（${draft.currencyCode} 最小单位）`}
                        value={draft.baseRate}
                        onChange={value => update('baseRate', value)}
                    />
                )}
                {shipping && (
                    <NumberField
                        label={`免运费门槛（${draft.currencyCode} 最小单位）`}
                        value={draft.freeShippingThreshold}
                        onChange={value => update('freeShippingThreshold', value)}
                    />
                )}
                {shipping && (
                    <FieldInput
                        label="配送名称"
                        value={draft.shippingMethodNameZh}
                        onChange={value => update('shippingMethodNameZh', value)}
                    />
                )}
                {shipping && (
                    <FieldInput
                        label="英文配送名称"
                        value={draft.shippingMethodNameEn}
                        onChange={value => update('shippingMethodNameEn', value)}
                    />
                )}
                {shipping && (
                    <NumberField
                        label="配送税率（%）"
                        value={draft.shippingTaxRate}
                        onChange={value => update('shippingTaxRate', value)}
                    />
                )}
                {shipping && (
                    <FieldInput
                        label="禁运邮编前缀"
                        value={draft.blockedPostalPrefixes}
                        onChange={value => update('blockedPostalPrefixes', value)}
                    />
                )}
                {shipping && (
                    <NumberField
                        label="最少送达天数"
                        value={draft.estimateMinDays}
                        onChange={value => update('estimateMinDays', Math.round(value))}
                    />
                )}
                {shipping && (
                    <NumberField
                        label="最多送达天数"
                        value={draft.estimateMaxDays}
                        onChange={value => update('estimateMaxDays', Math.round(value))}
                    />
                )}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {taxes && (
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                        <AdminInput
                            type="checkbox"
                            checked={draft.pricesIncludeTax}
                            onChange={event => update('pricesIncludeTax', event.target.checked)}
                        />{' '}
                        商品价格含税
                    </label>
                )}
                {shipping && (
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                        <AdminInput
                            type="checkbox"
                            checked={draft.shippingPriceIncludesTax}
                            onChange={event => update('shippingPriceIncludesTax', event.target.checked)}
                        />{' '}
                        运费含税
                    </label>
                )}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
                {shipping && (
                    <FieldArea
                        label="配送说明"
                        value={draft.shippingDescriptionZh}
                        onChange={value => update('shippingDescriptionZh', value)}
                    />
                )}
                {shipping && (
                    <FieldArea
                        label="英文配送说明"
                        value={draft.shippingDescriptionEn}
                        onChange={value => update('shippingDescriptionEn', value)}
                    />
                )}
            </div>
            <div className="mt-4 flex justify-end">
                <AdminButton
                    type="button"
                    onClick={() => void save()}
                    disabled={updateState.loading || draftOwner.sourceChanged}
                    className={primaryButton}
                >
                    保存设置
                </AdminButton>
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
