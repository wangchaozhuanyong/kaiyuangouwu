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
                    description={
                        isCreateMode ? '录入基础商品信息并生成规格变体' : '修改核心参数、变体定价及所属分类'
                    }
                />
            </div>
        </div>
    );
}
