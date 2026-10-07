import { useEffect, useId, useRef } from 'react';
import { AdminButton, AdminInput, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { NextAdminPageBlocks } from '../../extensions/extension-hosts';
import type { RefundPolicy } from '../../graphql/commerce.graphql';
import { ProductPackagingBlock } from './CatalogOperationsBlocks';
import { DigitalProductWorkspace } from './DigitalProductWorkspace';
import { PhysicalProductWorkspace } from './PhysicalProductWorkspace';
import { ProductBasicTab } from './ProductBasicTab';
import { ProductCategorySummary } from './ProductCategorySummary';
import { useProductEditor } from './ProductEditorContext';
import { ProductEditorIdentityFields, ProductEditorSidebar } from './ProductEditorSidebar';
import { ProductFacetsCollectionsTab } from './ProductFacetsCollectionsTab';
import { ProductMoreSettings } from './ProductMoreSettings';
import { ProductSupplySettings } from './ProductSupplySettings';
import { ProductVariantsTab } from './ProductVariantsTab';
import type { ProductEditorTab } from './product-editor-types';
import './product-editor.css';

const sections = [
    ['BASIC', '商品信息'],
    ['VARIANTS', '规格与价格'],
    ['DELIVERY', '交付与售后'],
    ['MORE', '更多设置'],
] as const;
const pricingBlocks = ['product-variant-multi-currency-prices', 'product-variant-custom-fields'];

export function ProductEditorWorkspace() {
    const id = useId();
    const workspace = useRef<HTMLDivElement>(null);
    const {
        isCreateMode,
        productData,
        activeTab,
        setActiveTab,
        effectiveFulfillmentType,
        refundPolicy,
        setRefundPolicy,
        manualDeliverySlaMinutes,
        setManualDeliverySlaMinutes,
        variants,
        saving,
        errorMessage,
    } = useProductEditor();
    // Keep the old attributes URL usable, while all new links use the four task tabs.
    const selectedTab = activeTab === 'FACETS_COLLECTIONS' ? 'BASIC' : activeTab;
    const hasMigration =
        effectiveFulfillmentType === 'digital' && variants.some(v => v.digitalMigrationRequired);
    const selectTab = (tab: ProductEditorTab, focus = false) => {
        setActiveTab(tab);
        workspace.current?.closest('.admin-mobile-editor-body')?.scrollTo?.({ top: 0 });
        if (focus) document.getElementById(`${id}-tab-${tab}`)?.focus();
    };
    useEffect(() => {
        if (!errorMessage) return;
        const target = workspace.current?.querySelector<HTMLElement>(
            '[role="tabpanel"]:not([hidden]) [aria-invalid="true"]',
        );
        const focusTarget =
            target ?? workspace.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
        focusTarget?.focus({ preventScroll: true });
        if (target) target.scrollIntoView?.({ block: 'nearest' });
    }, [errorMessage]);
    if (!isCreateMode && !productData?.product) return null;
    return (
        <div className="product-editor-workspace" ref={workspace}>
            <nav className="product-editor-tabs" role="tablist" aria-label="商品编辑分区">
                {sections.map(([key, name], index) => (
                    <AdminButton
                        type="button"
                        key={key}
                        role="tab"
                        id={`${id}-tab-${key}`}
                        aria-controls={`${id}-panel-${key}`}
                        aria-selected={selectedTab === key}
                        tabIndex={selectedTab === key ? 0 : -1}
                        onClick={() => selectTab(key)}
                        onKeyDown={event => {
                            let next: number;
                            if (event.key === 'ArrowRight') next = (index + 1) % sections.length;
                            else if (event.key === 'ArrowLeft')
                                next = (index + sections.length - 1) % sections.length;
                            else if (event.key === 'Home') next = 0;
                            else if (event.key === 'End') next = sections.length - 1;
                            else return;
                            event.preventDefault();
                            selectTab(sections[next][0], true);
                        }}
                        className="product-editor-tab"
                    >
                        <span aria-hidden="true" className="product-editor-tab-number">
                            0{index + 1}
                        </span>
                        {name}
                        {key === 'DELIVERY' && hasMigration && (
                            <span
                                className="h-1.5 w-1.5 rounded-full bg-amber-500"
                                aria-label="有待核对的旧库存"
                            />
                        )}
                    </AdminButton>
                ))}
            </nav>
            <div className="product-editor-columns">
                <div className="product-editor-main">
                    {/* Panels remain mounted so independent extension drafts survive tab changes. */}
                    <section
                        role="tabpanel"
                        tabIndex={-1}
                        id={`${id}-panel-BASIC`}
                        aria-labelledby={`${id}-tab-BASIC`}
                        hidden={selectedTab !== 'BASIC'}
                        className="product-editor-tab-panel"
                    >
                        <section className="product-editor-panel">
                            <h2 className="product-editor-panel-heading text-sm font-bold text-slate-900">
                                基本信息 <FeatureHelpButton topic="catalog.spu-core" title="基本信息" />
                            </h2>
                            <ProductEditorIdentityFields />
                        </section>
                        <ProductBasicTab />
                        <section className="product-editor-panel">
                            <ProductFacetsCollectionsTab section="facets" />
                        </section>
                    </section>
                    <section
                        role="tabpanel"
                        tabIndex={-1}
                        id={`${id}-panel-VARIANTS`}
                        aria-labelledby={`${id}-tab-VARIANTS`}
                        hidden={selectedTab !== 'VARIANTS'}
                        className="product-editor-tab-panel"
                    >
                        <section className="product-editor-panel">
                            <h2 className="product-editor-panel-heading text-sm font-bold text-slate-900">
                                规格与价格 <FeatureHelpButton topic="catalog.variants" title="规格与价格" />
                            </h2>
                            <ProductVariantsTab />
                        </section>
                        <div className="product-editor-independent-fields">
                            <p className="mb-3 text-xs text-slate-500">
                                其他币种价格和规格补充资料请分别保存。
                            </p>
                            <NextAdminPageBlocks
                                pageId="product-detail"
                                entity={productData?.product as unknown as Record<string, unknown>}
                                includeIds={pricingBlocks}
                            />
                        </div>
                    </section>
                    <section
                        role="tabpanel"
                        tabIndex={-1}
                        id={`${id}-panel-DELIVERY`}
                        aria-labelledby={`${id}-tab-DELIVERY`}
                        hidden={selectedTab !== 'DELIVERY'}
                        className="product-editor-tab-panel"
                    >
                        <section className="product-editor-panel">
                            <h2 className="product-editor-panel-heading text-sm font-bold text-slate-900">
                                {effectiveFulfillmentType === 'digital' ? '数字商品交付' : '实物库存与交付'}{' '}
                                <FeatureHelpButton topic="catalog.product-editor" title="交付与售后" />
                            </h2>
                            {effectiveFulfillmentType === 'digital' ? (
                                <DigitalProductWorkspace />
                            ) : (
                                <PhysicalProductWorkspace />
                            )}
                        </section>
                        <section className="product-editor-panel">
                            <h2 className="product-editor-panel-heading text-sm font-bold text-slate-900">
                                售后规则 <FeatureHelpButton topic="catalog.product-policy" title="售后规则" />
                            </h2>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <AdminField
                                    layout="stacked"
                                    label={
                                        <span className="flex items-center gap-2">
                                            退款规则{' '}
                                            <FeatureHelpButton
                                                topic="catalog.product-editor"
                                                title="退款规则"
                                            />
                                        </span>
                                    }
                                >
                                    <AdminSelect
                                        aria-label="退款规则"
                                        value={refundPolicy}
                                        disabled={saving}
                                        onChange={event =>
                                            setRefundPolicy(event.target.value as RefundPolicy)
                                        }
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
                                    variants.some(v => v.digitalDeliveryMode === 'manual_service') && (
                                        <AdminField layout="stacked" label="预计人工处理时长（分钟）">
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
                        {effectiveFulfillmentType === 'physical' && productData?.product && (
                            <section className="product-editor-panel">
                                <ProductPackagingBlock
                                    context={{
                                        pageId: 'product-detail',
                                        entity: productData.product as unknown as Record<string, unknown>,
                                    }}
                                />
                            </section>
                        )}
                    </section>
                    <section
                        role="tabpanel"
                        tabIndex={-1}
                        id={`${id}-panel-MORE`}
                        aria-labelledby={`${id}-tab-MORE`}
                        hidden={selectedTab !== 'MORE'}
                        className="product-editor-tab-panel"
                    >
                        <section className="product-editor-panel">
                            <ProductMoreSettings />
                        </section>
                        <section className="product-editor-panel">
                            <ProductSupplySettings />
                        </section>
                        <NextAdminPageBlocks
                            pageId="product-detail"
                            entity={productData?.product as unknown as Record<string, unknown>}
                            excludeIds={['catalog-product-operations', 'product-packaging', ...pricingBlocks]}
                        />
                    </section>
                </div>
                <ProductEditorSidebar>
                    <ProductCategorySummary />
                </ProductEditorSidebar>
            </div>
        </div>
    );
}
