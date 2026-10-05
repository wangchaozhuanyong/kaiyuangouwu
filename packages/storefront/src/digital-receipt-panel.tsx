import type { ShopApi } from './api';
import type { MarketConfig, Order, StorefrontLanguage } from './types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { languageCodeFor } from './i18n';
import { storefrontInitialQueryError, storefrontQueryPresentation } from './loading-state';
import { ORDER_STATUS_REFRESH_INTERVAL } from './order-refresh';
import { storefrontQueryKeys } from './query-client';
import { storefrontErrorMessage } from './storefront-errors';

export interface DigitalReceiptStatus {
    orderLineId: string;
    mode: string;
    state: string;
    eligibleQuantity: number;
    readyQuantity: number;
    claimedQuantity: number;
    notificationState: string;
}

export interface DigitalReceiptContent extends DigitalReceiptStatus {
    instructions?: string;
    downloadUrl?: string | null;
    packages?: Array<{
        number: number;
        note: string;
        fields: Array<{ label: string; value: string }>;
        attachments: Array<{ name: string; downloadUrl: string }>;
    }>;
}

export function orderHasDigitalDelivery(order: Order) {
    return order.lines.some(
        line =>
            (line.customFields.fulfillmentTypeSnapshot ??
                line.productVariant.customFields.fulfillmentType) === 'digital',
    );
}

interface ReceiptPanelProps {
    api: ShopApi;
    order: Order;
    language: StorefrontLanguage;
    market: MarketConfig;
    confirmationToken?: string;
}

/** Changing the order, owner or proof remounts local secrets, including in an open order drawer. */
export function DigitalReceiptPanel(props: ReceiptPanelProps) {
    return (
        <ReceiptContents
            key={[
                storefrontQueryKeys.market(props.market),
                props.language,
                props.order.id,
                props.order.customer?.id ?? 'guest',
                props.confirmationToken ?? 'account',
            ].join(':')}
            {...props}
        />
    );
}

