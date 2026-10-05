import { Link } from 'react-router-dom';
import { AdminInput } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { useProductEditor } from './ProductEditorContext';

/** Physical fulfillment configuration never writes digital quotas or delivery resources. */
export function PhysicalProductWorkspace() {
    const { variants, saving, handleVariantFieldChange } = useProductEditor();
    return (
        <div className="space-y-4" data-product-domain="physical">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-2 font-semibold text-slate-700">
                    仓库库存 <FeatureHelpButton topic="catalog.inventory" title="实物库存" />
                </span>
                <Link to="/catalog/inventory" className="font-semibold text-blue-700">
                    入库与库存管理
                </Link>
            </div>
            {variants.map((variant, index) => (
                <div key={variant.id ?? index} className="space-y-3 border-t border-slate-100 pt-3">
                    <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-600">
                        <strong>{variant.name || '默认规格'}</strong>
                        <span>
                            在库 {variant.stockOnHand || 0} · 已占用 {variant.stockAllocated}
                        </span>
                    </div>
                    <details>
                        <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                            包装与效期高级设置
                        </summary>
                        <div className="mt-3 grid gap-4 md:grid-cols-2">
                            <AdminField
                                className="space-y-1.5 text-xs font-semibold text-slate-700"
                                label={
                                    <>
                                        <span className="flex min-h-6 items-center gap-2">
                                            包装换算
                                            <FeatureHelpButton topic="catalog.inventory" title="包装换算" />
                                        </span>
                                    </>
                                }
                            >
                                {' '}
                                <AdminInput
                                    aria-label={`规格 ${index + 1} 包装换算`}
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={variant.physicalSettings?.packageQuantity ?? 1}
                                    disabled={saving}
                                    onChange={event =>
                                        handleVariantFieldChange(index, 'physicalSettings', {
                                            ...variant.physicalSettings,
                                            packageQuantity: Number(event.target.value),
                                        })
                                    }
                                    className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs"
                                />
                            </AdminField>
                            <AdminField
                                className="space-y-1.5 text-xs font-semibold text-slate-700"
                                label={
                                    <>
                                        <span className="flex min-h-6 items-center gap-2">
                                            默认保质期（天）
                                            <FeatureHelpButton topic="catalog.inventory" title="默认保质期" />
                                        </span>
                                    </>
                                }
                            >
                                {' '}
                                <AdminInput
                                    aria-label={`规格 ${index + 1} 默认保质期`}
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={variant.physicalSettings?.shelfLifeDays ?? ''}
                                    disabled={saving}
                                    onChange={event =>
                                        handleVariantFieldChange(index, 'physicalSettings', {
                                            ...variant.physicalSettings,
                                            shelfLifeDays:
                                                event.target.value === '' ? null : Number(event.target.value),
                                        })
                                    }
                                    className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs"
                                />
                            </AdminField>
                        </div>
                        <div className="mt-3 flex gap-4 text-xs font-semibold text-blue-700">
                            <Link to="/catalog/inventory">批次、效期与拆包</Link>
                        </div>
                    </details>
                </div>
            ))}
        </div>
    );
}
