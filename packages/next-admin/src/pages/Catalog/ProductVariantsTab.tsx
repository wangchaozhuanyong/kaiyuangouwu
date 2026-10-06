import { useMutation } from '@apollo/client/react';
import { useState } from 'react';
import { AdminButton, AdminInput } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { CREATE_OPTION_GROUP } from '../../graphql/catalog-admin.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import { useProductEditor } from './ProductEditorContext';
import { splitOptionValues, toOptionGroupCode } from './catalog-option-groups';
import { SOURCE_LANGUAGE_CODE, type OptionGroupItem } from './product-editor-types';

const inputClass =
    'w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-blue-500 focus:outline-none';

/** Shared specifications and pricing only. Stock and delivery belong to their domain workspaces. */
export function ProductVariantsTab() {
    const {
        variants,
        setVariants,
        knownOptionGroups,
        selectedOptionGroupIds,
        handleApplyOptionGroup,
        handleVariantFieldChange,
        handleDeleteVariant,
        activeCurrencyCode,
        formErrors,
        saving,
        optionGroupsData,
    } = useProductEditor();
    const [multi, setMulti] = useState(false);
    const [specName, setSpecName] = useState('');
    const [specValues, setSpecValues] = useState('');
    const [batchPrice, setBatchPrice] = useState('');
    const [error, setError] = useState('');
    const [createGroup, { loading }] = useMutation<{ createProductOptionGroup: OptionGroupItem }>(
        CREATE_OPTION_GROUP,
    );
    const addSpecification = async () => {
        const values = splitOptionValues(specValues);
        if (!specName.trim() || values.length < 2) {
            setError('请填写规格名称和至少两个规格值');
            return;
        }
        if (Math.max(1, variants.length) * values.length > 100) {
            setError('规格组合最多支持 100 个，请减少规格值');
            return;
        }
        setError('');
        try {
            const result = await createGroup({
                variables: {
                    input: {
                        code: toOptionGroupCode('', 'product-spec'),
                        translations: [{ languageCode: SOURCE_LANGUAGE_CODE, name: specName.trim() }],
                        options: values.map((value, index) => ({
                            code: toOptionGroupCode('', 'value', index),
                            translations: [{ languageCode: SOURCE_LANGUAGE_CODE, name: value }],
                        })),
                    },
                },
            });
            if (!result.data?.createProductOptionGroup) throw new Error('未收到规格创建结果');
            handleApplyOptionGroup(result.data.createProductOptionGroup);
            setSpecName('');
            setSpecValues('');
        } catch (failure) {
            setError(toUserFacingError(failure, '规格创建失败，请重试'));
        }
    };
    return (
        <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <AdminInput
                        type="checkbox"
                        checked={multi || variants.length > 1 || selectedOptionGroupIds.length > 0}
                        disabled={saving || variants.length > 1 || selectedOptionGroupIds.length > 0}
                        onChange={event => setMulti(event.target.checked)}
                    />
                    多规格
                    <FeatureHelpButton topic="catalog.variants" title="商品规格" />
                </label>
                <div className="grid w-full max-w-64 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:w-64">
                    <AdminInput
                        aria-label="批量售价"
                        value={batchPrice}
                        onChange={event => setBatchPrice(event.target.value)}
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={`统一售价 (${activeCurrencyCode})`}
                        className={inputClass}
                    />
                    <AdminButton
                        type="button"
                        disabled={saving || batchPrice === '' || Number(batchPrice) < 0}
                        onClick={() =>
                            setVariants(current =>
                                current.map(variant => ({ ...variant, price: batchPrice })),
                            )
                        }
                        className="shrink-0 whitespace-nowrap text-xs font-semibold text-blue-700 disabled:opacity-50"
                    >
                        应用全部
                    </AdminButton>
                </div>
            </div>
            {(multi || variants.length > 1 || selectedOptionGroupIds.length > 0) && (
                <div className="space-y-3">
                    {selectedOptionGroupIds
                        .map(id => knownOptionGroups[id])
                        .filter(Boolean)
                        .map(group => (
                            <p key={group.id} className="text-xs text-slate-600">
                                <strong>{group.name}：</strong>
                                {group.options.map(option => option.name).join('、')}
                            </p>
                        ))}
                    <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                        <AdminField
                            className="space-y-1.5 text-xs font-semibold text-slate-700"
                            label={<>规格名称</>}
                        >
                            {' '}
                            <AdminInput
                                aria-label="规格名称"
                                value={specName}
                                onChange={event => setSpecName(event.target.value)}
                                placeholder="如：版本"
                                className={inputClass}
                            />
                        </AdminField>
                        <AdminField
                            className="space-y-1.5 text-xs font-semibold text-slate-700"
                            label={<>规格值</>}
                        >
                            {' '}
                            <AdminInput
                                aria-label="规格值"
                                value={specValues}
                                onChange={event => setSpecValues(event.target.value)}
                                placeholder="如：标准版，专业版"
                                className={inputClass}
                            />
                        </AdminField>
                        <AdminButton
                            type="button"
                            onClick={() => void addSpecification()}
                            disabled={loading || saving}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                            {loading ? '生成中…' : '生成规格'}
                        </AdminButton>
                    </div>
                    <details>
                        <summary className="cursor-pointer text-xs text-slate-500">
                            使用已有规格模板（可选）
                        </summary>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {optionGroupsData?.productOptionGroups.items
                                .filter(group => !selectedOptionGroupIds.includes(group.id))
                                .map(group => (
                                    <AdminButton
                                        type="button"
                                        key={group.id}
                                        disabled={
                                            saving ||
                                            Math.max(1, variants.length) * group.options.length > 100
                                        }
                                        onClick={() => handleApplyOptionGroup(group)}
                                        className="rounded border px-3 py-1.5 text-xs disabled:opacity-50"
                                    >
                                        {group.name}
                                    </AdminButton>
                                ))}
                        </div>
                    </details>
                </div>
            )}
            {error && (
                <p role="alert" className="text-xs text-rose-600">
                    {error}
                </p>
            )}
            <div className="space-y-3">
                {variants.map((variant, index) => (
                    <div
                        key={variant.id ?? index}
                        className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] items-start gap-3 border-t border-slate-100 pt-3"
                    >
                        <AdminField
                            className="space-y-1.5 text-xs font-semibold text-slate-700"
                            label={<>{variants.length === 1 ? '规格名称' : `规格 ${index + 1}`}</>}
                        >
                            {' '}
                            <AdminInput
                                aria-label={`规格 ${index + 1} 名称`}
                                value={variant.name}
                                placeholder="默认规格"
                                disabled={saving}
                                onChange={event =>
                                    handleVariantFieldChange(index, 'name', event.target.value)
                                }
                                className={inputClass}
                            />
                        </AdminField>
                        <AdminField
                            className="space-y-1.5 text-xs font-semibold text-slate-700"
                            label={<>商品编码</>}
                        >
                            {' '}
                            <AdminInput
                                aria-label={`规格 ${index + 1} 编码`}
                                value={variant.sku}
                                disabled={saving}
                                onChange={event => handleVariantFieldChange(index, 'sku', event.target.value)}
                                className={inputClass}
                            />
                            {formErrors.variants?.[index]?.sku && (
                                <span role="alert" className="block text-rose-600">
                                    {formErrors.variants[index].sku}
                                </span>
                            )}
                        </AdminField>
                        <AdminField
                            className="space-y-1.5 text-xs font-semibold text-slate-700"
                            label={
                                <>
                                    售价 ({activeCurrencyCode}) <span className="text-rose-500">*</span>
                                </>
                            }
                        >
                            {' '}
                            <AdminInput
                                aria-label={`规格 ${index + 1} 售价`}
                                type="number"
                                min="0"
                                step="0.01"
                                value={variant.price}
                                disabled={saving}
                                onChange={event =>
                                    handleVariantFieldChange(index, 'price', event.target.value)
                                }
                                className={inputClass}
                            />
                            {formErrors.variants?.[index]?.price && (
                                <span role="alert" className="block text-rose-600">
                                    {formErrors.variants[index].price}
                                </span>
                            )}
                        </AdminField>
                        <div className="min-w-0 space-y-2">
                            <AdminField
                                className="block space-y-1.5 text-xs font-semibold text-slate-700"
                                label={<>成本 ({activeCurrencyCode})</>}
                            >
                                {' '}
                                <AdminInput
                                    aria-label={`规格 ${index + 1} 成本`}
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    value={variant.costPrice ?? ''}
                                    disabled={saving}
                                    onChange={event =>
                                        handleVariantFieldChange(index, 'costPrice', event.target.value)
                                    }
                                    className={inputClass}
                                />
                            </AdminField>
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <label className="flex items-center gap-1.5">
                                    <AdminInput
                                        type="checkbox"
                                        checked={variant.enabled}
                                        disabled={saving}
                                        onChange={event =>
                                            handleVariantFieldChange(index, 'enabled', event.target.checked)
                                        }
                                    />
                                    可销售
                                </label>
                                {!variant.id && variants.length > 1 && (
                                    <AdminButton
                                        type="button"
                                        onClick={() => void handleDeleteVariant(index)}
                                        className="text-rose-600"
                                    >
                                        移除此新规格
                                    </AdminButton>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
