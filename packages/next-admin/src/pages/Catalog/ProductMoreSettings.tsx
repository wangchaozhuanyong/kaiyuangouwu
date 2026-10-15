import { FeatureHelpButton } from '../../components/FeatureHelp';
import { DynamicCustomFieldsForm } from '../../custom-fields/DynamicCustomFieldsForm';
import { getChannelDisplayName } from '../../utils/channel-display';
import { formatDateTime } from '../Sales/sales-utils';
import { useProductEditor } from './ProductEditorContext';
import { SOURCE_LANGUAGE_CODE } from './product-editor-types';

export function ProductMoreSettings() {
    const {
        isCreateMode,
        productData,
        productExtensionFields,
        dynamicCustomFieldValues,
        setDynamicCustomFieldValues,
        catalogChannelsData,
        saving,
    } = useProductEditor();
    return (
        <div className="space-y-4">
            <DynamicCustomFieldsForm
                compact
                embedded
                fields={productExtensionFields}
                values={dynamicCustomFieldValues}
                onChange={setDynamicCustomFieldValues}
                disabled={saving}
                title=""
                languageCodes={[
                    ...new Set([
                        SOURCE_LANGUAGE_CODE,
                        ...(productData?.product?.translations?.map(t => t.languageCode) ?? []),
                    ]),
                ]}
            />
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3 border-t border-slate-100 pt-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span className="flex min-h-6 items-center gap-2 font-semibold">
                        系统创建时间{' '}
                        <FeatureHelpButton topic="catalog.product-dates" title="系统创建时间与来源日期" />
                    </span>
                    {isCreateMode ? (
                        '首次保存后自动记录'
                    ) : productData?.product?.createdAt ? (
                        <time dateTime={productData.product.createdAt}>
                            {formatDateTime(productData.product.createdAt)}
                        </time>
                    ) : (
                        '尚未读取'
                    )}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span className="flex min-h-6 items-center gap-2 font-semibold">
                        销售店铺{' '}
                        <FeatureHelpButton
                            topic="catalog.variant-channels"
                            title="店铺独立商品"
                            description="如果其他店铺也要销售同款商品，请切换到目标店铺后重新创建或导入独立副本。"
                        />
                    </span>
                    <p className="min-w-0 break-words">
                        本商品仅属于{' '}
                        <strong>
                            {catalogChannelsData
                                ? getChannelDisplayName(catalogChannelsData.activeChannel)
                                : '当前店铺'}
                        </strong>
                    </p>
                    <span className="text-emerald-700">单店独立</span>
                </div>
            </div>
        </div>
    );
}
