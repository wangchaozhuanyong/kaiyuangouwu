import { useMutation } from '@apollo/client/react';
import { print } from 'graphql';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { getAdminQueryScope, uploadAdminFile } from '../../apollo';
import { AdminButton, AdminInput, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import type { DigitalDeliveryMode } from '../../graphql/commerce.graphql';
import {
    DIGITAL_MIGRATION_PREVIEW,
    MIGRATE_DIGITAL_INVENTORY,
    UPLOAD_DIGITAL_FILE,
    type DigitalInventoryLegacyStockLevel,
    type DigitalInventoryOwnershipConfirmation,
} from '../../graphql/product-domains.graphql';
import { useAdminLazyQuery } from '../../hooks/use-admin-query';
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
    confirmableStockLevels: DigitalInventoryLegacyStockLevel[];
}

interface MigrationPreviewRequest {
    identity: string;
    variables: { productVariantId: string; ownershipConfirmation?: DigitalInventoryOwnershipConfirmation };
    resolve: (preview: MigrationPreview) => void;
    reject: (failure: unknown) => void;
}

function MigrationPreviewReader({ request }: { request: MigrationPreviewRequest }) {
    const [readPreview] = useAdminLazyQuery<{ digitalInventoryMigrationPreview: MigrationPreview }>(
        DIGITAL_MIGRATION_PREVIEW,
        { fetchPolicy: 'network-only' },
    );
    useEffect(() => {
        let active = true;
        void readPreview({ variables: request.variables })
            .then(result => {
                if (!active) return;
                if (result.error) request.reject(result.error);
                else if (!result.data) request.reject(new Error('未收到迁移预览'));
                else request.resolve(result.data.digitalInventoryMigrationPreview);
            })
            .catch(failure => {
                if (active) request.reject(failure);
            });
        return () => {
            active = false;
        };
    }, [readPreview, request]);
    return null;
}

