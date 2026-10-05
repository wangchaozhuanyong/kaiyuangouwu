import { print } from 'graphql';
import { useState } from 'react';
import { client, uploadAdminFile } from '../../apollo';
import { AdminButton, AdminInput, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import type { DigitalDeliveryMode } from '../../graphql/commerce.graphql';
import {
    DIGITAL_MIGRATION_PREVIEW,
    MIGRATE_DIGITAL_INVENTORY,
    UPLOAD_DIGITAL_FILE,
} from '../../graphql/product-domains.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import { ProductAutoCardSetupPanel } from './ProductAutoCardSetupPanel';
import { useProductEditor } from './ProductEditorContext';

const modes: Array<[DigitalDeliveryMode, string]> = [
    ['manual_service', '人工交付'],
    ['auto_card', '自动发卡'],
    ['file_download', '文件下载'],
];
const fieldClass = 'w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs';
interface MigrationPreview {
    availableQuantity: number;
    reservedQuantity: number;
    conflicts: string[];
    alreadyMigrated: boolean;
}

export function DigitalProductWorkspace() {
    const {
        variants,
        setVariants,
        handleVariantFieldChange,
        saving,
        refetchWorkspace,
        handleSave,
        isDirty,
        refetchProduct,
    } = useProductEditor();
    const [perVariantEnabled, setPerVariant] = useState(false);
    const mixedModes = new Set(variants.map(variant => variant.digitalDeliveryMode)).size > 1;
    const perVariant = mixedModes || perVariantEnabled;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [preview, setPreview] = useState<{ id: string; result: MigrationPreview } | null>(null);
    const upload = async (file: File, index: number | null) => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const result = await uploadAdminFile<{
                uploadDigitalDeliveryFile: { id: string; fileName: string };
            }>(print(UPLOAD_DIGITAL_FILE), file, { file: null });
            setVariants(current =>
                current.map((variant, i) =>
                    index === null || i === index
                        ? {
                              ...variant,
                              digitalFileVersionId: result.uploadDigitalDeliveryFile.id,
                              digitalFileName: result.uploadDigitalDeliveryFile.fileName,
                          }
                        : variant,
                ),
            );
            setNotice('私有文件已上传，保存商品后用于新的订单');
        } catch (failure) {
            setError(toUserFacingError(failure, '交付文件上传失败'));
        } finally {
            setBusy(false);
        }
    };
    const reviewMigration = async (id: string) => {
        setBusy(true);
        setError('');
        try {
            const result = await client.query<{ digitalInventoryMigrationPreview: MigrationPreview }>({
                query: DIGITAL_MIGRATION_PREVIEW,
                variables: { productVariantId: id },
                fetchPolicy: 'network-only',
            });
            if (!result.data) throw new Error('未收到迁移预览');
            setPreview({ id, result: result.data.digitalInventoryMigrationPreview });
        } catch (failure) {
            setError(toUserFacingError(failure, '库存核对失败'));
        } finally {
            setBusy(false);
        }
    };
    const migrate = async () => {
        if (!preview || preview.result.conflicts.length) return;
        setBusy(true);
        setError('');
        try {
            await client.mutate({
                mutation: MIGRATE_DIGITAL_INVENTORY,
                variables: {
                    productVariantId: preview.id,
                    expectedAvailable: preview.result.availableQuantity,
                    expectedReserved: preview.result.reservedQuantity,
                },
            });
            setPreview(null);
            await refetchWorkspace();
            setNotice('迁移成功，旧库存记录已保留；后续数字交易使用独立份数');
        } catch (failure) {
            setError(toUserFacingError(failure, '迁移失败，请重新核对'));
        } finally {
            setBusy(false);
        }
    };
    const commonMode = variants[0]?.digitalDeliveryMode ?? 'manual_service';
    return (
        <div className="space-y-4" data-product-domain="digital">
            <div className="grid items-start gap-4 md:grid-cols-2">
                <AdminField
                    className="space-y-1.5 text-xs font-semibold text-slate-700"
                    label={
                        <>
                            <span className="flex min-h-6 items-center gap-2">
                                交付方式
                                <FeatureHelpButton topic="catalog.auto-card" title="数字交付方式" />
                            </span>
                        </>
                    }
                >
                    {' '}
                    <AdminSelect
                        aria-label="统一交付方式"
                        value={mixedModes ? '' : commonMode}
                        disabled={saving || busy || variants.some(v => v.digitalMigrationRequired)}
                        onChange={event =>
                            setVariants(current =>
                                current.map(variant => ({
                                    ...variant,
                                    digitalDeliveryMode: event.target.value as DigitalDeliveryMode,
                                    digitalStockPolicy:
                                        event.target.value === 'auto_card'
                                            ? 'pool_derived'
                                            : variant.digitalStockPolicy === 'limited'
                                              ? 'limited'
                                              : 'unlimited',
                                })),
                            )
                        }
                        className={fieldClass}
                    >
                        {mixedModes && (
                            <option value="" disabled>
                                已按规格设置
                            </option>
                        )}
                        {modes.map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </AdminSelect>
                </AdminField>
                {variants.length > 1 && (
                    <label className="flex min-h-6 items-center gap-2 pt-1 text-xs font-semibold text-slate-700">
                        <AdminInput
                            type="checkbox"
                            checked={perVariant}
                            disabled={mixedModes}
                            onChange={event => setPerVariant(event.target.checked)}
                        />
                        按规格设置
                    </label>
                )}
            </div>
            {commonMode === 'file_download' && !perVariant && (
                <AdminField
                    className="block space-y-2 text-xs font-semibold text-slate-700"
                    label={<>统一交付文件</>}
                >
                    {' '}
                    <AdminInput
                        aria-label="上传统一交付文件"
                        type="file"
                        accept=".zip,.pdf,.txt,.md"
                        disabled={saving || busy}
                        onChange={event => {
                            const file = event.target.files?.[0];
                            if (file) void upload(file, null);
                            event.target.value = '';
                        }}
                        className="block w-full text-xs"
                    />
                </AdminField>
            )}
            {variants.map((variant, index) => (
                <div key={variant.id ?? index} className="space-y-3 border-t border-slate-100 pt-3">
                    <strong className="block text-xs font-semibold text-slate-800">
                        {variant.name || '默认规格'}
                        {variant.sku ? ` · ${variant.sku}` : ''}
                    </strong>
                    {variant.digitalMigrationRequired ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-amber-800">
                            <span>该规格仍使用旧数字库存，需要先核对迁移。</span>
                            <AdminButton
                                type="button"
                                disabled={busy || isDirty}
                                onClick={() => variant.id && void reviewMigration(variant.id)}
                                className="font-semibold text-blue-700 disabled:opacity-50"
                            >
                                核对旧库存
                            </AdminButton>
                        </div>
                    ) : (
                        <>
                            <div className="grid items-start gap-4 md:grid-cols-2">
                                {perVariant && (
                                    <AdminField
                                        className="space-y-1.5 text-xs font-semibold text-slate-700"
                                        label={<>交付方式</>}
                                    >
                                        {' '}
                                        <AdminSelect
                                            aria-label={`规格 ${index + 1} 交付方式`}
                                            value={variant.digitalDeliveryMode}
                                            disabled={saving}
                                            onChange={event =>
                                                setVariants(current =>
                                                    current.map((item, i) =>
                                                        i === index
                                                            ? {
                                                                  ...item,
                                                                  digitalDeliveryMode: event.target
                                                                      .value as DigitalDeliveryMode,
                                                                  digitalStockPolicy:
                                                                      event.target.value === 'auto_card'
                                                                          ? 'pool_derived'
                                                                          : item.digitalStockPolicy ===
                                                                              'limited'
                                                                            ? 'limited'
                                                                            : 'unlimited',
                                                              }
                                                            : item,
                                                    ),
                                                )
                                            }
                                            className={fieldClass}
                                        >
                                            {modes.map(([value, label]) => (
                                                <option key={value} value={value}>
                                                    {label}
                                                </option>
                                            ))}
                                        </AdminSelect>
                                    </AdminField>
                                )}
                                {variant.digitalDeliveryMode !== 'auto_card' && (
                                    <AdminField
                                        className="space-y-1.5 text-xs font-semibold text-slate-700"
                                        label={<>销售数量</>}
                                    >
                                        {' '}
                                        <AdminSelect
                                            aria-label={`规格 ${index + 1} 销售数量`}
                                            value={variant.digitalStockPolicy}
                                            disabled={saving}
                                            onChange={event =>
                                                handleVariantFieldChange(
                                                    index,
                                                    'digitalStockPolicy',
                                                    event.target.value === 'limited'
                                                        ? 'limited'
                                                        : 'unlimited',
                                                )
                                            }
                                            className={fieldClass}
                                        >
                                            <option value="unlimited">不限量</option>
                                            <option value="limited">限量销售</option>
                                        </AdminSelect>
                                    </AdminField>
                                )}
                                {variant.digitalStockPolicy === 'limited' && (
                                    <AdminField
                                        className="space-y-1.5 text-xs font-semibold text-slate-700"
                                        label={<>剩余可售份数</>}
                                    >
                                        {' '}
                                        <AdminInput
                                            aria-label={`规格 ${index + 1} 可售份数`}
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={variant.digitalAvailableQuantity ?? 0}
                                            disabled={saving}
                                            onChange={event =>
                                                handleVariantFieldChange(
                                                    index,
                                                    'digitalAvailableQuantity',
                                                    Number(event.target.value),
                                                )
                                            }
                                            className={fieldClass}
                                        />
                                    </AdminField>
                                )}
                                {variant.digitalDeliveryMode === 'file_download' && (
                                    <div className="space-y-2 text-xs text-slate-600">
                                        <span>{variant.digitalFileName ?? '尚未配置交付文件'}</span>
                                        {perVariant && (
                                            <AdminInput
                                                aria-label={`规格 ${index + 1} 交付文件`}
                                                type="file"
                                                accept=".zip,.pdf,.txt,.md"
                                                disabled={saving || busy}
                                                onChange={event => {
                                                    const file = event.target.files?.[0];
                                                    if (file) void upload(file, index);
                                                    event.target.value = '';
                                                }}
                                                className="block w-full text-xs"
                                            />
                                        )}
                                    </div>
                                )}
                            </div>
                            {variant.digitalDeliveryMode === 'auto_card' && (
                                <ProductAutoCardSetupPanel
                                    variants={[variant]}
                                    productSaving={saving}
                                    productIsDirty={isDirty}
                                    onSaveProduct={handleSave}
                                    onRefreshProduct={refetchProduct}
                                />
                            )}
                        </>
                    )}
                </div>
            ))}
            {preview && (
                <div
                    className="space-y-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"
                    role="region"
                    aria-label="数字库存迁移核对"
                >
                    <p>
                        旧库存可售 {preview.result.availableQuantity} 份，未完成订单占用{' '}
                        {preview.result.reservedQuantity} 份。
                    </p>
                    {preview.result.conflicts.map(conflict => (
                        <p key={conflict} role="alert">
                            {conflict}
                        </p>
                    ))}
                    <AdminButton
                        type="button"
                        disabled={busy || preview.result.conflicts.length > 0}
                        onClick={() => void migrate()}
                        className="font-semibold text-blue-700 disabled:opacity-50"
                    >
                        确认核对并切换
                    </AdminButton>
                    <AdminButton type="button" onClick={() => setPreview(null)} className="ml-4">
                        取消
                    </AdminButton>
                </div>
            )}
            {error && (
                <p role="alert" className="text-xs text-rose-600">
                    {error}
                </p>
            )}
            {notice && (
                <p role="status" className="text-xs text-emerald-700">
                    {notice}
                </p>
            )}
        </div>
    );
}
