import { useEffect, useId, useRef } from 'react';
import { AdminButton, AdminInput, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { NextAdminPageBlocks } from '../../extensions/extension-hosts';
import type { RefundPolicy } from '../../graphql/commerce.graphql';
import { useAdminCapabilities } from '../../hooks/use-admin-capabilities';
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
    ['BASIC', '商品信息与规格价格'],
    ['DELIVERY', '交付售后与更多设置'],
] as const;
const pricingBlocks = ['product-variant-multi-currency-prices', 'product-variant-custom-fields'];

export function ProductEditorWorkspace() {
    const id = useId();
    const workspace = useRef<HTMLDivElement>(null);
    const userTabSelection = useRef<{ tab: ProductEditorTab; error: string } | null>(null);
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
        description,
        saving,
        errorMessage,
    } = useProductEditor();
    const { canUseCapability } = useAdminCapabilities();
    const canWriteProduct = canUseCapability(
        isCreateMode ? '/catalog/products/new' : '/catalog/products',
        'write',
    );
    // Legacy URLs and validation targets resolve to the same mounted task panels.
    const selectedTab = activeTab === 'DELIVERY' || activeTab === 'MORE' ? 'DELIVERY' : 'BASIC';
    const hasMigration =
        effectiveFulfillmentType === 'digital' && variants.some(v => v.digitalMigrationRequired);
    const selectTab = (tab: ProductEditorTab, focus = false) => {
        userTabSelection.current = { tab, error: errorMessage };
        setActiveTab(tab);
        workspace.current?.closest('.admin-mobile-editor-body')?.scrollTo?.({ top: 0 });
        if (focus) document.getElementById(`${id}-tab-${tab}`)?.focus();
    };
    useEffect(() => {
        const selection = userTabSelection.current;
        userTabSelection.current = null;
        if (!errorMessage) return;
        if (selection?.tab === selectedTab && selection.error === errorMessage) return;
        const target = workspace.current?.querySelector<HTMLElement>(
            '[role="tabpanel"]:not([hidden]) [aria-invalid="true"]',
        );
        const focusTarget =
            target ?? workspace.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
        focusTarget?.focus({ preventScroll: true });
        if (target) target.scrollIntoView?.({ block: 'nearest' });
    }, [errorMessage, selectedTab]);
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
                        <fieldset
                            key={String(canWriteProduct)}
                            disabled={!canWriteProduct}
                            className="contents"
                        >
                            <section className="product-editor-panel">
                                <h2 className="product-editor-panel-heading text-sm font-bold text-slate-900">
                                    基本信息 <FeatureHelpButton topic="catalog.spu-core" title="基本信息" />
                                </h2>
                                <ProductEditorIdentityFields />
                            </section>
                            {canWriteProduct ? (
                                <ProductBasicTab />
                            ) : (
                                <div className="space-y-5">
                                    <section className="product-editor-panel">
                                        <h2 className="product-editor-panel-heading text-sm font-bold text-slate-900">
                                            商品描述{' '}
                                            <FeatureHelpButton topic="catalog.spu-core" title="商品描述" />
                                        </h2>
                                        <div
                                            className="product-editor-description-reader"
                                            aria-label="商品描述阅读"
                                        >
                                            {description || '尚未填写商品描述'}
                                        </div>
                                    </section>
                                    <section className="product-editor-panel">
                                        <h2 className="product-editor-panel-heading text-sm font-bold text-slate-900">
                                            商品详情图{' '}
                                            <FeatureHelpButton
                                                topic="catalog.product-assets"
                                                title="商品详情图"
                                            />
                                        </h2>
                                        <div className="product-editor-gallery">
                                            {productData?.product?.assets.map(asset => (
                                                <img
                                                    key={asset.id}
                                                    src={asset.preview}
                                                    alt={asset.name}
                                                    className="aspect-square w-full object-contain"
                                                />
                                            ))}
                                        </div>
                                    </section>
                                </div>
                            )}
                            <section className="product-editor-panel">
                                <h2 className="product-editor-panel-heading text-sm font-bold text-slate-900">
                                    规格与价格{' '}
                                    <FeatureHelpButton topic="catalog.variants" title="规格与价格" />
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
                            <section className="product-editor-panel">
                                <ProductFacetsCollectionsTab section="facets" />
                            </section>
                        </fieldset>
                    </section>
                    <section
                        role="tabpanel"
                        tabIndex={-1}
                        id={`${id}-panel-DELIVERY`}
                        aria-labelledby={`${id}-tab-DELIVERY`}
                        hidden={selectedTab !== 'DELIVERY'}
                        className="product-editor-tab-panel"
                    >
                        <fieldset
                            key={String(canWriteProduct)}
                            disabled={!canWriteProduct}
                            className="contents"
                        >
                            <section className="product-editor-panel">
                                <h2 className="product-editor-panel-heading text-sm font-bold text-slate-900">
                                    {effectiveFulfillmentType === 'digital'
                                        ? '数字商品交付'
                                        : '实物库存与交付'}{' '}
                                    <FeatureHelpButton topic="catalog.product-editor" title="交付与售后" />
                                </h2>
                                {effectiveFulfillmentType === 'digital' ? (
                                    <DigitalProductWorkspace />
                                ) : (
                                    <PhysicalProductWorkspace />
                                )}
                            </section>
                            <div className="product-editor-settings-grid">
                                <section className="product-editor-panel">
                                    <h2 className="product-editor-panel-heading text-sm font-bold text-slate-900">
                                        售后规则{' '}
                                        <FeatureHelpButton topic="catalog.product-policy" title="售后规则" />
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
                                                <option value="MERCHANT_REVIEW">
                                                    可申请退款（商家审核）
                                                </option>
                                                <option value="NON_REFUNDABLE">不支持退款申请</option>
                                                {effectiveFulfillmentType === 'physical' && (
                                                    <option value="SEVEN_DAY_NO_REASON">
                                                        七天无理由退货
                                                    </option>
                                                )}
                                            </AdminSelect>
                                        </AdminField>
                                        {effectiveFulfillmentType === 'digital' &&
                                            variants.some(
                                                v => v.digitalDeliveryMode === 'manual_service',
                                            ) && (
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
                                                            setManualDeliverySlaMinutes(
                                                                Number(event.target.value),
                                                            )
                                                        }
                                                        className="w-full rounded-lg border border-slate-300 bg-white p-2.5"
                                                    />
                                                </AdminField>
                                            )}
                                    </div>
                                </section>
                                <section className="product-editor-panel">
                                    <h2 className="product-editor-panel-heading text-sm font-bold text-slate-900">
                                        更多设置
                                    </h2>
                                    <ProductMoreSettings />
                                    <ProductSupplySettings />
                                </section>
                            </div>
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
                            <NextAdminPageBlocks
                                pageId="product-detail"
                                entity={productData?.product as unknown as Record<string, unknown>}
                                excludeIds={[
                                    'catalog-product-operations',
                                    'product-packaging',
                                    ...pricingBlocks,
                                ]}
                            />
                        </fieldset>
                    </section>
                </div>
                <ProductEditorSidebar>
                    <ProductCategorySummary />
                </ProductEditorSidebar>
            </div>
        </div>
    );
}
