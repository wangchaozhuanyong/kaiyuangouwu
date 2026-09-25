/* eslint-disable import/order -- The Prettier import organizer places type imports after runtime imports. */
import { useEffect, useRef, useState } from 'react';
import type { ShopApi } from '../../api';
import type { AfterSalesEvidence, StorefrontLanguage } from '../../types';

import { SafeImage } from '../../safe-image';
import { storefrontErrorMessage } from '../../storefront-errors';
/* eslint-enable import/order */

export function AfterSalesEvidenceGallery({
    items,
    language,
    onRefresh,
}: {
    items: AfterSalesEvidence[];
    language: StorefrontLanguage;
    onRefresh?: () => void;
}) {
    const isZh = language === 'zh';
    if (!items.length) return null;
    return (
        <section className="after-sales-evidence" aria-label={isZh ? '售后凭证' : 'Supporting images'}>
            <header>
                <strong>{isZh ? '售后凭证' : 'Supporting images'}</strong>
                {onRefresh && (
                    <button type="button" onClick={onRefresh}>
                        {isZh ? '刷新图片' : 'Refresh images'}
                    </button>
                )}
            </header>
            <div className="after-sales-evidence-grid">
                {items.map((item, index) => (
                    <div className="after-sales-evidence-item" key={item.id}>
                        {item.available && item.previewUrl ? (
                            <a
                                href={item.previewUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={isZh ? `查看凭证 ${index + 1}` : `View image ${index + 1}`}
                            >
                                <SafeImage
                                    src={item.previewUrl}
                                    alt={isZh ? `售后凭证 ${index + 1}` : `Supporting image ${index + 1}`}
                                />
                            </a>
                        ) : (
                            <span>{isZh ? '图片已过保留期或已移除' : 'Image expired or removed'}</span>
                        )}
                    </div>
                ))}
            </div>
        </section>
    );
}

export function AfterSalesEvidenceUploader({
    api,
    orderId,
    language,
    disabled,
    onChange,
    onBusyChange,
    onReadyChange,
}: {
    api: Pick<
        ShopApi['contentReviewsApi'],
        'afterSalesEvidenceDrafts' | 'uploadAfterSalesEvidence' | 'removeAfterSalesEvidenceDraft'
    >;
    orderId: string;
    language: StorefrontLanguage;
    disabled: boolean;
    onChange: (ids: string[]) => void;
    onBusyChange: (busy: boolean) => void;
    onReadyChange: (ready: boolean) => void;
}) {
    const isZh = language === 'zh';
    const [items, setItems] = useState<AfterSalesEvidence[]>([]);
    const [busy, setBusy] = useState(false);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState('');
    const fileInput = useRef<HTMLInputElement>(null);

    const setWorking = (value: boolean) => {
        setBusy(value);
        onBusyChange(value);
    };
    const apply = (rows: AfterSalesEvidence[]) => {
        setItems(rows);
        onChange(rows.map(row => row.id));
        setReady(true);
        onReadyChange(true);
    };
    const refresh = async () => {
        setWorking(true);
        setError('');
        try {
            apply(await api.afterSalesEvidenceDrafts(orderId));
        } catch (cause) {
            setReady(false);
            onReadyChange(false);
            setError(storefrontErrorMessage(cause, language));
        } finally {
            setWorking(false);
        }
    };
    useEffect(() => {
        void refresh();
    }, [api, orderId]);

    const upload = async (files: File[]) => {
        if (busy || disabled || !ready || !files.length) return;
        if (items.length + files.length > 6 || files.some(file => file.size > 5 * 1024 * 1024)) {
            setError(isZh ? '最多 6 张，每张不超过 5MB。' : 'Up to 6 images, 5MB each.');
            return;
        }
        setWorking(true);
        setError('');
        try {
            for (const file of files) await api.uploadAfterSalesEvidence(orderId, file);
            apply(await api.afterSalesEvidenceDrafts(orderId));
        } catch (cause) {
            setError(storefrontErrorMessage(cause, language));
            // A timed-out upload may have reached the server. Reconcile before
            // allowing submission or retry, so the customer sees the actual set.
            try {
                apply(await api.afterSalesEvidenceDrafts(orderId));
            } catch {
                setReady(false);
                onReadyChange(false);
            }
        } finally {
            setWorking(false);
        }
    };

    const remove = async (id: string) => {
        if (busy || disabled) return;
        setWorking(true);
        setError('');
        try {
            await api.removeAfterSalesEvidenceDraft(id);
            apply(items.filter(item => item.id !== id));
        } catch (cause) {
            setError(storefrontErrorMessage(cause, language));
        } finally {
            setWorking(false);
        }
    };

    return (
        <section
            className="after-sales-evidence"
            aria-label={isZh ? '上传售后凭证' : 'Upload supporting images'}
            aria-busy={busy}
        >
            <header>
                <strong>{isZh ? '图片凭证（选填）' : 'Supporting images (optional)'}</strong>
                <span>{items.length} / 6</span>
            </header>
            <p>
                {isZh
                    ? '支持 JPG、PNG、WebP，每张不超过 5MB。仅本人及有权限的客服可查看，工单关闭后保留 180 天。未提交的图片将在 24 小时后清理。'
                    : 'JPG, PNG or WebP, up to 5MB each. Private to you and authorized support staff. ' +
                      'Kept for 180 days after case closure; unsubmitted images expire after 24 hours.'}
            </p>
            <div className="after-sales-evidence-grid">
                {items.map((item, index) => (
                    <div className="after-sales-evidence-item" key={item.id}>
                        {item.previewUrl && (
                            <SafeImage
                                src={item.previewUrl}
                                alt={isZh ? `待提交凭证 ${index + 1}` : `Supporting image ${index + 1}`}
                            />
                        )}
                        <button
                            type="button"
                            disabled={busy || disabled}
                            onClick={() => void remove(item.id)}
                            aria-label={isZh ? `移除凭证 ${index + 1}` : `Remove image ${index + 1}`}
                        >
                            {isZh ? '移除' : 'Remove'}
                        </button>
                    </div>
                ))}
            </div>
            <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                hidden
                disabled={busy || disabled || !ready}
                onChange={event => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = '';
                    void upload(files);
                }}
            />
            <div className="after-sales-evidence-actions">
                <button
                    type="button"
                    disabled={busy || disabled || !ready || items.length >= 6}
                    onClick={() => fileInput.current?.click()}
                >
                    {busy
                        ? isZh
                            ? '正在处理图片…'
                            : 'Processing images…'
                        : isZh
                          ? '添加图片'
                          : 'Add images'}
                </button>
                <button type="button" disabled={busy || disabled} onClick={() => void refresh()}>
                    {isZh ? '刷新凭证' : 'Refresh images'}
                </button>
            </div>
            {error && <p role="alert">{error}</p>}
        </section>
    );
}
