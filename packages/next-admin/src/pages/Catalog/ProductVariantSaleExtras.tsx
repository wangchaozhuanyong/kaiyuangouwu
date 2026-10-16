import { useId } from 'react';
import { AdminInput } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { DynamicCustomFieldsForm } from '../../custom-fields/DynamicCustomFieldsForm';
import { isDashboardVisibleCustomField } from '../../custom-fields/custom-field-utils';
import { useProductEditor } from './ProductEditorContext';
import { ProductSupplySettings } from './ProductSupplySettings';
import { SOURCE_LANGUAGE_CODE } from './product-editor-types';

/** Additional sales fields share the SKU draft and the editor's single save operation. */
export function ProductVariantSaleExtras({ variantIndex }: { variantIndex: number }) {
    const errorId = useId();
    const {
        variants,
        variantExtensionFields = [],
        availableCurrencyCodes = [],
        activeCurrencyCode,
        effectiveFulfillmentType,
        productData,
        handleVariantFieldChange,
        formErrors,
        saving,
    } = useProductEditor();
    const variant = variants[variantIndex];
    if (!variant) return null;

    const currencies = [...new Set(availableCurrencyCodes)].filter(
        currency => currency !== activeCurrencyCode,
    );
    const fields = variantExtensionFields.filter(
        field =>
            isDashboardVisibleCustomField(field) &&
            (effectiveFulfillmentType !== 'digital' ||
                !['barcode', 'purchaseUnit', 'saleUnit'].includes(field.name)),
    );
    const error = formErrors.variants?.[variantIndex]?.details;
    const languages = [
        ...new Set([
            SOURCE_LANGUAGE_CODE,
            ...(productData?.product?.translations?.map(translation => translation.languageCode) ?? []),
        ]),
    ];

    return (
        <div className="product-editor-sale-extras" data-product-variant-sale-extras={variantIndex}>
            {error && (
                <p
                    id={errorId}
                    role="alert"
                    tabIndex={-1}
                    aria-invalid="true"
                    className="text-xs text-rose-600"
                >
                    {error}
                </p>
            )}
            {currencies.length > 0 && (
                <div className="space-y-3">
                    <h3 className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700">
                        其他币种售价（选填）
                        <FeatureHelpButton
                            title="其他币种售价"
                            content={{
                                purpose: '为当前规格填写其他可用币种的售价，随页面顶部的“保存商品”一起提交。',
                                requirements: ['仅显示当前售价币种以外的可用币种', '填写非负金额'],
                                example: '例如：当前使用 CNY 标价时，在这里补充同一规格的 MYR 售价。',
                                impact: '只修改当前规格所填写的币种价格，不会自动换算其他金额。',
                            }}
                        />
                    </h3>
                    <div className="product-editor-extra-currencies">
                        {currencies.map(currency => (
                            <AdminField
                                key={currency}
                                label={currency}
                                layout="auto"
                                className="min-w-0 space-y-1.5 text-xs font-semibold text-slate-700"
                            >
                                <AdminInput
                                    aria-label={`规格 ${variantIndex + 1} ${currency} 售价`}
                                    aria-describedby={error ? errorId : undefined}
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={variant.currencyPrices?.[currency] ?? ''}
                                    disabled={saving}
                                    onChange={event =>
                                        handleVariantFieldChange(variantIndex, 'currencyPrices', {
                                            ...variant.currencyPrices,
                                            [currency]: event.target.value,
                                        })
                                    }
                                    className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                                />
                            </AdminField>
                        ))}
                    </div>
                </div>
            )}
            {fields.length > 0 && (
                <div className="space-y-3">
                    <h3 className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700">
                        规格补充资料
                        <FeatureHelpButton
                            title="规格补充资料"
                            content={{
                                purpose: '维护当前规格可用的扩展字段，随页面顶部的“保存商品”一起提交。',
                                requirements: [
                                    '按字段类型填写资料',
                                    '数字商品只显示与数字交付相关的可用字段',
                                ],
                                example: '例如：在该规格的补充资料中填写规格说明，再统一保存商品。',
                                impact: '仅更新当前规格的补充资料，不会覆盖其他规格。',
                            }}
                        />
                    </h3>
                    <DynamicCustomFieldsForm
                        compact
                        embedded
                        title=""
                        fields={fields}
                        values={variant.variantCustomFields ?? {}}
                        onChange={values =>
                            handleVariantFieldChange(variantIndex, 'variantCustomFields', values)
                        }
                        languageCode={SOURCE_LANGUAGE_CODE}
                        languageCodes={languages}
                        disabled={saving}
                    />
                </div>
            )}
            <ProductSupplySettings variantIndex={variantIndex} inline />
        </div>
    );
}
