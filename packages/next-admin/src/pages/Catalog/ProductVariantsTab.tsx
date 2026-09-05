import { Check, FolderTree, Layers, Plus, Search, Trash2 } from 'lucide-react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import type { DigitalDeliveryMode, DigitalStockPolicy } from '../../graphql/commerce.graphql';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { LookupPager } from './LookupPager';
import { ProductAutoCardSetupPanel } from './ProductAutoCardSetupPanel';
import { useProductEditor } from './ProductEditorContext';
import { LOOKUP_PAGE_SIZE } from './product-editor-types';

export function ProductVariantsTab() {
    const {
        activeCurrencyCode,
        commerceMode,
        effectiveFulfillmentType,
        variants,
        handleVariantFieldChange,
        handleAddVariant,
        handleGenerateVariantMatrix,
        handleDeleteVariant,
        selectedOptionGroupIds,
        setSelectedOptionGroupIds,
        knownOptionGroups,
        setKnownOptionGroups,
        optionGroupSearch,
        setOptionGroupSearch,
        optionGroupPage,
        setOptionGroupPage,
        optionGroupsData,
        optionGroupsError,
        refetchOptionGroups,
        catalogChannelsData,
        selectedChannelIds,
        setSelectedChannelIds,
        formErrors,
        handleSave,
        saving,
        isDirty,
        refetchProduct,
        isCreateMode,
        productData,
    } = useProductEditor();

    if (!isCreateMode && !productData?.product) return null;

    return (
        <div className="space-y-6">
            <section className="rounded-xl border border-blue-200 bg-blue-50/60 p-5 shadow-2xs">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            <FolderTree className="h-4 w-4 text-blue-600" />
                            销售店铺与独立定价
                            <FeatureHelpButton topic="catalog.variant-channels" title="销售店铺与独立定价" />
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                            当前正在编辑{' '}
                            <strong className="text-blue-700">
                                {catalogChannelsData
                                    ? getChannelDisplayName(catalogChannelsData.activeChannel.code)
                                    : '当前店铺'}
                            </strong>{' '}
                            的 {activeCurrencyCode}{' '}
                            销售价。勾选其他店铺后，使用顶部“当前店铺”切换并分别维护销售价。
                        </p>
                    </div>
                    <span className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-blue-700 shadow-2xs">
                        已发布 {selectedChannelIds.length} 个店铺
                    </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                    {catalogChannelsData?.channels.items.map(channel => {
                        const isActiveChannel = channel.id === catalogChannelsData.activeChannel.id;
                        const isSelected = selectedChannelIds.includes(channel.id) || isActiveChannel;
                        return (
                            <label
                                key={channel.id}
                                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${isSelected ? 'border-blue-300 bg-white font-bold text-blue-800' : 'border-slate-200 bg-white/70 text-slate-600'}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    disabled={isActiveChannel}
                                    onChange={() =>
                                        setSelectedChannelIds(ids =>
                                            isSelected
                                                ? ids.filter(id => id !== channel.id)
                                                : [...ids, channel.id],
                                        )
                                    }
                                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                                />
                                <span>{getChannelDisplayName(channel.code)}</span>
                                <span className="font-mono text-[10px] text-slate-400">
                                    {channel.defaultCurrencyCode}
                                </span>
                                {isActiveChannel && (
                                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] text-blue-700">
                                        当前
                                    </span>
                                )}
                            </label>
                        );
                    })}
                </div>
                <p className="mt-3 text-[10px] leading-4 text-slate-400">
                    新增店铺初始价格按当前销售价 1:1
                    复制；切换店铺后可修改为该店铺自己的价格。当前店铺不能在本页取消发布，避免编辑中的商品立即消失。
                </p>
            </section>

            <div className="bg-white rounded-xl shadow-2xs border border-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div>
                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            {effectiveFulfillmentType === 'digital'
                                ? '销售、SKU 与自动发货'
                                : 'SKU 规格变体与在手库存'}
                            <FeatureHelpButton topic="catalog.variants" title="SKU 规格变体与交付" />
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                            {effectiveFulfillmentType === 'digital'
                                ? '在同一页完成销售价、交付方式、卡密格式和库存导入'
                                : '为商品配置不同规格型号、条形码 SKU、销售价与初始库存'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleAddVariant}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                    >
                        <Plus className="w-3.5 h-3.5" /> 添加 SKU 变体
                    </button>
                </div>

                <div className="border-b border-slate-100 p-5 space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-xs font-bold text-slate-800">套用规格模板</div>
                            <div className="mt-0.5 text-[11px] text-slate-400">
                                选择颜色、容量等模板后，一键生成真实 Option 组合 SKU
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleGenerateVariantMatrix}
                            disabled={selectedOptionGroupIds.length === 0}
                            className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            生成 SKU 矩阵
                        </button>
                    </div>
                    <div className="relative max-w-md">
                        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                        <input
                            aria-label="搜索规格模板"
                            value={optionGroupSearch}
                            onChange={event => {
                                setOptionGroupSearch(event.target.value);
                                setOptionGroupPage(0);
                            }}
                            placeholder="搜索规格模板名称"
                            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-blue-500"
                        />
                    </div>
                    {optionGroupsError ? (
                        <div className="rounded-lg bg-rose-50 p-3 text-[11px] text-rose-700">
                            {toUserFacingError(optionGroupsError, '规格模板读取失败，请稍后重试')}
                        </div>
                    ) : (optionGroupsData?.productOptionGroups.items.length ?? 0) === 0 ? (
                        <div className="rounded-lg bg-slate-50 p-3 text-[11px] text-slate-500">
                            尚未创建规格模板，请先到【商品管理 → 分类与属性】配置。
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {optionGroupsData?.productOptionGroups.items.map(group => {
                                const isSelected = selectedOptionGroupIds.includes(group.id);
                                return (
                                    <button
                                        key={group.id}
                                        type="button"
                                        onClick={() => {
                                            setKnownOptionGroups(current => ({
                                                ...current,
                                                [group.id]: group,
                                            }));
                                            setSelectedOptionGroupIds(ids =>
                                                isSelected
                                                    ? ids.filter(id => id !== group.id)
                                                    : [...ids, group.id],
                                            );
                                        }}
                                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${isSelected ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'}`}
                                    >
                                        <div className="flex items-center gap-1.5 text-xs font-bold">
                                            {isSelected && <Check className="h-3 w-3" />}
                                            {group.name}
                                        </div>
                                        <div className="mt-0.5 font-mono text-[10px] opacity-70">
                                            {group.options.length} 个选项
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    <LookupPager
                        page={optionGroupPage}
                        pageSize={LOOKUP_PAGE_SIZE}
                        totalItems={optionGroupsData?.productOptionGroups.totalItems ?? 0}
                        onPageChange={setOptionGroupPage}
                    />
                    <p className="text-[10px] leading-4 text-slate-400">
                        取消已被现有 SKU 使用的模板时，Vendure 会拒绝移除并保留原关联，避免误删规格数据。
                    </p>
                </div>

                {variants.length === 0 ? (
                    <div className="p-12 text-center text-slate-400 space-y-3">
                        <Layers className="w-8 h-8 mx-auto text-slate-300" />
                        <div className="text-xs font-bold text-slate-600">
                            当前商品未配置任何 SKU 规格变体
                        </div>
                        <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                            若商品为单品或存在多规格选项，请点击上方 “添加 SKU 变体” 按钮进行配置。
                        </p>
                    </div>
                ) : (
                    <div className="mobile-scrollbar-hidden overflow-x-auto">
                        <table className="w-full min-w-[1180px] border-collapse text-left text-xs">
                            <thead>
                                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold whitespace-nowrap">
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        规格名称
                                    </th>
                                    <th scope="col" className="min-w-[150px] whitespace-nowrap px-3 py-3">
                                        SKU 编码 <span className="text-rose-500">*</span>
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        销售价 ({activeCurrencyCode}) <span className="text-rose-500">*</span>
                                    </th>
                                    {effectiveFulfillmentType === 'digital' ? (
                                        <>
                                            <th
                                                scope="col"
                                                className="min-w-[150px] whitespace-nowrap px-3 py-3"
                                            >
                                                数字交付方式
                                            </th>
                                            <th
                                                scope="col"
                                                className="min-w-[130px] whitespace-nowrap px-3 py-3"
                                            >
                                                库存规则
                                            </th>
                                            <th scope="col" className="whitespace-nowrap px-3 py-3">
                                                可售库存
                                            </th>
                                        </>
                                    ) : (
                                        <>
                                            <th scope="col" className="whitespace-nowrap px-3 py-3">
                                                在手库存 (OnHand)
                                            </th>
                                            <th scope="col" className="whitespace-nowrap px-3 py-3">
                                                锁定库存
                                            </th>
                                        </>
                                    )}
                                    <th scope="col" className="whitespace-nowrap px-3 py-3 text-center">
                                        启用状态
                                    </th>
                                    <th scope="col" className="w-16 whitespace-nowrap px-3 py-3 text-right">
                                        操作
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-700">
                                {variants.map((variant, index) => {
                                    const rowError = formErrors.variants?.[index];

                                    return (
                                        <tr
                                            key={variant.id || index}
                                            className="h-[52px] hover:bg-slate-50/80"
                                        >
                                            {/* Variant Name */}
                                            <td className="h-[52px] px-3 py-2">
                                                <input
                                                    type="text"
                                                    aria-label={`第 ${index + 1} 行规格名称`}
                                                    value={variant.name}
                                                    onChange={e =>
                                                        handleVariantFieldChange(
                                                            index,
                                                            'name',
                                                            e.target.value,
                                                        )
                                                    }
                                                    placeholder="规格名 (如: 红色 / XL)"
                                                    className="w-full border border-slate-300 rounded px-2 py-1 font-bold text-slate-900 bg-white"
                                                />
                                            </td>

                                            {/* SKU */}
                                            <td className="h-[52px] px-3 py-2">
                                                <input
                                                    type="text"
                                                    aria-label={`第 ${index + 1} 行 SKU 编码`}
                                                    value={variant.sku}
                                                    onChange={e =>
                                                        handleVariantFieldChange(index, 'sku', e.target.value)
                                                    }
                                                    placeholder="必须唯一编码"
                                                    className={`w-full font-mono border rounded px-2 py-1 bg-white ${rowError?.sku ? 'border-rose-500 text-rose-600' : 'border-slate-300 text-slate-700'}`}
                                                />
                                                {rowError?.sku && (
                                                    <div className="text-[10px] text-rose-500 mt-0.5">
                                                        {rowError.sku}
                                                    </div>
                                                )}
                                            </td>

                                            {/* Price */}
                                            <td className="h-[52px] px-3 py-2">
                                                <div className="flex items-center gap-1">
                                                    <span className="text-slate-400 font-mono">
                                                        {activeCurrencyCode}
                                                    </span>
                                                    <input
                                                        type="number"
                                                        aria-label={`第 ${index + 1} 行销售价`}
                                                        step="0.01"
                                                        min="0"
                                                        value={variant.price}
                                                        onChange={e =>
                                                            handleVariantFieldChange(
                                                                index,
                                                                'price',
                                                                e.target.value,
                                                            )
                                                        }
                                                        placeholder="0.00"
                                                        className={`w-24 font-mono font-bold border rounded px-2 py-1 bg-white ${rowError?.price ? 'border-rose-500 text-rose-600' : 'border-slate-300 text-slate-900'}`}
                                                    />
                                                </div>
                                                {rowError?.price && (
                                                    <div className="text-[10px] text-rose-500 mt-0.5">
                                                        {rowError.price}
                                                    </div>
                                                )}
                                            </td>

                                            {effectiveFulfillmentType === 'digital' ? (
                                                <>
                                                    <td className="h-[52px] px-3 py-2">
                                                        <select
                                                            aria-label={`第 ${index + 1} 行数字交付方式`}
                                                            value={variant.digitalDeliveryMode}
                                                            onChange={event =>
                                                                handleVariantFieldChange(
                                                                    index,
                                                                    'digitalDeliveryMode',
                                                                    event.target.value as DigitalDeliveryMode,
                                                                )
                                                            }
                                                            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                                                        >
                                                            <option value="manual_service">人工交付</option>
                                                            <option value="file_download">文件下载</option>
                                                            <option value="auto_card">号池自动发卡</option>
                                                        </select>
                                                    </td>
                                                    <td className="h-[52px] px-3 py-2">
                                                        {variant.digitalDeliveryMode === 'file_download' ? (
                                                            <select
                                                                aria-label={`第 ${index + 1} 行数字库存规则`}
                                                                value={variant.digitalStockPolicy}
                                                                onChange={event =>
                                                                    handleVariantFieldChange(
                                                                        index,
                                                                        'digitalStockPolicy',
                                                                        event.target
                                                                            .value as DigitalStockPolicy,
                                                                    )
                                                                }
                                                                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                                                            >
                                                                <option value="limited">限制库存</option>
                                                                <option value="unlimited">无限库存</option>
                                                            </select>
                                                        ) : (
                                                            <span className="rounded bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">
                                                                {variant.digitalDeliveryMode === 'auto_card'
                                                                    ? '号池实时库存'
                                                                    : '手动限制库存'}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="h-[52px] px-3 py-2">
                                                        {variant.digitalDeliveryMode === 'auto_card' ? (
                                                            <div className="flex items-center gap-1 whitespace-nowrap">
                                                                <div className="font-mono font-bold text-violet-700">
                                                                    {variant.autoCardAvailableStock ?? 0}
                                                                </div>
                                                                <span className="text-[10px] text-slate-400">
                                                                    只读，来自号池
                                                                </span>
                                                            </div>
                                                        ) : variant.digitalStockPolicy === 'unlimited' ? (
                                                            <span className="font-bold text-emerald-700">
                                                                无限
                                                            </span>
                                                        ) : (
                                                            <input
                                                                type="number"
                                                                aria-label={`第 ${index + 1} 行可售库存`}
                                                                min="0"
                                                                value={variant.stockOnHand}
                                                                onChange={event =>
                                                                    handleVariantFieldChange(
                                                                        index,
                                                                        'stockOnHand',
                                                                        event.target.value === ''
                                                                            ? ''
                                                                            : parseInt(event.target.value) ||
                                                                                  0,
                                                                    )
                                                                }
                                                                placeholder="0"
                                                                className="w-20 rounded border border-slate-300 bg-white px-2 py-1 font-mono font-bold text-slate-800"
                                                            />
                                                        )}
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                    {/* Stock on Hand */}
                                                    <td className="h-[52px] px-3 py-2">
                                                        <input
                                                            type="number"
                                                            aria-label={`第 ${index + 1} 行在手库存`}
                                                            min="0"
                                                            value={variant.stockOnHand}
                                                            onChange={event =>
                                                                handleVariantFieldChange(
                                                                    index,
                                                                    'stockOnHand',
                                                                    event.target.value === ''
                                                                        ? ''
                                                                        : parseInt(event.target.value) || 0,
                                                                )
                                                            }
                                                            placeholder="0"
                                                            className="w-20 rounded border border-slate-300 bg-white px-2 py-1 font-mono font-bold text-slate-800"
                                                        />
                                                    </td>

                                                    {/* Allocated Stock */}
                                                    <td className="h-[52px] px-3 py-2 font-mono text-slate-400">
                                                        {variant.stockAllocated || 0}
                                                    </td>
                                                </>
                                            )}

                                            {/* Enabled */}
                                            <td className="h-[52px] px-3 py-2 text-center">
                                                <input
                                                    type="checkbox"
                                                    aria-label={`第 ${index + 1} 行 SKU 启用状态`}
                                                    checked={variant.enabled}
                                                    onChange={e =>
                                                        handleVariantFieldChange(
                                                            index,
                                                            'enabled',
                                                            e.target.checked,
                                                        )
                                                    }
                                                    className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                                                />
                                            </td>

                                            {/* Actions */}
                                            <td className="h-[52px] px-3 py-2 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteVariant(index)}
                                                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                                                    title="删除该规格"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {effectiveFulfillmentType === 'digital' && (
                <ProductAutoCardSetupPanel
                    variants={variants}
                    productIsDirty={isDirty}
                    productSaving={saving}
                    onSaveProduct={handleSave}
                    onRefreshProduct={refetchProduct}
                />
            )}
        </div>
    );
}
