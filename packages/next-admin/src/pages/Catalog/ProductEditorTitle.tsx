import { FeatureHelpButton } from '../../components/FeatureHelp';

export function ProductEditorTitle({
    isCreateMode,
    productName,
    enabled,
}: {
    isCreateMode: boolean;
    productName?: string;
    enabled?: boolean;
}) {
    return (
        <div className="product-editor-title">
            <h1 className="shrink-0 text-lg font-bold text-slate-900">
                {isCreateMode ? '创建新商品' : '编辑商品详情'}
            </h1>
            {productName && (
                <span className="product-editor-title-name text-sm text-slate-500" title={productName}>
                    {productName}
                </span>
            )}
            {!isCreateMode && enabled !== undefined && (
                <span
                    className={`product-editor-title-status shrink-0 rounded px-2 py-0.5 text-xs ${enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                >
                    {enabled ? '已启用' : '已禁用'}
                </span>
            )}
            <FeatureHelpButton
                topic="catalog.product-editor"
                title={isCreateMode ? '创建新商品' : '编辑商品详情'}
                description={
                    isCreateMode ? '录入基础商品信息并生成规格变体' : '修改核心参数、变体定价及所属分类'
                }
            />
        </div>
    );
}
