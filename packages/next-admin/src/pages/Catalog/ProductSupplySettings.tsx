import { AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { CATALOG_SUPPLIERS_QUERY } from '../../graphql/catalog-operations.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { toUserFacingError } from '../../utils/user-facing-error';
import { useProductEditor } from './ProductEditorContext';

export function ProductSupplySettings() {
    const { variants, handleVariantFieldChange, saving } = useProductEditor();
    const { hasAnyPermission } = useAdminPermissions();
    const canRead = hasAnyPermission(['SuperAdmin', 'ReadCatalogSupplier']);
    const suppliers = useQuery<{
        catalogSuppliers: { items: Array<{ id: string; name: string; enabled: boolean }> };
    }>(CATALOG_SUPPLIERS_QUERY, { skip: !canRead, variables: { options: { skip: 0, take: 100 } } });
    if (!canRead) return null;
    return (
        <details className="border-t border-slate-100 pt-4">
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                供货来源（可选）
            </summary>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
                {variants.map((variant, index) => (
                    <AdminField
                        key={variant.id ?? index}
                        className="space-y-1.5 text-xs font-semibold text-slate-700"
                        label={
                            <>
                                <span className="flex min-h-6 items-center gap-2">
                                    {variant.name || '默认规格'}
                                    <FeatureHelpButton
                                        title="供货来源"
                                        content={{
                                            purpose:
                                                '记录该规格的供货商，成本在规格与价格中填写。数字供货记录独立保存，不办理实物入库。',
                                            requirements: [],
                                            example: '',
                                        }}
                                    />
                                </span>
                            </>
                        }
                    >
                        {' '}
                        <AdminSelect
                            aria-label={`规格 ${index + 1} 供货来源`}
                            disabled={saving || suppliers.loading || Boolean(suppliers.error)}
                            value={variant.supplierId ?? ''}
                            onChange={event =>
                                handleVariantFieldChange(index, 'supplierId', event.target.value || null)
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs"
                        >
                            <option value="">不关联供货商</option>
                            {suppliers.data?.catalogSuppliers.items
                                .filter(item => item.enabled || item.id === variant.supplierId)
                                .map(item => (
                                    <option key={item.id} value={item.id}>
                                        {item.name}
                                    </option>
                                ))}
                            {variant.supplierId &&
                                !suppliers.data?.catalogSuppliers.items.some(
                                    item => item.id === variant.supplierId,
                                ) && <option value={variant.supplierId}>已关联供货商</option>}
                        </AdminSelect>
                    </AdminField>
                ))}
            </div>
            {suppliers.error && (
                <p role="alert" className="mt-2 text-xs text-rose-600">
                    {toUserFacingError(suppliers.error, '供货商读取失败')}
                </p>
            )}
        </details>
    );
}
