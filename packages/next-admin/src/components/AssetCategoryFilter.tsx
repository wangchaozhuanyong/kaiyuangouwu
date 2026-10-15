import { ASSET_CATEGORIES, type AssetCategory } from '../utils/asset-categories';
import { AdminButton } from './AdminControls';

export function AssetCategoryFilter({
    value,
    onChange,
}: {
    value: AssetCategory;
    onChange: (category: AssetCategory) => void;
}) {
    return (
        <div role="group" aria-label="素材分类" className="flex flex-wrap gap-2">
            {ASSET_CATEGORIES.map(category => (
                <AdminButton
                    key={category.value}
                    type="button"
                    aria-pressed={value === category.value}
                    onClick={() => onChange(category.value)}
                    className={`rounded-lg px-3 py-2 text-xs font-bold ${
                        value === category.value
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                >
                    {category.label}
                </AdminButton>
            ))}
        </div>
    );
}