export function DigitalProductWorkspace() {
    const fieldId = useId();
    const {
        productId,
        variants,
        setVariants,
        handleVariantFieldChange,
        formErrors,
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
    const scope = getAdminQueryScope();
    const identity = `${scope}:${productId ?? 'new'}`;
    const identityRef = useRef(identity);
    const [reviewIdentity, setReviewIdentity] = useState(identity);
    const reviewSequence = useRef(0);
    const writeInFlight = useRef(false);
    const [preview, setPreview] = useState<{
        id: string;
        identity: string;
        result: MigrationPreview;
        ownershipRows: DigitalInventoryLegacyStockLevel[];
        confirmation?: DigitalInventoryOwnershipConfirmation;
    } | null>(null);
    const [ownershipChecked, setOwnershipChecked] = useState(false);
    const [ownershipReason, setOwnershipReason] = useState('');
    const [readbackFailed, setReadbackFailed] = useState(false);
    const [previewRequest, setPreviewRequest] = useState<MigrationPreviewRequest | null>(null);
    const previewRequestRef = useRef<MigrationPreviewRequest | null>(null);
    const [applyMigration, migrationState] = useMutation<{
        migrateDigitalInventory: { id: string; availableQuantity: number };
    }>(MIGRATE_DIGITAL_INVENTORY);
    const activePreview = preview?.identity === identity ? preview : null;
    const pending = busy || migrationState.loading;
    if (reviewIdentity !== identity) {
        setReviewIdentity(identity);
        setPreviewRequest(null);
        setPreview(null);
        setOwnershipChecked(false);
        setOwnershipReason('');
        setReadbackFailed(false);
        setError('');
        setNotice('');
        setBusy(false);
    }
    useLayoutEffect(() => {
        identityRef.current = identity;
        reviewSequence.current += 1;
        previewRequestRef.current?.reject(new Error('库存核对已结束'));
        previewRequestRef.current = null;
        return () => {
            reviewSequence.current += 1;
            previewRequestRef.current?.reject(new Error('库存核对已结束'));
            previewRequestRef.current = null;
        };
    }, [identity]);
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
    const reviewMigration = async (id: string, confirmation?: DigitalInventoryOwnershipConfirmation) => {
        if (getAdminQueryScope() !== scope) return;
        const request = ++reviewSequence.current;
        previewRequestRef.current?.reject(new Error('库存核对已结束'));
        const requestedIdentity = identityRef.current;
        if (!confirmation) {
            setPreview(null);
            setOwnershipChecked(false);
            setOwnershipReason('');
        } else {
            setPreview(current => (current ? { ...current, confirmation: undefined } : null));
        }
        setBusy(true);
        setError('');
        try {
            const next = await new Promise<MigrationPreview>((resolve, reject) => {
                const readRequest = {
                    identity: requestedIdentity,
                    variables: { productVariantId: id, ownershipConfirmation: confirmation },
                    resolve,
                    reject,
                };
                previewRequestRef.current = readRequest;
                setPreviewRequest(readRequest);
            });
            if (
                request !== reviewSequence.current ||
                requestedIdentity !== identityRef.current ||
                getAdminQueryScope() !== scope
            )
                return;
            setPreview({
                id,
                identity: requestedIdentity,
                result: next,
                ownershipRows:
                    confirmation?.stockLevels ??
                    next.confirmableStockLevels.map(row => ({
                        id: row.id,
                        stockLocationId: row.stockLocationId,
                        stockOnHand: row.stockOnHand,
                        stockAllocated: row.stockAllocated,
                    })),
                confirmation: next.conflicts.length ? undefined : confirmation,
            });
        } catch (failure) {
            if (request === reviewSequence.current && requestedIdentity === identityRef.current)
                setError(toUserFacingError(failure, '库存核对失败'));
        } finally {
            if (request === reviewSequence.current && requestedIdentity === identityRef.current) {
                previewRequestRef.current = null;
                setPreviewRequest(null);
                setBusy(false);
            }
        }
    };
    const migrate = async () => {
        if (
            !activePreview ||
            getAdminQueryScope() !== scope ||
            pending ||
            saving ||
            isDirty ||
            writeInFlight.current ||
            activePreview.result.conflicts.length ||
            activePreview.result.alreadyMigrated ||
            (activePreview.ownershipRows.length && !activePreview.confirmation)
        )
            return;
        const requestedIdentity = identityRef.current;
        writeInFlight.current = true;
        setPreviewRequest(null);
        setBusy(true);
        setError('');
        try {
            const result = await applyMigration({
                variables: {
                    productVariantId: activePreview.id,
                    expectedAvailable: activePreview.result.availableQuantity,
                    expectedReserved: activePreview.result.reservedQuantity,
                    ownershipConfirmation: activePreview.confirmation,
                },
            });
            if (!result.data?.migrateDigitalInventory) throw new Error('未收到迁移结果');
            if (requestedIdentity !== identityRef.current) return;
            setPreview(null);
            setNotice('迁移成功，旧库存记录已保留；后续数字交易使用独立份数');
            try {
                await refetchWorkspace();
            } catch {
                if (requestedIdentity === identityRef.current) {
                    setReadbackFailed(true);
                    setError('迁移已成功，但最新库存读取失败。请重新读取，不要重复迁移。');
                }
            }
        } catch (failure) {
            if (requestedIdentity === identityRef.current) {
                setPreview(null);
                setError(toUserFacingError(failure, '迁移结果尚未确认，请重新读取库存后再核对'));
                setReadbackFailed(true);
            }
        } finally {
            writeInFlight.current = false;
            if (requestedIdentity === identityRef.current) setBusy(false);
        }
    };
    const refreshAfterMigration = async () => {
        setBusy(true);
        setError('');
        const requestedIdentity = identityRef.current;
        try {
            await refetchWorkspace();
            if (requestedIdentity === identityRef.current) setReadbackFailed(false);
        } catch (failure) {
            if (requestedIdentity === identityRef.current)
                setError(toUserFacingError(failure, '最新库存读取失败，请重试读取'));
        } finally {
            if (requestedIdentity === identityRef.current) setBusy(false);
        }
    };
    const commonMode = variants[0]?.digitalDeliveryMode ?? 'manual_service';
    return (
        <div className="space-y-4" data-product-domain="digital">
            {previewRequest?.identity === identity && <MigrationPreviewReader request={previewRequest} />}
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
                                disabled={pending || saving || isDirty || readbackFailed}
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
                                            aria-invalid={Boolean(formErrors.variants?.[index]?.stock)}
                                            aria-describedby={
                                                formErrors.variants?.[index]?.stock
                                                    ? `${fieldId}-${index}-stock-error`
                                                    : undefined
                                            }
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
                                        {formErrors.variants?.[index]?.stock && (
                                            <span
                                                id={`${fieldId}-${index}-stock-error`}
                                                role="alert"
                                                className="block text-rose-600"
                                            >
                                                {formErrors.variants[index].stock}
                                            </span>
                                        )}
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
            {activePreview && (
                <div
                    className="space-y-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"
                    role="region"
                    aria-label="数字库存迁移核对"
                >
                    <p>
                        旧库存可售 {activePreview.result.availableQuantity} 份，未完成订单占用{' '}
                        {activePreview.result.reservedQuantity} 份。
                    </p>
                    {activePreview.ownershipRows.length > 0 && (
                        <div className="space-y-2">
                            <p>
                                以下历史记录尚未登记经营店铺。仅在确认全部属于当前店铺时继续；原仓库和记录将保留。
                            </p>
                            <ul className="space-y-1">
                                {activePreview.ownershipRows.map(row => (
                                    <li key={row.id}>
                                        记录 {row.id} · 仓库 {row.stockLocationId} · 在库 {row.stockOnHand} ·
                                        占用 {row.stockAllocated}
                                    </li>
                                ))}
                            </ul>
                            <label className="flex min-h-11 items-center gap-2">
                                <AdminInput
                                    type="checkbox"
                                    checked={ownershipChecked}
                                    disabled={pending}
                                    onChange={event => {
                                        setOwnershipChecked(event.target.checked);
                                        setPreview(current =>
                                            current ? { ...current, confirmation: undefined } : null,
                                        );
                                    }}
                                />
                                我确认上述历史库存全部属于当前经营店铺
                            </label>
                            <AdminField label="归属核对依据">
                                <AdminInput
                                    aria-label="归属核对依据"
                                    value={ownershipReason}
                                    maxLength={500}
                                    disabled={pending}
                                    onChange={event => {
                                        setOwnershipReason(event.target.value);
                                        setPreview(current =>
                                            current ? { ...current, confirmation: undefined } : null,
                                        );
                                    }}
                                    className={fieldClass}
                                />
                            </AdminField>
                            <AdminButton
                                type="button"
                                disabled={
                                    pending ||
                                    !ownershipChecked ||
                                    !ownershipReason.trim() ||
                                    isDirty ||
                                    saving
                                }
                                onClick={() =>
                                    void reviewMigration(activePreview.id, {
                                        stockLevels: activePreview.ownershipRows,
                                        reason: ownershipReason.trim(),
                                    })
                                }
                                className="font-semibold text-blue-700 disabled:opacity-50"
                            >
                                核验归属与库存
                            </AdminButton>
                        </div>
                    )}
                    {activePreview.result.conflicts.map(conflict => (
                        <p key={conflict} role="alert">
                            {conflict}
                        </p>
                    ))}
                    <AdminButton
                        type="button"
                        disabled={
                            pending ||
                            saving ||
                            isDirty ||
                            activePreview.result.conflicts.length > 0 ||
                            activePreview.result.alreadyMigrated ||
                            (activePreview.ownershipRows.length > 0 && !activePreview.confirmation)
                        }
                        onClick={() => void migrate()}
                        className="font-semibold text-blue-700 disabled:opacity-50"
                    >
                        确认核对并切换
                    </AdminButton>
                    <AdminButton
                        type="button"
                        disabled={pending}
                        onClick={() => {
                            reviewSequence.current += 1;
                            setPreviewRequest(null);
                            setPreview(null);
                        }}
                        className="ml-4"
                    >
                        取消
                    </AdminButton>
                </div>
            )}
            {readbackFailed && (
                <AdminButton
                    type="button"
                    disabled={pending}
                    onClick={() => void refreshAfterMigration()}
                    className="text-xs font-semibold text-blue-700"
                >
                    重新读取最新库存
                </AdminButton>
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
