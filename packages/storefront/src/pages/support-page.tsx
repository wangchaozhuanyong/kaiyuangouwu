/* eslint-disable import/order -- prettier-plugin-organize-imports places type-only imports after runtime imports. */
import { useRouter } from '@tanstack/react-router';
import { ChevronRight, Clock3, Copy, Headphones, MessageCircle, QrCode, Star, ThumbsUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ShopApi } from '../api';

import '../styles/modals-and-support.css';

import { supportFaqItems } from '../../../storefront-content-plugin/src/support-faq';
import qqIcon from '../assets/support/qq.svg';
import telegramIcon from '../assets/support/telegram.svg';
import wechatIcon from '../assets/support/wechat.svg';
import whatsappIcon from '../assets/support/whatsapp.svg';
import { SafeImage } from '../safe-image';
import { SupportPageContext } from '../storefront-page-contexts';
import { EmptyState, Sheet, Subpage } from '../storefront-ui/page-shell';
import {
    StorefrontSupportChannel,
    SupportChannelKey,
    storefrontSupportChannels,
    supportChannelDetail,
    supportPageTitle,
    supportServiceDetails,
} from '../support-content';
import { ActiveCustomer, StorefrontContentBlock, StorefrontLanguage } from '../types';

// TODO: Fix internal imports later

export interface SupportPageProps {
    api?: ShopApi;
    customer?: ActiveCustomer | null;
    content?: StorefrontContentBlock;
    language: StorefrontLanguage;
    orderCode?: string;
    focus?: 'evaluation';
    onNotify?: (message: string) => void;
    onSignIn?: () => void;
}

const channelIcons: Record<SupportChannelKey, string> = {
    WECHAT: wechatIcon,
    QQ: qqIcon,
    WHATSAPP: whatsappIcon,
    TELEGRAM: telegramIcon,
    QQ_GROUP: qqIcon,
};

export function SupportPage() {
    const router = useRouter();
    const goBack = () => router.history.back();
    const { api, customer, content, language, orderCode, focus, onNotify, onSignIn } =
        SupportPageContext.useValue();
    const isZh = language === 'zh';
    return (
        <Subpage
            title={supportPageTitle(content, language)}
            language={language}
            onBack={goBack}
            surfaceColor={content?.backgroundColor}
        >
            {content ? (
                <SupportContent
                    content={content}
                    language={language}
                    orderCode={orderCode}
                    focus={focus}
                    onNotify={onNotify}
                    api={api}
                    customer={customer}
                    onSignIn={onSignIn}
                />
            ) : (
                <EmptyState
                    icon={<Headphones />}
                    title={isZh ? '客服信息暂未配置' : 'Support is not configured yet'}
                    detail={
                        isZh
                            ? '待商家配置电话、邮箱或在线客服后，将在这里显示'
                            : 'Phone, email, or online support will appear here after merchant setup'
                    }
                />
            )}
        </Subpage>
    );
}

