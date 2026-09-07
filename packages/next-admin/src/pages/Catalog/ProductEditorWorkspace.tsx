import { Layers, Sliders, Tag } from 'lucide-react';

import { ProductBasicTab } from './ProductBasicTab';
import { useProductEditor } from './ProductEditorContext';
import { ProductEditorSidebar } from './ProductEditorSidebar';
import { ProductFacetsCollectionsTab } from './ProductFacetsCollectionsTab';
import { ProductVariantsTab } from './ProductVariantsTab';

export function ProductEditorWorkspace() {
    const {
        isCreateMode,
        productData,
        activeTab,
        setActiveTab,
        effectiveFulfillmentType,
        variants,
        selectedFacetValueIds,
        selectedCollectionIds,
    } = useProductEditor();

    if (!isCreateMode && !productData?.product) return null;

    return (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(15rem,17rem)_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[minmax(17rem,19rem)_minmax(0,1fr)]">
            <ProductEditorSidebar />

            <div
                role="tablist"
                aria-label="商品编辑步骤"
                className="sticky top-0 z-20 order-1 flex min-w-0 gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xs lg:col-start-2 lg:row-start-1"
            >
                <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'BASIC'}
                    aria-controls="product-basic-panel"
                    onClick={() => setActiveTab('BASIC')}
                    className={`flex min-w-fit flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold transition-colors ${
                        activeTab === 'BASIC'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                    }`}
                >
                    <Sliders className="h-3.5 w-3.5" />
                    <span>基础图文</span>
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'VARIANTS'}
                    aria-controls="product-variants-panel"
                    onClick={() => setActiveTab('VARIANTS')}
                    className={`flex min-w-fit flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold transition-colors ${
                        activeTab === 'VARIANTS'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                    }`}
                >
                    <Layers className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">
                        {effectiveFulfillmentType === 'digital' ? '销售与自动发货' : 'SKU 与库存'}
                    </span>
                    <span className="sm:hidden">
                        {effectiveFulfillmentType === 'digital' ? '销售发货' : 'SKU 库存'}
                    </span>
                    <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                            activeTab === 'VARIANTS'
                                ? 'bg-white/15 text-white'
                                : 'bg-slate-100 text-slate-500'
                        }`}
                    >
                        {variants.length}
                    </span>
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'FACETS_COLLECTIONS'}
                    aria-controls="product-facets-panel"
                    onClick={() => setActiveTab('FACETS_COLLECTIONS')}
                    className={`flex min-w-fit flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold transition-colors ${
                        activeTab === 'FACETS_COLLECTIONS'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                    }`}
                >
                    <Tag className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">标签与分类</span>
                    <span className="sm:hidden">标签分类</span>
                    <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                            activeTab === 'FACETS_COLLECTIONS'
                                ? 'bg-white/15 text-white'
                                : 'bg-slate-100 text-slate-500'
                        }`}
                    >
                        {selectedFacetValueIds.length + selectedCollectionIds.length}
                    </span>
                </button>
            </div>

            {activeTab === 'BASIC' && (
                <div
                    id="product-basic-panel"
                    role="tabpanel"
                    className="order-3 min-w-0 lg:col-start-2 lg:row-start-2"
                >
                    <ProductBasicTab />
                </div>
            )}
            {activeTab === 'VARIANTS' && (
                <div
                    id="product-variants-panel"
                    role="tabpanel"
                    className="order-3 min-w-0 lg:col-start-2 lg:row-start-2"
                >
                    <ProductVariantsTab />
                </div>
            )}
            {activeTab === 'FACETS_COLLECTIONS' && (
                <div
                    id="product-facets-panel"
                    role="tabpanel"
                    className="order-3 min-w-0 lg:col-start-2 lg:row-start-2"
                >
                    <ProductFacetsCollectionsTab />
                </div>
            )}
        </div>
    );
}
