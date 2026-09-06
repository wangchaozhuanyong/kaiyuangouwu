import { useMutation, useQuery } from '@apollo/client/react';
import { Boxes, CalendarClock, CircleDollarSign, PackageOpen, Plus, RefreshCw, Save, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { DynamicCustomFieldsForm } from '../../custom-fields/DynamicCustomFieldsForm';
import type { CustomFieldValueMap } from '../../custom-fields/custom-field-types';
import {
    addCustomFieldsToDocument,
    customFieldInputFromValues,
    customFieldValuesFromEntity,
    isDashboardVisibleCustomField,
    localizedCustomFieldInputFromValues,
    validateCustomFieldValues,
} from '../../custom-fields/custom-field-utils';
import { useCustomFieldDefinitions } from '../../custom-fields/custom-fields-context';
import type { NextAdminPageBlockContext } from '../../extensions/extension-api';
import {
    CATALOG_PRODUCT_WORKSPACE_QUERY,
    CATALOG_SUPPLIERS_QUERY,
    PRODUCT_PACKAGING_WORKSPACE_QUERY,
    PRODUCT_VARIANT_CUSTOM_FIELDS_QUERY,
    PRODUCT_VARIANT_PRICES_QUERY,
    SAVE_CATALOG_INVENTORY_LOT_MUTATION,
    UPDATE_CATALOG_VARIANT_OPERATIONS_MUTATION,
    UPDATE_PRODUCT_PACKAGING_MUTATION,
    UPDATE_PRODUCT_VARIANT_CUSTOM_FIELDS_MUTATION,
    UPDATE_PRODUCT_VARIANT_PRICES_MUTATION,
    type CatalogSupplierRecord,
    type CatalogWorkspaceResult,
    type CatalogWorkspaceVariantRecord,
    type ProductPackagingWorkspaceResult,
} from '../../graphql/catalog-operations.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime, formatMoney } from '../Sales/sales-utils';
import { dateInputToUtcDateTime } from './catalog-date';
import { calculateDraftMargin } from './catalog-margin';

interface VariantDraft {
    id: string;
    enabled: boolean;
    sku: string;
    barcode: string;
    specification: string;
    saleUnit: string;
    purchaseUnit: string;
    packageQuantity: string;
    shelfLifeDays: string;
    sellingPrice: string;
    purchaseCost: string;
    stockOnHand: string;
    minimumStock: string;
    maximumStock: string;
    supplierId: string;
}

interface LotDraft {
    id?: string;
    productVariantId: string;
    stockLocationId: string;
    lotCode: string;
    manufacturedAt: string;
    expiresAt: string;
    quantityOnHand: string;
    purchaseCost: string;
}

export function CatalogOperationsBlock({ context }: { context: NextAdminPageBlockContext }) {
    const productId = stringId(context.entity?.id);
    const query = useQuery<CatalogWorkspaceResult>(CATALOG_PRODUCT_WORKSPACE_QUERY, {
        variables: { productId },
        skip: !productId,
        fetchPolicy: 'cache-and-network',
    });
    const supplierQuery = useQuery<{
        catalogSuppliers: { items: CatalogSupplierRecord[]; totalItems: number };
    }>(CATALOG_SUPPLIERS_QUERY, {
        variables: { options: { skip: 0, take: 100 } },
        skip: !productId,
    });
    const [saveOperations, saveState] = useMutation(UPDATE_CATALOG_VARIANT_OPERATIONS_MUTATION);
    const [saveLot, lotState] = useMutation(SAVE_CATALOG_INVENTORY_LOT_MUTATION);
    const workspace = query.data?.catalogProductWorkspace;
    const [stockLocationId, setStockLocationId] = useState('');
    const [drafts, setDrafts] = useState<Record<string, VariantDraft>>({});
    const [dirtyIds, setDirtyIds] = useState<string[]>([]);
    const [lotDraft, setLotDraft] = useState<LotDraft | null>(null);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');

    /* oxlint-disable react/set-state-in-effect -- the selected warehouse response initializes SKU drafts. */
    useEffect(() => {
        if (!workspace || dirtyIds.length) return;
        const locationId = stockLocationId || workspace.stockLocations[0]?.id || '';
        if (!stockLocationId && locationId) setStockLocationId(locationId);
        setDrafts(
            Object.fromEntries(workspace.variants.map(variant => [variant.id, toDraft(variant, locationId)])),
        );
    }, [dirtyIds.length, stockLocationId, workspace]);
    /* oxlint-enable react/set-state-in-effect */

    const suppliers = useMemo(() => {
        const records = new Map<string, Pick<CatalogSupplierRecord, 'id' | 'code' | 'name' | 'enabled'>>();
        workspace?.variants.forEach(variant => {
            if (variant.supplier) records.set(variant.supplier.id, variant.supplier);
        });
        supplierQuery.data?.catalogSuppliers.items.forEach(supplier => records.set(supplier.id, supplier));
        return [...records.values()];
    }, [supplierQuery.data, workspace]);

    if (!productId) return null;
    if (query.loading && !workspace) return <PanelState label="正在读取采购、库存与批次数据…" />;
    if (query.error || !workspace) {
        return (
            <PanelState tone="error" label="商品供应链工作区加载失败" action={() => void query.refetch()} />
        );
    }

    const changeWarehouse = (next: string) => {
        if (dirtyIds.length) {
            setError('请先保存当前仓库的 SKU 修改，再切换仓库');
            return;
        }
        setStockLocationId(next);
        setDrafts(
            Object.fromEntries(workspace.variants.map(variant => [variant.id, toDraft(variant, next)])),
        );
    };
    const updateDraft = (id: string, patch: Partial<VariantDraft>) => {
        setDrafts(current => ({ ...current, [id]: { ...current[id], ...patch } }));
        setDirtyIds(current => (current.includes(id) ? current : [...current, id]));
        setNotice('');
        setError('');
    };
    const save = async () => {
        if (!stockLocationId || !dirtyIds.length) return;
        try {
            const input = dirtyIds.map(id =>
                operationInput(drafts[id], stockLocationId, workspace.currencyCode),
            );
            await saveOperations({ variables: { input } });
            setDirtyIds([]);
            setNotice(`已保存 ${input.length} 个 SKU 的采购、价格和库存资料`);
            setError('');
            await query.refetch();
        } catch (cause) {
            setError(toUserFacingError(cause, 'SKU 经营资料保存失败，请检查输入后重试'));
        }
    };
    const commitLot = async (draft: LotDraft) => {
        try {
            await saveLot({
                variables: {
                    input: {
                        ...(draft.id ? { id: draft.id } : {}),
                        productVariantId: draft.productVariantId,
                        stockLocationId: draft.stockLocationId,
                        lotCode: requiredText(draft.lotCode, '批次号'),
                        manufacturedAt: dateInputToUtcDateTime(draft.manufacturedAt),
                        expiresAt: dateInputToUtcDateTime(draft.expiresAt),
                        quantityOnHand: integer(draft.quantityOnHand, '批次数量'),
                        purchaseCostMicrounits: draft.purchaseCost.trim()
                            ? Math.round(number(draft.purchaseCost, '批次成本') * 1_000)
                            : null,
                        currencyCode: workspace.currencyCode,
                    },
                },
            });
            setLotDraft(null);
            setNotice('库存批次已保存，并生成对应库存调整流水');
            setError('');
            await query.refetch();
        } catch (cause) {
            setError(toUserFacingError(cause, '库存批次保存失败，请检查输入后重试'));
        }
    };
    const visibleLots = workspace.variants.flatMap(variant =>
        variant.lots
            .filter(lot => lot.stockLocationId === stockLocationId)
            .map(lot => ({ ...lot, variantName: variant.name, sku: variant.sku })),
    );

    return (
        <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <Boxes className="h-4 w-4 text-blue-600" /> 采购、成本、库存与批次
                        <FeatureHelpButton topic="catalog.inventory" title="采购、成本、库存与批次" />
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                        恢复旧后台的 SKU 经营字段；成本保留三位小数，价格按当前店铺币种保存。
                    </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs font-bold text-slate-600">
                        当前仓库
                        <select
                            value={stockLocationId}
                            onChange={event => changeWarehouse(event.target.value)}
                            className="mt-1 block min-w-44 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                        >
                            {workspace.stockLocations.map(location => (
                                <option key={location.id} value={location.id}>
                                    {location.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button
                        type="button"
                        onClick={() => void save()}
                        disabled={!dirtyIds.length || saveState.loading}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40"
                    >
                        <Save className="h-4 w-4" />
                        {saveState.loading
                            ? '保存中…'
                            : `保存修改${dirtyIds.length ? ` (${dirtyIds.length})` : ''}`}
                    </button>
                </div>
            </div>
            {notice && <InlineNotice tone="success" message={notice} />}
            {error && <InlineNotice tone="error" message={error} />}
            <div className="space-y-3">
                {workspace.variants.map(variant => {
                    const draft = drafts[variant.id];
                    if (!draft) return null;
                    const margin = calculateDraftMargin(draft.sellingPrice, draft.purchaseCost);
                    return (
                        <details
                            key={variant.id}
                            className="rounded-xl border border-slate-200"
                            open={dirtyIds.includes(variant.id)}
                        >
                            <summary className="cursor-pointer list-none px-4 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span>
                                        <strong className="text-sm text-slate-900">{variant.name}</strong>
                                        <small className="ml-2 font-mono text-slate-500">{variant.sku}</small>
                                    </span>
                                    <span className="text-xs text-slate-500">
                                        销售价 {formatMoney(variant.sellingPrice, variant.currencyCode)} ·
                                        毛利 {margin == null ? '—' : `${(margin * 100).toFixed(1)}%`}
                                    </span>
                                </div>
                            </summary>
                            <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-2 xl:grid-cols-4">
                                <TextField
                                    label="SKU"
                                    value={draft.sku}
                                    onChange={sku => updateDraft(variant.id, { sku })}
                                />
                                <TextField
                                    label="条码"
                                    value={draft.barcode}
                                    onChange={barcode => updateDraft(variant.id, { barcode })}
                                />
                                <TextField
                                    label="规格"
                                    value={draft.specification}
                                    onChange={specification => updateDraft(variant.id, { specification })}
                                />
                                <label className="text-xs font-bold text-slate-600">
                                    供货商
                                    <select
                                        value={draft.supplierId}
                                        onChange={event =>
                                            updateDraft(variant.id, { supplierId: event.target.value })
                                        }
                                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                                    >
                                        <option value="">不关联</option>
                                        {suppliers.map(supplier => (
                                            <option key={supplier.id} value={supplier.id}>
                                                {supplier.name} {supplier.enabled ? '' : '（已停用）'}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <TextField
                                    label="销售单位"
                                    value={draft.saleUnit}
                                    onChange={saleUnit => updateDraft(variant.id, { saleUnit })}
                                />
                                <TextField
                                    label="采购单位"
                                    value={draft.purchaseUnit}
                                    onChange={purchaseUnit => updateDraft(variant.id, { purchaseUnit })}
                                />
                                <TextField
                                    label="包装换算"
                                    type="number"
                                    value={draft.packageQuantity}
                                    onChange={packageQuantity => updateDraft(variant.id, { packageQuantity })}
                                />
                                <TextField
                                    label="保质期（天）"
                                    type="number"
                                    value={draft.shelfLifeDays}
                                    onChange={shelfLifeDays => updateDraft(variant.id, { shelfLifeDays })}
                                />
                                <TextField
                                    label={`销售价 (${workspace.currencyCode})`}
                                    type="number"
                                    value={draft.sellingPrice}
                                    onChange={sellingPrice => updateDraft(variant.id, { sellingPrice })}
                                />
                                <TextField
                                    label={`采购成本 (${workspace.currencyCode})`}
                                    type="number"
                                    value={draft.purchaseCost}
                                    onChange={purchaseCost => updateDraft(variant.id, { purchaseCost })}
                                />
                                <TextField
                                    label="当前仓库库存"
                                    type="number"
                                    value={draft.stockOnHand}
                                    onChange={stockOnHand => updateDraft(variant.id, { stockOnHand })}
                                />
                                <TextField
                                    label="库存下限"
                                    type="number"
                                    value={draft.minimumStock}
                                    onChange={minimumStock => updateDraft(variant.id, { minimumStock })}
                                />
                                <TextField
                                    label="库存上限"
                                    type="number"
                                    value={draft.maximumStock}
                                    onChange={maximumStock => updateDraft(variant.id, { maximumStock })}
                                />
                                <label className="flex items-center gap-2 self-end rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700">
                                    <input
                                        type="checkbox"
                                        checked={draft.enabled}
                                        onChange={event =>
                                            updateDraft(variant.id, { enabled: event.target.checked })
                                        }
                                    />
                                    SKU 启用
                                </label>
                                <div className="flex items-end sm:col-span-2 xl:col-span-2">
                                    <button
                                        type="button"
                                        onClick={() => setLotDraft(emptyLot(variant.id, stockLocationId))}
                                        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
                                    >
                                        <Plus className="h-4 w-4" /> 新增库存批次
                                    </button>
                                </div>
                            </div>
                        </details>
                    );
                })}
            </div>

            <div className="border-t border-slate-200 pt-5">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <CalendarClock className="h-4 w-4 text-amber-600" /> 当前仓库批次与效期
                    <FeatureHelpButton topic="catalog.inventory" title="当前仓库批次与效期" />
                </h3>
                {!visibleLots.length ? (
                    <p className="mt-3 rounded-lg border border-dashed p-6 text-center text-xs text-slate-500">
                        当前仓库还没有库存批次
                    </p>
                ) : (
                    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                        <table className="min-w-[850px] w-full text-left text-xs">
                            <thead className="bg-slate-50 text-slate-500">
                                <tr>
                                    {[
                                        'SKU',
                                        '批次号',
                                        '生产日期',
                                        '到期日期',
                                        '数量',
                                        '成本',
                                        '状态',
                                        '操作',
                                    ].map(label => (
                                        <th key={label} className="px-3 py-2.5 font-bold">
                                            {label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {visibleLots.map(lot => (
                                    <tr key={lot.id}>
                                        <td className="px-3 py-3">
                                            <strong>{lot.variantName}</strong>
                                            <small className="ml-2 font-mono text-slate-500">{lot.sku}</small>
                                        </td>
                                        <td className="px-3 py-3 font-mono">{lot.lotCode}</td>
                                        <td className="px-3 py-3">{dateOnly(lot.manufacturedAt)}</td>
                                        <td className="px-3 py-3">{dateOnly(lot.expiresAt)}</td>
                                        <td className="px-3 py-3">{lot.quantityOnHand}</td>
                                        <td className="px-3 py-3">
                                            {lot.purchaseCostMicrounits == null
                                                ? '—'
                                                : `${workspace.currencyCode} ${(lot.purchaseCostMicrounits / 1_000).toFixed(3)}`}
                                        </td>
                                        <td className="px-3 py-3">{lot.state}</td>
                                        <td className="px-3 py-3">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setLotDraft({
                                                        id: lot.id,
                                                        productVariantId: lot.productVariantId,
                                                        stockLocationId: lot.stockLocationId,
                                                        lotCode: lot.lotCode,
                                                        manufacturedAt: inputDate(lot.manufacturedAt),
                                                        expiresAt: inputDate(lot.expiresAt),
                                                        quantityOnHand: String(lot.quantityOnHand),
                                                        purchaseCost:
                                                            lot.purchaseCostMicrounits == null
                                                                ? ''
                                                                : (
                                                                      lot.purchaseCostMicrounits / 1_000
                                                                  ).toFixed(3),
                                                    })
                                                }
                                                className="font-bold text-blue-600 hover:underline"
                                            >
                                                编辑
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {lotDraft && (
                <LotEditor
                    value={lotDraft}
                    currencyCode={workspace.currencyCode}
                    saving={lotState.loading}
                    onClose={() => setLotDraft(null)}
                    onSave={commitLot}
                />
            )}
        </section>
    );
}

export function ProductPackagingBlock({ context }: { context: NextAdminPageBlockContext }) {
    const productId = stringId(context.entity?.id);
    const query = useQuery<ProductPackagingWorkspaceResult>(PRODUCT_PACKAGING_WORKSPACE_QUERY, {
        variables: { productId },
        skip: !productId,
        fetchPolicy: 'cache-and-network',
    });
    const [updatePackaging, updateState] = useMutation(UPDATE_PRODUCT_PACKAGING_MUTATION);
    const data = query.data;
    const variants = useMemo(() => data?.product?.variants ?? [], [data?.product?.variants]);
    const [unitVariantId, setUnitVariantId] = useState('');
    const [packageVariantId, setPackageVariantId] = useState('');
    const [unitLabel, setUnitLabel] = useState('件');
    const [packageLabel, setPackageLabel] = useState('箱');
    const [unitsPerPackage, setUnitsPerPackage] = useState('24');
    const [enabled, setEnabled] = useState(true);
    const [autoUnpack, setAutoUnpack] = useState(true);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');

    /* oxlint-disable react/set-state-in-effect -- the versioned packaging response initializes the form. */
    useEffect(() => {
        const rule = data?.productPackaging;
        if (rule) {
            setUnitVariantId(rule.unitVariant.id);
            setPackageVariantId(rule.packageVariant.id);
            setUnitLabel(rule.unitLabel);
            setPackageLabel(rule.packageLabel);
            setUnitsPerPackage(String(rule.unitsPerPackage));
            setEnabled(rule.enabled);
            setAutoUnpack(rule.autoUnpack);
        } else if (variants.length >= 2 && !unitVariantId && !packageVariantId) {
            setUnitVariantId(variants[0].id);
            setPackageVariantId(variants[1].id);
        }
    }, [data?.productPackaging, packageVariantId, unitVariantId, variants]);
    /* oxlint-enable react/set-state-in-effect */

    if (!productId) return null;
    if (query.loading && !data) return <PanelState label="正在读取包装换算配置…" />;
    if (query.error || !data)
        return <PanelState tone="error" label="包装配置加载失败" action={() => void query.refetch()} />;
    if (variants.length < 2) {
        return <PanelState label="至少需要两个 SKU，才能配置整箱与散件自动拆包。" />;
    }
    const save = async () => {
        try {
            if (unitVariantId === packageVariantId) throw new Error('散件 SKU 与整包 SKU 不能相同');
            const quantity = integer(unitsPerPackage, '每包数量');
            if (quantity < 2) throw new Error('每包数量必须至少为 2');
            const selected = variants.filter(item => [unitVariantId, packageVariantId].includes(item.id));
            if (selected.some(item => item.trackInventory === 'FALSE'))
                throw new Error('两个 SKU 都必须跟踪库存');
            await updatePackaging({
                variables: {
                    input: {
                        productId,
                        unitVariantId,
                        packageVariantId,
                        unitLabel: requiredText(unitLabel, '散件单位'),
                        packageLabel: requiredText(packageLabel, '整包单位'),
                        unitsPerPackage: quantity,
                        enabled,
                        autoUnpack,
                    },
                },
            });
            setNotice('包装换算与自动拆包配置已保存');
            setError('');
            await query.refetch();
        } catch (cause) {
            setError(toUserFacingError(cause, '包装配置保存失败，请检查输入后重试'));
        }
    };
    const stock = data.productPackagingStock;
    return (
        <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <PackageOpen className="h-4 w-4 text-violet-600" /> 包装换算与自动拆包
                        <FeatureHelpButton topic="catalog.inventory" title="包装换算与自动拆包" />
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                        散件库存不足时，可在支付确认阶段自动拆整包补充库存。
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={updateState.loading}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
                >
                    <Save className="h-4 w-4" /> {updateState.loading ? '保存中…' : '保存包装配置'}
                </button>
            </div>
            {notice && <InlineNotice tone="success" message={notice} />}
            {error && <InlineNotice tone="error" message={error} />}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <SelectField
                    label="散件 SKU"
                    value={unitVariantId}
                    onChange={setUnitVariantId}
                    options={variants}
                />
                <SelectField
                    label="整包 SKU"
                    value={packageVariantId}
                    onChange={setPackageVariantId}
                    options={variants}
                />
                <TextField
                    label="每包散件数量"
                    type="number"
                    value={unitsPerPackage}
                    onChange={setUnitsPerPackage}
                />
                <TextField label="散件单位" value={unitLabel} onChange={setUnitLabel} />
                <TextField label="整包单位" value={packageLabel} onChange={setPackageLabel} />
                <div className="flex flex-col justify-end gap-2">
                    <Toggle label="启用包装销售" checked={enabled} onChange={setEnabled} />
                    <Toggle label="库存不足时自动拆包" checked={autoUnpack} onChange={setAutoUnpack} />
                </div>
            </div>
            {stock && (
                <div className="grid gap-3 sm:grid-cols-3">
                    <StockMetric label={`${unitLabel}可用`} value={stock.unitStockAvailable} />
                    <StockMetric label={`${packageLabel}可用`} value={stock.packageStockAvailable} />
                    <StockMetric label={`折算${unitLabel}可售`} value={stock.convertibleUnitStock} />
                </div>
            )}
            <div>
                <h3 className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    最近自动拆包记录
                    <FeatureHelpButton topic="catalog.inventory" title="最近自动拆包记录" />
                </h3>
                {!data.productPackagingUnpackEvents.length ? (
                    <p className="mt-2 text-xs text-slate-500">尚未发生自动拆包</p>
                ) : (
                    <div className="mt-2 space-y-2">
                        {data.productPackagingUnpackEvents.map(event => (
                            <div
                                key={event.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-xs"
                            >
                                <span>
                                    <strong>
                                        {event.packagesOpened} {packageLabel}
                                    </strong>{' '}
                                    → {event.unitsCreated} {unitLabel} · {event.stockLocation.name}
                                </span>
                                <span className="text-slate-500">
                                    {event.order ? `订单 ${event.order.code} · ` : ''}
                                    {formatDateTime(event.createdAt)}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}

interface VariantPricesData {
    activeChannel: {
        id: string;
        code: string;
        defaultCurrencyCode: string;
        availableCurrencyCodes: string[];
    };
    product: {
        id: string;
        variants: Array<{
            id: string;
            name: string;
            sku: string;
            currencyCode: string;
            price: number;
            prices: Array<{ currencyCode: string; price: number }>;
        }>;
    } | null;
}

export function ProductVariantPricesBlock({ context }: { context: NextAdminPageBlockContext }) {
    const productId = stringId(context.entity?.id);
    const query = useQuery<VariantPricesData>(PRODUCT_VARIANT_PRICES_QUERY, {
        variables: { productId },
        skip: !productId,
        fetchPolicy: 'cache-and-network',
    });
    const [updatePrices, updateState] = useMutation<{
        updateProductVariants: Array<{ id: string }>;
    }>(UPDATE_PRODUCT_VARIANT_PRICES_MUTATION);
    const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
    const [dirtyIds, setDirtyIds] = useState<string[]>([]);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const data = query.data;
    const currencies = useMemo(
        () =>
            data
                ? [
                      ...new Set([
                          data.activeChannel.defaultCurrencyCode,
                          ...data.activeChannel.availableCurrencyCodes,
                      ]),
                  ]
                : [],
        [data],
    );
    /* oxlint-disable react/set-state-in-effect -- the channel price response initializes currency drafts. */
    useEffect(() => {
        if (!data?.product || dirtyIds.length) return;
        setDrafts(
            Object.fromEntries(
                data.product.variants.map(variant => [
                    variant.id,
                    Object.fromEntries(
                        currencies.map(currency => {
                            const stored = variant.prices.find(price => price.currencyCode === currency);
                            const amount =
                                stored?.price ??
                                (variant.currencyCode === currency ? variant.price : undefined);
                            return [currency, amount == null ? '' : (amount / 100).toFixed(2)];
                        }),
                    ),
                ]),
            ),
        );
    }, [currencies, data, dirtyIds.length]);
    /* oxlint-enable react/set-state-in-effect */
    if (!productId) return null;
    if (query.loading && !data) return <PanelState label="正在读取多币种 SKU 价格…" />;
    if (query.error || !data?.product)
        return (
            <PanelState tone="error" label="多币种 SKU 价格加载失败" action={() => void query.refetch()} />
        );
    const change = (variantId: string, currencyCode: string, value: string) => {
        setDrafts(current => ({
            ...current,
            [variantId]: { ...current[variantId], [currencyCode]: value },
        }));
        setDirtyIds(current => (current.includes(variantId) ? current : [...current, variantId]));
        setNotice('');
        setError('');
    };
    const save = async () => {
        try {
            const input = dirtyIds.map(id => ({
                id,
                prices: currencies.map(currencyCode => ({
                    currencyCode,
                    price: Math.round(number(drafts[id]?.[currencyCode] ?? '', `${currencyCode} 价格`) * 100),
                })),
            }));
            const result = await updatePrices({ variables: { input } });
            if ((result.data?.updateProductVariants.length ?? 0) !== input.length) {
                throw new Error('后端未返回所有已更新 SKU');
            }
            setDirtyIds([]);
            setNotice(`已保存 ${input.length} 个 SKU 的 ${currencies.length} 种币种价格`);
            await query.refetch();
        } catch (cause) {
            setError(toUserFacingError(cause, '多币种价格保存失败'));
        }
    };
    return (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <CircleDollarSign className="h-4 w-4 text-emerald-600" /> SKU 多币种价格
                        <FeatureHelpButton topic="catalog.variant-channels" title="SKU 多币种价格" />
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                        价格保存在当前 Channel「{data.activeChannel.code}」，不会覆盖其他店铺。
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={!dirtyIds.length || updateState.loading}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
                >
                    <Save className="h-4 w-4" />
                    {updateState.loading
                        ? '保存中…'
                        : `保存价格${dirtyIds.length ? ` (${dirtyIds.length})` : ''}`}
                </button>
            </div>
            {notice && <InlineNotice tone="success" message={notice} />}
            {error && <InlineNotice tone="error" message={error} />}
            <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[700px] text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                        <tr>
                            <th className="px-3 py-2.5 font-bold">SKU</th>
                            {currencies.map(currency => (
                                <th key={currency} className="px-3 py-2.5 font-bold">
                                    {currency}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {data.product.variants.map(variant => (
                            <tr key={variant.id}>
                                <td className="px-3 py-3">
                                    <strong>{variant.name}</strong>
                                    <small className="ml-2 font-mono text-slate-500">{variant.sku}</small>
                                </td>
                                {currencies.map(currency => (
                                    <td key={currency} className="px-3 py-3">
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            aria-label={`${variant.sku} ${currency} 价格`}
                                            value={drafts[variant.id]?.[currency] ?? ''}
                                            onChange={event =>
                                                change(variant.id, currency, event.target.value)
                                            }
                                            className="w-32 rounded-lg border border-slate-300 px-3 py-2 font-mono"
                                        />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

interface ProductVariantCustomFieldsData {
    product: {
        id: string;
        variants: Array<{
            id: string;
            name: string;
            sku: string;
            translations: Array<{
                id: string;
                languageCode: string;
                name: string;
                customFields?: Record<string, unknown> | null;
            }>;
            customFields?: Record<string, unknown> | null;
        }>;
    } | null;
}

export function ProductVariantCustomFieldsBlock({ context }: { context: NextAdminPageBlockContext }) {
    const productId = stringId(context.entity?.id);
    const definitions = useCustomFieldDefinitions('ProductVariant');
    const { hasAnyPermission } = useAdminPermissions();
    const visibleDefinitions = useMemo(
        () =>
            definitions.filter(
                field =>
                    isDashboardVisibleCustomField(field) && hasAnyPermission(field.requiresPermission ?? []),
            ),
        [definitions, hasAnyPermission],
    );
    const document = useMemo(
        () =>
            addCustomFieldsToDocument(
                PRODUCT_VARIANT_CUSTOM_FIELDS_QUERY,
                'ProductVariant',
                visibleDefinitions,
            ),
        [visibleDefinitions],
    );
    const query = useQuery<ProductVariantCustomFieldsData>(document, {
        variables: { productId },
        skip: !productId || visibleDefinitions.length === 0,
        fetchPolicy: 'cache-and-network',
    });
    const [selectedId, setSelectedId] = useState('');
    const [sourceSignature, setSourceSignature] = useState('');
    const [values, setValues] = useState<CustomFieldValueMap>({});
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [update, updateState] = useMutation<{
        updateProductVariants: Array<{ id: string }>;
    }>(UPDATE_PRODUCT_VARIANT_CUSTOM_FIELDS_MUTATION);
    const variants = query.data?.product?.variants ?? [];
    const selected = variants.find(variant => variant.id === selectedId) ?? variants[0];
    const nextSignature = selected
        ? `${selected.id}:${JSON.stringify([selected.customFields ?? {}, selected.translations])}`
        : '';

    /* oxlint-disable react/set-state-in-effect -- GraphQL result initializes the selected SKU draft. */
    useEffect(() => {
        if (!selected || nextSignature === sourceSignature) return;
        setSelectedId(selected.id);
        setValues(
            customFieldValuesFromEntity(visibleDefinitions, selected.customFields, selected.translations),
        );
        setSourceSignature(nextSignature);
    }, [nextSignature, selected, sourceSignature, visibleDefinitions]);
    /* oxlint-enable react/set-state-in-effect */

    if (!productId || visibleDefinitions.length === 0) return null;
    if (query.loading && !query.data) return <PanelState label="正在读取 SKU 扩展字段…" />;
    if (query.error || !query.data?.product) {
        return <PanelState tone="error" label="SKU 扩展字段加载失败" action={() => void query.refetch()} />;
    }
    const selectVariant = (id: string) => {
        const variant = variants.find(item => item.id === id);
        if (!variant) return;
        setSelectedId(id);
        setValues(
            customFieldValuesFromEntity(visibleDefinitions, variant.customFields, variant.translations),
        );
        setSourceSignature(
            `${variant.id}:${JSON.stringify([variant.customFields ?? {}, variant.translations])}`,
        );
        setNotice('');
        setError('');
    };
    const save = async () => {
        if (!selected) return;
        const validation = validateCustomFieldValues(visibleDefinitions, values);
        if (Object.keys(validation).length > 0) {
            setError(Object.values(validation)[0] ?? 'SKU 扩展字段校验失败');
            return;
        }
        try {
            const result = await update({
                variables: {
                    input: [
                        {
                            id: selected.id,
                            customFields: customFieldInputFromValues(visibleDefinitions, values),
                            translations: selected.translations.map(translation => ({
                                id: translation.id,
                                languageCode: translation.languageCode,
                                customFields: localizedCustomFieldInputFromValues(
                                    visibleDefinitions,
                                    values,
                                    translation.languageCode,
                                ),
                            })),
                        },
                    ],
                },
            });
            if (result.data?.updateProductVariants[0]?.id !== selected.id) {
                throw new Error('后端未返回更新后的 SKU');
            }
            setNotice(`SKU ${selected.sku} 的扩展字段已保存`);
            setError('');
            setSourceSignature('');
            await query.refetch();
        } catch (cause) {
            setError(toUserFacingError(cause, 'SKU 扩展字段保存失败'));
        }
    };
    return (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        SKU 动态扩展字段
                        <FeatureHelpButton topic="catalog.sku-custom-fields" title="SKU 动态扩展字段" />
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                        字段由后端 ProductVariant 配置生成，并按 SKU 独立保存。
                    </p>
                </div>
                <div className="flex gap-2">
                    <select
                        value={selected?.id ?? ''}
                        onChange={event => selectVariant(event.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                    >
                        {variants.map(variant => (
                            <option key={variant.id} value={variant.id}>
                                {variant.name} · {variant.sku}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={() => void save()}
                        disabled={!selected || updateState.loading}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
                    >
                        <Save className="h-4 w-4" />
                        {updateState.loading ? '保存中…' : '保存字段'}
                    </button>
                </div>
            </div>
            {notice && <InlineNotice tone="success" message={notice} />}
            {error && <InlineNotice tone="error" message={error} />}
            <DynamicCustomFieldsForm
                title={`SKU 扩展字段${selected ? ` · ${selected.sku}` : ''}`}
                helpTopic="catalog.sku-custom-fields"
                fields={visibleDefinitions}
                values={values}
                onChange={setValues}
                disabled={updateState.loading}
            />
        </section>
    );
}

function LotEditor({
    value,
    currencyCode,
    saving,
    onClose,
    onSave,
}: {
    value: LotDraft;
    currencyCode: string;
    saving: boolean;
    onClose: () => void;
    onSave: (value: LotDraft) => Promise<void>;
}) {
    const [draft, setDraft] = useState(value);
    const update = (field: keyof LotDraft, next: string) =>
        setDraft(current => ({ ...current, [field]: next }));
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
            <AccessibleDialogSurface
                accessibleName={draft.id ? '编辑库存批次' : '新增库存批次'}
                onRequestClose={onClose}
                className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl"
            >
                <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold">{draft.id ? '编辑库存批次' : '新增库存批次'}</h2>
                    <button type="button" onClick={onClose} aria-label="关闭">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <TextField
                        label="批次号 *"
                        value={draft.lotCode}
                        onChange={lotCode => update('lotCode', lotCode)}
                    />
                    <TextField
                        label="批次数量 *"
                        type="number"
                        value={draft.quantityOnHand}
                        onChange={quantity => update('quantityOnHand', quantity)}
                    />
                    <TextField
                        label="生产日期"
                        type="date"
                        value={draft.manufacturedAt}
                        onChange={date => update('manufacturedAt', date)}
                    />
                    <TextField
                        label="到期日期"
                        type="date"
                        value={draft.expiresAt}
                        onChange={date => update('expiresAt', date)}
                    />
                    <TextField
                        label={`批次成本 (${currencyCode})`}
                        type="number"
                        value={draft.purchaseCost}
                        onChange={cost => update('purchaseCost', cost)}
                    />
                </div>
                <div className="mt-6 flex justify-end gap-2 border-t pt-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border px-4 py-2 text-xs font-bold"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={() => void onSave(draft)}
                        disabled={saving}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
                    >
                        {saving ? '保存中…' : '保存批次'}
                    </button>
                </div>
            </AccessibleDialogSurface>
        </div>
    );
}

function toDraft(variant: CatalogWorkspaceVariantRecord, stockLocationId: string): VariantDraft {
    const stock = variant.stockLevels.find(level => level.stockLocationId === stockLocationId);
    return {
        id: variant.id,
        enabled: variant.enabled,
        sku: variant.sku,
        barcode: variant.barcode,
        specification: variant.specification,
        saleUnit: variant.saleUnit,
        purchaseUnit: variant.purchaseUnit,
        packageQuantity: String(variant.packageQuantity || 1),
        shelfLifeDays: variant.shelfLifeDays == null ? '' : String(variant.shelfLifeDays),
        sellingPrice: (variant.sellingPrice / 100).toFixed(2),
        purchaseCost:
            variant.purchaseCostMicrounits == null ? '' : (variant.purchaseCostMicrounits / 1_000).toFixed(3),
        stockOnHand: String(stock?.stockOnHand ?? 0),
        minimumStock: stock?.minimumStock == null ? '' : String(stock.minimumStock),
        maximumStock: stock?.maximumStock == null ? '' : String(stock.maximumStock),
        supplierId: variant.supplier?.id ?? '',
    };
}

function operationInput(draft: VariantDraft, stockLocationId: string, currencyCode: string) {
    if (!draft) throw new Error('SKU 草稿不存在，请刷新后重试');
    const minimumStock = optionalInteger(draft.minimumStock, '库存下限');
    const maximumStock = optionalInteger(draft.maximumStock, '库存上限');
    if (minimumStock != null && maximumStock != null && maximumStock < minimumStock)
        throw new Error('库存上限不能小于库存下限');
    const packageQuantity = number(draft.packageQuantity, '包装换算');
    if (packageQuantity <= 0) throw new Error('包装换算必须大于 0');
    const input: Record<string, unknown> = {
        productVariantId: draft.id,
        stockLocationId,
        sku: requiredText(draft.sku, 'SKU'),
        enabled: draft.enabled,
        barcode: draft.barcode.trim(),
        specification: draft.specification.trim(),
        saleUnit: draft.saleUnit.trim(),
        purchaseUnit: draft.purchaseUnit.trim(),
        packageQuantity,
        shelfLifeDays: optionalInteger(draft.shelfLifeDays, '保质期'),
        sellingPrice: Math.round(number(draft.sellingPrice, '销售价') * 100),
        currencyCode,
        stockOnHand: integer(draft.stockOnHand, '库存'),
        minimumStock,
        maximumStock,
        supplierId: draft.supplierId || null,
    };
    if (draft.purchaseCost.trim())
        input.purchaseCostMicrounits = Math.round(number(draft.purchaseCost, '采购成本') * 1_000);
    return input;
}

const emptyLot = (productVariantId: string, stockLocationId: string): LotDraft => ({
    productVariantId,
    stockLocationId,
    lotCode: '',
    manufacturedAt: '',
    expiresAt: '',
    quantityOnHand: '0',
    purchaseCost: '',
});
const stringId = (value: unknown) =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const requiredText = (value: string, label: string) => {
    const clean = value.trim();
    if (!clean) throw new Error(`${label}不能为空`);
    return clean;
};
const number = (value: string, label: string) => {
    const parsed = Number(value);
    if (!value.trim() || !Number.isFinite(parsed) || parsed < 0) throw new Error(`${label}必须是非负数字`);
    return parsed;
};
const integer = (value: string, label: string) => {
    const parsed = number(value, label);
    if (!Number.isInteger(parsed)) throw new Error(`${label}必须是整数`);
    return parsed;
};
const optionalInteger = (value: string, label: string) => (value.trim() ? integer(value, label) : null);
const dateOnly = (value?: string | null) => (value ? new Date(value).toLocaleDateString('zh-CN') : '—');
const inputDate = (value?: string | null) => (value ? new Date(value).toISOString().slice(0, 10) : '');

function TextField({
    label,
    value,
    onChange,
    type = 'text',
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
}) {
    return (
        <label className="text-xs font-bold text-slate-600">
            {label}
            <input
                type={type}
                min={type === 'number' ? 0 : undefined}
                step={type === 'number' ? 'any' : undefined}
                value={value}
                onChange={event => onChange(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
            />
        </label>
    );
}
function SelectField({
    label,
    value,
    onChange,
    options,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<{ id: string; name: string; sku: string }>;
}) {
    return (
        <label className="text-xs font-bold text-slate-600">
            {label}
            <select
                value={value}
                onChange={event => onChange(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
            >
                {options.map(option => (
                    <option key={option.id} value={option.id}>
                        {option.name} · {option.sku}
                    </option>
                ))}
            </select>
        </label>
    );
}
function Toggle({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
            {label}
        </label>
    );
}
function StockMetric({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-lg border border-slate-200 p-3">
            <span className="text-xs text-slate-500">{label}</span>
            <strong className="mt-1 block text-lg text-slate-900">{value}</strong>
        </div>
    );
}
function InlineNotice({ tone, message }: { tone: 'success' | 'error'; message: string }) {
    return (
        <div
            role={tone === 'error' ? 'alert' : 'status'}
            className={`rounded-lg border px-3 py-2 text-xs ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
        >
            {message}
        </div>
    );
}
function PanelState({
    label,
    tone = 'default',
    action,
}: {
    label: string;
    tone?: 'default' | 'error';
    action?: () => void;
}) {
    return (
        <div
            className={`rounded-xl border p-6 text-center text-sm ${tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-500'}`}
            role={tone === 'error' ? 'alert' : 'status'}
        >
            <p>{label}</p>
            {action && (
                <button
                    type="button"
                    onClick={action}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold"
                >
                    <RefreshCw className="h-4 w-4" />
                    重试
                </button>
            )}
        </div>
    );
}