export function SupportContent({
    api,
    customer,
    content,
    language,
    orderCode,
    focus,
    onNotify,
    onSignIn,
}: Readonly<{
    api?: ShopApi;
    customer?: ActiveCustomer | null;
    content: StorefrontContentBlock;
    language: StorefrontLanguage;
    orderCode?: string;
    focus?: 'evaluation';
    onNotify?: (message: string) => void;
    onSignIn?: () => void;
}>) {
    const [qrChannel, setQrChannel] = useState<StorefrontSupportChannel | null>(null);
    const [qrImageFailed, setQrImageFailed] = useState(false);
    const [qrImageRetryKey, setQrImageRetryKey] = useState(0);
    const isZh = language === 'zh';
    const service = supportServiceDetails(content, language);
    const channels = storefrontSupportChannels(content);
    const faqs = supportFaqItems(content.settings).filter(
        item =>
            item.enabled &&
            item.questionZh.trim() &&
            item.answerZh.trim() &&
            item.questionEn.trim() &&
            item.answerEn.trim(),
    );

    const openChannel = (channel: StorefrontSupportChannel) => {
        if (channel.key === 'WECHAT') {
            if (channel.item.imageUrl) {
                setQrImageFailed(false);
                setQrImageRetryKey(0);
                setQrChannel(channel);
            }
        }
    };
    const closeQrSheet = () => {
        setQrChannel(null);
        setQrImageFailed(false);
    };
    const retryQrImage = () => {
        setQrImageFailed(false);
        setQrImageRetryKey(value => value + 1);
    };

    return (
        <div className="support-center-content">
            <header className="support-desktop-hero">
                <div>
                    <span>{isZh ? '客户支持' : 'Customer support'}</span>
                    <h1>{supportPageTitle(content, language)}</h1>
                    {content.subtitle.trim() ? <p>{content.subtitle.trim()}</p> : null}
                </div>
                <div className="support-desktop-hero-media" aria-hidden="true">
                    {content.imageUrl ? (
                        <SafeImage src={content.imageUrl} alt="" imageKind="hero" />
                    ) : (
                        <Headphones />
                    )}
                </div>
            </header>
            {orderCode ? (
                <section className="support-order-banner" aria-label={isZh ? '咨询订单' : 'Inquiry Order'}>
                    <div className="support-order-banner-main">
                        <span className="support-order-banner-badge">
                            {isZh ? '当前咨询订单' : 'Active Order'}
                        </span>
                        <strong className="support-order-banner-code">{orderCode}</strong>
                        <p className="support-order-banner-tip">
                            {isZh
                                ? '向客服咨询时可直接出示此订单号，客服将快速为您查询与处理售后/物流'
                                : 'Provide this order number when chatting with support for priority resolution'}
                        </p>
                    </div>
                    <button
                        type="button"
                        className="support-order-banner-copy"
                        onClick={() => {
                            if (navigator.clipboard) {
                                void navigator.clipboard.writeText(orderCode);
                                onNotify?.(isZh ? `订单号已复制：${orderCode}` : 'Order number copied');
                            }
                        }}
                    >
                        <Copy size={15} aria-hidden="true" />
                        <span>{isZh ? '复制单号' : 'Copy'}</span>
                    </button>
                </section>
            ) : null}
            {content.subtitle.trim() ? <p className="support-page-intro">{content.subtitle.trim()}</p> : null}
            <section className="support-hours-card" aria-labelledby="support-hours-title">
                <div className="support-hours-heading">
                    <div className="support-hours-title-wrap">
                        <div className="support-hours-rail" aria-hidden="true">
                            <Clock3 size={18} />
                        </div>
                        <h2 id="support-hours-title">{isZh ? '客服服务时间' : 'Customer-service hours'}</h2>
                    </div>
                    <span>{service.days}</span>
                </div>
                <div className="support-hours-main">
                    <strong className="support-hours-time">{service.time}</strong>
                    {service.note ? (
                        <div className="support-hours-note">
                            <MessageCircle size={15} aria-hidden="true" />
                            <p>{service.note}</p>
                        </div>
                    ) : null}
                </div>
            </section>

            {channels.length ? (
                <section
                    className="support-channel-list"
                    aria-label={isZh ? '客服联系方式' : 'Support channels'}
                >
                    {channels.map(channel => {
                        const icon = channelIcons[channel.key];
                        const isWeChat = channel.key === 'WECHAT';
                        const detail = supportChannelDetail(channel, language);
                        const disabled = isWeChat
                            ? !channel.item.imageUrl
                            : channel.item.targetType === 'NONE' || !channel.item.targetValue;
                        const rowContent = (
                            <>
                                <span className="support-channel-icon" aria-hidden="true">
                                    <img src={icon} alt="" width={20} height={20} />
                                </span>
                                <span className="support-channel-copy">
                                    <strong>{channel.item.label}</strong>
                                    {detail ? <small>{detail}</small> : null}
                                </span>
                                <span className="support-channel-action">
                                    {isWeChat ? <QrCode aria-hidden="true" /> : null}
                                    {isWeChat ? (isZh ? '扫码' : 'Scan') : isZh ? '打开' : 'Open'}
                                </span>
                                <ChevronRight className="support-channel-chevron" aria-hidden="true" />
                            </>
                        );
                        return isWeChat ? (
                            <button
                                key={channel.item.id}
                                type="button"
                                className="support-channel-row"
                                data-channel={channel.key.toLowerCase()}
                                disabled={disabled}
                                aria-label={`${channel.item.label} ${
                                    isWeChat ? (isZh ? '扫码' : 'Scan') : isZh ? '打开' : 'Open'
                                }`}
                                onClick={() => openChannel(channel)}
                            >
                                {rowContent}
                            </button>
                        ) : (
                            <a
                                key={channel.item.id}
                                className="support-channel-row"
                                data-channel={channel.key.toLowerCase()}
                                href={disabled ? undefined : (channel.item.targetValue ?? undefined)}
                                target="_blank"
                                rel="noreferrer"
                                aria-disabled={disabled || undefined}
                                aria-label={`${channel.item.label} ${isZh ? '打开' : 'Open'}`}
                            >
                                {rowContent}
                            </a>
                        );
                    })}
                </section>
            ) : (
                <div className="support-channel-empty">
                    <Headphones aria-hidden="true" />
                    <p>{isZh ? '客服联系方式暂未启用' : 'No support channels are enabled yet'}</p>
                </div>
            )}

            {faqs.length > 0 && (
                <section
                    className="support-faq-card"
                    aria-label={isZh ? '常见问题' : 'Frequently asked questions'}
                >
                    <h2>{isZh ? '常见问题' : 'Frequently asked questions'}</h2>
                    <div className="support-faq-list">
                        {faqs.map(item => (
                            <details key={item.id} className="support-faq-item">
                                <summary>
                                    <span>{isZh ? item.questionZh.trim() : item.questionEn.trim()}</span>
                                    <ChevronRight aria-hidden="true" />
                                </summary>
                                <p>{isZh ? item.answerZh.trim() : item.answerEn.trim()}</p>
                            </details>
                        ))}
                    </div>
                </section>
            )}

            <CustomerServiceEvaluationSection
                key={`${customer?.id ?? 'guest'}:${orderCode ?? 'general'}`}
                api={api}
                customerId={customer?.id}
                language={language}
                orderCode={orderCode}
                focusOnMount={focus === 'evaluation'}
                onNotify={onNotify}
                onSignIn={onSignIn}
            />

            {qrChannel?.item.imageUrl ? (
                <Sheet
                    title={qrChannel.item.label || (isZh ? '微信客服' : 'WeChat support')}
                    language={language}
                    onClose={closeQrSheet}
                >
                    <div className="support-qr-sheet">
                        <div className="support-qr-frame">
                            {qrImageFailed ? (
                                <div className="support-qr-error" role="status" aria-live="polite">
                                    <QrCode aria-hidden="true" />
                                    <strong>
                                        {isZh ? '二维码暂时无法加载' : 'The QR code could not be loaded'}
                                    </strong>
                                    <span>
                                        {isZh
                                            ? '请检查网络后重新加载'
                                            : 'Check your connection and try again'}
                                    </span>
                                    <button type="button" onClick={retryQrImage}>
                                        {isZh ? '重新加载' : 'Try again'}
                                    </button>
                                </div>
                            ) : (
                                <img
                                    key={qrImageRetryKey}
                                    src={qrChannel.item.imageUrl}
                                    alt={isZh ? '微信客服二维码' : 'WeChat support QR code'}
                                    onError={() => setQrImageFailed(true)}
                                />
                            )}
                        </div>
                        {!qrImageFailed ? (
                            <p>
                                {isZh ? '长按保存或使用微信扫一扫' : 'Save the code or scan it with WeChat'}
                            </p>
                        ) : null}
                        {typeof qrChannel.item.settings?.supportAccount === 'string' &&
                        qrChannel.item.settings.supportAccount.trim() ? (
                            <small>
                                {isZh ? '微信号' : 'WeChat ID'}：{qrChannel.item.settings.supportAccount}
                            </small>
                        ) : null}
                        {!qrImageFailed ? (
                            <a
                                className="support-qr-save"
                                href={qrChannel.item.imageUrl}
                                download
                                target="_blank"
                                rel="noreferrer"
                            >
                                {isZh ? '保存二维码' : 'Save QR code'}
                            </a>
                        ) : null}
                    </div>
                </Sheet>
            ) : null}
        </div>
    );
}

