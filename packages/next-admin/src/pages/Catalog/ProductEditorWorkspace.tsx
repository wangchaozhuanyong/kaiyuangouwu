import { useEffect, useId, useState } from 'react';
import { AdminInput, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { NextAdminPageBlocks } from '../../extensions/extension-hosts';
import type { RefundPolicy } from '../../graphql/commerce.graphql';
import { ProductPackagingBlock } from './CatalogOperationsBlocks';
import { DigitalProductWorkspace } from './DigitalProductWorkspace';
import { PhysicalProductWorkspace } from './PhysicalProductWorkspace';
import { ProductBasicTab } from './ProductBasicTab';
import { useProductEditor } from './ProductEditorContext';
import { ProductEditorSidebar } from './ProductEditorSidebar';
import { ProductFacetsCollectionsTab } from './ProductFacetsCollectionsTab';
import { ProductMoreSettings } from './ProductMoreSettings';
import { ProductSupplySettings } from './ProductSupplySettings';
import { ProductVariantsTab } from './ProductVariantsTab';

export function ProductEditorWorkspace() {
    const id = useId();
    const [currentSection, setCurrentSection] = useState('info');
    const {
        isCreateMode,
        productData,
        activeTab,
        effectiveFulfillmentType,
        refundPolicy,
        setRefundPolicy,
        manualDeliverySlaMinutes,
        setManualDeliverySlaMinutes,
        variants,
        saving,
    } = useProductEditor();
    useEffect(() => {
        if (activeTab !== 'BASIC')
            document
                .getElementById(`${id}-${activeTab === 'VARIANTS' ? 'pricing' : 'more'}`)
                ?.scrollIntoView?.({ block: 'start' });
    }, [activeTab, id]);
    if (!isCreateMode && !productData?.product) return null;
    const sections = [
        ['info', '商品信息'],
        ['pricing', '规格与价格'],
        ['delivery', '交付与售后'],
        ['more', '更多设置'],
    ] as const;
    return (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[9rem_minmax(0,1fr)]">
            <AdminField label="编辑章节" className="md:hidden">
                <AdminSelect
                    aria-label="商品编辑章节"
                    value={currentSection}
                    onChange={event => {
                        const section = event.target.value;
                        setCurrentSection(section);
                        document.getElementById(`${id}-${section}`)?.scrollIntoView?.({ block: 'start' });
                    }}
                >
                    {sections.map(([key, name]) => (
                        <option key={key} value={key}>
                            {name}
                        </option>
                    ))}
                </AdminSelect>
            </AdminField>
            <nav
                aria-label="商品编辑分区"
                className="sticky top-0 z-10 hidden gap-3 md:flex overflow-x-auto bg-white py-3 text-xs font-semibold text-slate-600 xl:top-4 xl:items-start xl:self-start xl:flex-col"
            >
                {sections.map(([key, name]) => (
                    <a
                        key={key}
                        onClick={() => setCurrentSection(key)}
                        href={`#${id}-${key}`}
                        className="shrink-0 px-2 py-1 hover:text-blue-700"
                    >
                        {name}
                    </a>
                ))}
            </nav>
            <div className="min-w-0 space-y-5">
                <section
                    id={`${id}-info`}
                    className="scroll-mt-16 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
                >
                    <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
                        商品信息
                        <FeatureHelpButton topic="catalog.product-editor" title="商品信息" />
                    </h2>
                    <div className="grid items-start gap-4 lg:grid-cols-[minmax(14rem,0.7fr)_minmax(0,1.6fr)]">
                        <ProductEditorSidebar />
                        <ProductBasicTab />
                    </div>
                    <div className="mt-4">
                        <ProductFacetsCollectionsTab section="category" />
                    </div>
                </section>
                <section
                    id={`${id}-pricing`}
                    className="scroll-mt-16 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
                >
                    <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
                        规格与价格
                        <FeatureHelpButton topic="catalog.product-editor" title="规格与价格" />
                    </h2>
                    <ProductVariantsTab />
                </section>
                <section
                    id={`${id}-delivery`}
                    className="scroll-mt-16 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
                >
                    <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
                        交付与售后
                        <FeatureHelpButton topic="catalog.product-editor" title="交付与售后" />
                    </h2>
                    {effectiveFulfillmentType === 'digital' ? (
                        <DigitalProductWorkspace />
                    ) : (
                        <p className="text-xs text-slate-600">
                            实物商品按仓库库存销售，付款后在订单中出库发货。
                        </p>
                    )}
                    <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 md:grid-cols-2">
                        <AdminField
                            className="space-y-1.5 text-xs font-semibold text-slate-700"
                            label={
                                <>
                                    <span className="flex min-h-6 items-center gap-2">
                                        退款规则
                                        <FeatureHelpButton topic="catalog.product-editor" title="退款规则" />
                                    </span>
                                </>
                            }
                        >
                            {' '}
                            <AdminSelect
                                aria-label="退款规则"
                                value={refundPolicy}
                                disabled={saving}
                                onChange={event => setRefundPolicy(event.target.value as RefundPolicy)}
                                className="w-full rounded-lg border border-slate-300 bg-white p-2.5"
                            >
                                <option value="MERCHANT_REVIEW">可申请退款（商家审核）</option>
                                <option value="NON_REFUNDABLE">不支持退款申请</option>
                                {effectiveFulfillmentType === 'physical' && (
                                    <option value="SEVEN_DAY_NO_REASON">七天无理由退货</option>
                                )}
                            </AdminSelect>
                        </AdminField>
                        {effectiveFulfillmentType === 'digital' &&
                            variants.some(variant => variant.digitalDeliveryMode === 'manual_service') && (
                                <AdminField
                                    className="space-y-1.5 text-xs font-semibold text-slate-700"
                                    label={
                                        <>
                                            <span className="flex min-h-6 items-center">
                                                预计人工处理时长（分钟）
                                            </span>
                                        </>
                                    }
                                >
                                    {' '}
                                    <AdminInput
                                        aria-label="预计人工处理时长"
                                        type="number"
                                        min="5"
                                        max="525600"
                                        step="5"
                                        value={manualDeliverySlaMinutes}
                                        disabled={saving}
                                        onChange={event =>
                                            setManualDeliverySlaMinutes(Number(event.target.value))
                                        }
                                        className="w-full rounded-lg border border-slate-300 bg-white p-2.5"
                                    />
                                </AdminField>
                            )}
                    </div>
                </section>
                <section
                    id={`${id}-more`}
                    className="scroll-mt-16 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
                >
                    <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
                        更多设置
                        <FeatureHelpButton topic="catalog.product-editor" title="更多设置" />
                    </h2>
                    <ProductMoreSettings />
                    <ProductSupplySettings />
                    {effectiveFulfillmentType === 'physical' && (
                        <div className="mt-4">
                            <PhysicalProductWorkspace />
                        </div>
                    )}
                    {effectiveFulfillmentType === 'physical' && productData?.product && (
                        <details className="mt-4">
                            <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                                自动拆包
                            </summary>
                            <ProductPackagingBlock
                                context={{
                                    pageId: 'product-detail',
                                    entity: productData.product as unknown as Record<string, unknown>,
                                }}
                            />
                        </details>
                    )}
                    <NextAdminPageBlocks
                        pageId="product-detail"
                        entity={productData?.product as unknown as Record<string, unknown>}
                        excludeIds={['catalog-product-operations', 'product-packaging']}
                    />
                    <div className="mt-4">
                        <ProductFacetsCollectionsTab section="facets" />
                    </div>
                </section>
            </div>
        </div>
    );
}
