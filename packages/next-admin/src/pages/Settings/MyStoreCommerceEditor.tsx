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
import { FieldInput } from './MyStoreFields';
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
        try {
            const saved = await updateCommerce({
                variables: {
                    input: {
                        expectedUpdatedAt: commerce.updatedAt,
                        pricesIncludeTax: taxes ? draft.pricesIncludeTax : commerce.pricesIncludeTax,
                        countryCode: regions ? draft.countryCode.trim().toUpperCase() : commerce.countryCode,
                        taxRate: taxes ? draft.taxRate : commerce.taxRate,
                    },
                },
            });
            draftOwner.accept(
                draft,
                saved.data?.updateMyStoreCommerceConfiguration.updatedAt ?? commerce.updatedAt,
            );
            await onCompleted(`${standalonePage?.title ?? '本店税务与经营地区设置'}已保存`);
        } catch (error) {
            onError(toUserFacingError(error, '保存本店税务与经营地区设置失败'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            {draftOwner.sourceChanged && <DraftUpdateNotice onReload={draftOwner.reload} />}
            <div className="mb-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    {standalonePage?.title ?? '本店税务与经营地区'}
                    <FeatureHelpButton
                        topic="settings.payment-shipping"
                        title="本店税务与经营地区"
                        description="只修改当前店铺的商品税务与经营地区；配送方式请使用本店配送设置。"
                    />
                </h2>
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