function ReceiptContents({ api, order, language, market, confirmationToken }: ReceiptPanelProps) {
    const isZh = language === 'zh';
    const client = useQueryClient();
    // A proof is kept out of the query cache. Each mounted proof has an opaque read scope.
    const proofScope = useId();
    const queryKey = [
        ...storefrontQueryKeys.privateScope(storefrontQueryKeys.market(market), languageCodeFor(language)),
        'digital-delivery-status',
        order.customer?.id ?? 'guest',
        order.id,
        proofScope,
    ];
    const [contents, setContents] = useState<Record<string, DigitalReceiptContent>>({});
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const inFlight = useRef(false);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const status = useQuery({
        queryKey,
        queryFn: ({ signal }) => api.digitalDeliveryStatuses(order.id, confirmationToken, signal),
        staleTime: 0,
        gcTime: 0,
        refetchInterval: ORDER_STATUS_REFRESH_INTERVAL,
        refetchIntervalInBackground: false,
    });
    useEffect(() => {
        if (!status.data) return;
        setContents(current => {
            const entries = Object.entries(current).filter(([id, content]) =>
                status.data.some(
                    item =>
                        String(item.orderLineId) === id &&
                        item.state === 'READY' &&
                        item.readyQuantity >= content.readyQuantity,
                ),
            );
            return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
        });
    }, [status.data]);
    const presentation = storefrontQueryPresentation(status);
    const initialError = storefrontInitialQueryError(status, language);
    const claim = async (id: string) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(id);
        setError('');
        setNotice('');
        try {
            const content = await api.claimDigitalDelivery(order.id, id, confirmationToken);
            if (!mounted.current) return;
            if (String(content.orderLineId) !== id || content.state !== 'READY') {
                throw new Error(
                    isZh
                        ? '领取结果尚未确认，请刷新交付状态后核实。'
                        : 'The claim result is unconfirmed. Refresh delivery status to verify.',
                );
            }
            // Only an explicit claim response enters local state; never a shared query cache.
            setContents(current => ({ ...current, [id]: content }));
            setNotice(isZh ? '已领取，内容显示在下方。' : 'Claimed. Your content is shown below.');
            client.setQueryData<DigitalReceiptStatus[]>(queryKey, current =>
                current?.map(item =>
                    item.orderLineId === id ? { ...item, claimedQuantity: content.claimedQuantity } : item,
                ),
            );
            // A failed read after this write must not be presented as a failed claim.
            void status.refetch({ cancelRefetch: false });
        } catch (cause) {
            if (mounted.current) setError(storefrontErrorMessage(cause, language));
        } finally {
            inFlight.current = false;
            if (mounted.current) setBusy('');
        }
    };
    return (
        <section
            className="digital-delivery-panel digital-receipt-panel"
            aria-label={isZh ? '领取数字商品' : 'Claim digital products'}
            aria-busy={Boolean(busy)}
        >
            <header>
                <div>
                    <ShieldCheck aria-hidden="true" />
                    <strong className="type-section">
                        {isZh ? '数字商品领取' : 'Your digital products'}
                    </strong>
                </div>
                <p className="type-helper">
                    {isZh
                        ? '邮件仅发送安全领取入口；通知成功不代表您已领取。'
                        : 'Email contains a secure claim link. A sent notification does not mean you have claimed.'}
                </p>
            </header>
            {presentation.initialLoading && (
                <p role="status" className="type-body">
                    {isZh ? '正在读取交付状态…' : 'Loading delivery status…'}
                </p>
            )}
            {initialError && (
                <div role="alert" className="type-body">
                    <p>{initialError}</p>
                    <button
                        className="secondary-action type-action"
                        type="button"
                        onClick={() => void status.refetch({ cancelRefetch: false })}
                    >
                        {isZh ? '重试读取状态' : 'Retry status'}
                    </button>
                </div>
            )}
            {error && (
                <p role="alert" className="type-body">
                    {error}
                </p>
            )}
            {notice && (
                <p role="status" className="type-body">
                    {notice}
                </p>
            )}
            {status.data?.length === 0 && (
                <p className="type-body">
                    {isZh
                        ? '暂无数字交付记录，请联系商家核实。'
                        : 'No digital delivery record is available. Contact the merchant.'}
                </p>
            )}
            <div>
                {status.data?.map(item => {
                    const content = contents[item.orderLineId];
                    const line = order.lines.find(value => value.id === String(item.orderLineId));
                    const claimedLabel =
                        item.claimedQuantity < item.readyQuantity
                            ? isZh
                                ? '领取新增内容'
                                : 'Claim new content'
                            : isZh
                              ? '查看已领取内容'
                              : 'View claimed content';
                    return (
                        <article key={item.orderLineId}>
                            <strong className="type-card">
                                {line?.productVariant.name ?? (isZh ? '数字商品' : 'Digital product')}
                            </strong>
                            <p className="type-body">
                                {isZh
                                    ? `可领取 ${item.readyQuantity} / 应交付 ${item.eligibleQuantity} 份 · 已领取 ${item.claimedQuantity} 份`
                                    : `Ready ${item.readyQuantity} / eligible ${item.eligibleQuantity} · claimed ${item.claimedQuantity}`}
                            </p>
                            {item.notificationState === 'EMAIL_FAILED' && (
                                <p className="type-helper">
                                    {isZh
                                        ? item.state === 'READY' && item.readyQuantity > 0
                                            ? '通知邮件发送失败，您仍可在这里领取。'
                                            : '通知邮件发送失败。领取资格以当前状态为准。'
                                        : item.state === 'READY' && item.readyQuantity > 0
                                          ? 'The notification email failed. You can still claim here.'
                                          : 'The notification email failed. Check the current claim eligibility below.'}
                                </p>
                            )}
                            {item.state === 'READY' ? (
                                <button
                                    className="primary-action type-action"
                                    type="button"
                                    disabled={Boolean(busy)}
                                    onClick={() => void claim(String(item.orderLineId))}
                                >
                                    {busy === String(item.orderLineId)
                                        ? isZh
                                            ? '领取中…'
                                            : 'Claiming…'
                                        : item.claimedQuantity
                                          ? claimedLabel
                                          : isZh
                                            ? '领取内容'
                                            : 'Claim content'}
                                </button>
                            ) : (
                                <p className="type-body">
                                    {isZh
                                        ? item.state === 'WAITING'
                                            ? '商家正在准备内容'
                                            : '当前领取资格已暂停或停止，请查看支付和退款状态'
                                        : item.state === 'WAITING'
                                          ? 'Content is being prepared'
                                          : 'Access is paused or stopped. Check payment and refund status.'}
                                </p>
                            )}
                            {item.state === 'READY' && content && (
                                <div className="digital-receipt-content">
                                    {content.instructions && (
                                        <p className="type-helper">{content.instructions}</p>
                                    )}
                                    {content.downloadUrl && (
                                        <a
                                            className="type-action"
                                            href={content.downloadUrl}
                                            rel="noreferrer"
                                        >
                                            <Download aria-hidden="true" />
                                            {isZh ? '下载成交时的文件' : 'Download your purchased version'}
                                        </a>
                                    )}
                                    {content.packages
                                        ?.slice(0, Math.min(item.readyQuantity, content.readyQuantity))
                                        .map(pack => (
                                            <div key={pack.number} className="digital-receipt-package">
                                                <strong className="type-label">
                                                    {isZh ? `第 ${pack.number} 份` : `Item ${pack.number}`}
                                                </strong>
                                                <dl>
                                                    {pack.fields.map((field, index) => (
                                                        <div key={`${index}:${field.label}`}>
                                                            <dt className="type-label">{field.label}</dt>
                                                            <dd className="type-body">{field.value}</dd>
                                                        </div>
                                                    ))}
                                                </dl>
                                                {pack.note && <p className="type-helper">{pack.note}</p>}
                                                {pack.attachments.map(file => (
                                                    <a
                                                        className="type-action"
                                                        key={file.downloadUrl}
                                                        href={file.downloadUrl}
                                                        rel="noreferrer"
                                                    >
                                                        <Download aria-hidden="true" />
                                                        {file.name}
                                                    </a>
                                                ))}
                                            </div>
                                        ))}
                                </div>
                            )}
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
// organize-imports-ignore -- Preserve ESLint grouping of type-only imports.
