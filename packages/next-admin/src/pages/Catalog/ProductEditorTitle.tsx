import { FeatureHelpButton } from '../../components/FeatureHelp';

export function ProductEditorTitle({ isCreateMode }: { isCreateMode: boolean }) {
    return (
        <div>
            <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-900">
                    {isCreateMode ? '创建新商品' : '编辑商品详情'}
                </h1>
                <FeatureHelpButton
                    topic="catalog.product-editor"
                    title={isCreateMode ? '创建新商品' : '编辑商品详情'}
                />
                <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded ${isCreateMode ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700'}`}
                >
                    {isCreateMode ? 'Draft' : 'SPU'}
                </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
                {isCreateMode ? '录入基础商品信息并生成规格变体' : '修改核心参数、变体定价及所属分类'}
            </p>
        </div>
    );
}