function CustomerServiceEvaluationSection({
    api,
    customerId,
    language,
    orderCode,
    focusOnMount = false,
    onNotify,
    onSignIn,
}: {
    api?: ShopApi;
    customerId?: string;
    language: StorefrontLanguage;
    orderCode?: string;
    focusOnMount?: boolean;
    onNotify?: (message: string) => void;
    onSignIn?: () => void;
}) {
    const isZh = language === 'zh';
    const sectionRef = useRef<HTMLElement>(null);
    const [rating, setRating] = useState(5);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [comment, setComment] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [loading, setLoading] = useState(Boolean(api && customerId));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const tags = [
        { code: 'FAST_RESPONSE', label: isZh ? '响应迅速' : 'Fast response' },
        { code: 'FRIENDLY', label: isZh ? '态度热情' : 'Friendly' },
        { code: 'PROFESSIONAL', label: isZh ? '耐心专业' : 'Professional' },
        { code: 'RESOLVED', label: isZh ? '问题已解决' : 'Problem solved' },
        { code: 'EFFICIENT', label: isZh ? '处理高效' : 'Efficient' },
    ];

    const ratingLabels = isZh
        ? ['', '非常不满意', '不满意', '一般', '满意', '非常满意']
        : ['', 'Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'];

    useEffect(() => {
        if (!focusOnMount) return;
        const frame = requestAnimationFrame(() => {
            sectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
            sectionRef.current?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [focusOnMount]);

    useEffect(() => {
        if (!api || !customerId) return;
        const controller = new AbortController();
        setLoading(true);
        setError('');
        void api.contentReviewsApi
            .myCustomerServiceFeedback(orderCode, controller.signal)
            .then(record => {
                if (controller.signal.aborted || !record) return;
                setRating(record.rating);
                setSelectedTags(record.tags);
                setComment(record.comment ?? '');
                setSubmitted(true);
            })
            .catch(() => {
                if (!controller.signal.aborted) {
                    setError(
                        isZh ? '暂时无法读取评价，请重试。' : 'Could not load your feedback. Try again.',
                    );
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [api, customerId, orderCode, isZh]);

    const toggleTag = (tag: string) => {
        setSelectedTags(prev => (prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!api || !customerId) {
            setError(isZh ? '请先登录后提交客服评价。' : 'Sign in to submit feedback.');
            onSignIn?.();
            return;
        }
        if (saving || loading) return;
        setSaving(true);
        setError('');
        try {
            const saved = await api.contentReviewsApi.submitCustomerServiceFeedback({
                ...(orderCode ? { orderCode } : {}),
                rating,
                tags: selectedTags,
                comment,
            });
            setRating(saved.rating);
            setSelectedTags(saved.tags);
            setComment(saved.comment ?? '');
            setSubmitted(true);
            onNotify?.(
                isZh
                    ? '感谢您的评价，我们将持续优化服务质量！'
                    : 'Thank you! Your feedback has been recorded.',
            );
        } catch {
            setError(
                isZh
                    ? '提交失败，请检查订单归属或稍后重试。'
                    : 'Submission failed. Check your order or retry.',
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <section
            ref={sectionRef}
            tabIndex={focusOnMount ? -1 : undefined}
            className="support-evaluation-card"
            aria-label={isZh ? '客服服务评价' : 'Customer service evaluation'}
        >
            <header className="support-evaluation-header">
                <div className="support-evaluation-title">
                    <ThumbsUp size={18} aria-hidden="true" />
                    <strong>{isZh ? '客服服务评价' : 'Customer service evaluation'}</strong>
                </div>
                <span>{isZh ? '您的反馈是我们进步的动力' : 'Help us improve our service'}</span>
            </header>

            {loading && <p role="status">{isZh ? '正在读取您的评价…' : 'Loading your feedback…'}</p>}
            {error && (
                <p role="alert" className="support-evaluation-error">
                    {error}
                </p>
            )}

            {submitted ? (
                <div className="support-evaluation-success">
                    <div className="evaluation-stars-display">
                        {[1, 2, 3, 4, 5].map(star => (
                            <Star
                                key={star}
                                size={20}
                                className={star <= rating ? 'is-active' : ''}
                                fill={star <= rating ? 'currentColor' : 'none'}
                            />
                        ))}
                    </div>
                    <strong>
                        {isZh ? '已收到您的服务评价，感谢支持！' : 'Thank you for rating our service!'}
                    </strong>
                    {orderCode ? (
                        <small>{isZh ? `关联订单号：${orderCode}` : `Order: ${orderCode}`}</small>
                    ) : null}
                    <button
                        type="button"
                        className="support-evaluation-edit-btn"
                        onClick={() => setSubmitted(false)}
                    >
                        {isZh ? '修改评价' : 'Edit evaluation'}
                    </button>
                </div>
            ) : (
                <form className="support-evaluation-form" onSubmit={event => void handleSubmit(event)}>
                    {orderCode ? (
                        <div className="support-evaluation-order-badge">
                            <span>{isZh ? '当前服务订单：' : 'Order: '}</span>
                            <b>{orderCode}</b>
                        </div>
                    ) : null}

                    <div className="support-rating-row">
                        <div
                            className="support-stars"
                            role="radiogroup"
                            aria-label={isZh ? '服务评分' : 'Rating'}
                        >
                            {[1, 2, 3, 4, 5].map(star => (
                                <button
                                    type="button"
                                    key={star}
                                    className={`support-star-btn ${star <= rating ? 'is-active' : ''}`}
                                    onClick={() => setRating(star)}
                                    aria-label={`${star} star`}
                                >
                                    <Star
                                        size={24}
                                        fill={star <= rating ? 'currentColor' : 'none'}
                                        aria-hidden="true"
                                    />
                                </button>
                            ))}
                        </div>
                        <span className="support-rating-text">{ratingLabels[rating] || ''}</span>
                    </div>

                    <div className="support-evaluation-tags">
                        {tags.map(tag => {
                            const active = selectedTags.includes(tag.code);
                            return (
                                <button
                                    type="button"
                                    key={tag.code}
                                    className={`support-tag-btn ${active ? 'is-active' : ''}`}
                                    onClick={() => toggleTag(tag.code)}
                                    aria-pressed={active}
                                >
                                    {tag.label}
                                </button>
                            );
                        })}
                    </div>

                    <textarea
                        className="support-evaluation-textarea"
                        placeholder={
                            isZh
                                ? '请填写您对本次客服服务的建议或体验（选填）'
                                : 'Share details about your customer service experience (optional)'
                        }
                        rows={3}
                        value={comment}
                        onChange={e => setComment(e.target.value)}
                        maxLength={500}
                    />

                    <button
                        type="submit"
                        className="support-evaluation-submit-btn"
                        disabled={saving || loading}
                    >
                        {saving
                            ? isZh
                                ? '正在提交…'
                                : 'Submitting…'
                            : isZh
                              ? '提交客服评价'
                              : 'Submit feedback'}
                    </button>
                </form>
            )}
        </section>
    );
}
