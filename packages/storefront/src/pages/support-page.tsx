/* eslint-disable import/order -- prettier-plugin-organize-imports places type-only imports after runtime imports. */
import { useRouter } from '@tanstack/react-router';
import { ArrowUpRight, Check, ChevronRight, Copy, Headphones, QrCode, Star, ThumbsUp } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ContentText } from '../../../storefront-content-plugin/src/shared/content-text';
import type { ShopApi } from '../api';
import { storefrontVisitorId } from '../referral-attribution';
import { storefrontErrorMessage } from '../storefront-errors';

import qqIcon from '../assets/support/qq.svg';
import telegramIcon from '../assets/support/telegram.svg';
import wechatIcon from '../assets/support/wechat.svg';
import whatsappIcon from '../assets/support/whatsapp.svg';
import { SafeImage } from '../safe-image';
import { goBackInStorefront } from '../storefront-navigation-history';
import { SupportPageContext } from '../storefront-page-contexts';
import { EmptyState, Sheet, Subpage, SubpageBody } from '../storefront-ui/page-shell';
import '../styles/modals-and-support.css';
import {
    StorefrontSupportChannel,
    SupportChannelKey,
    publishedSupportFaqs,
    storefrontSupportChannels,
    supportChannelDetail,
    supportPageTitle,
    supportServiceDetails,
} from '../support-content';
import {
    ActiveCustomer,
    CustomerServiceReviewRecord,
    StorefrontContentBlock,
    StorefrontLanguage,
} from '../types';

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
    const goBack = () => goBackInStorefront(router);
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
                    api={api}
                    content={content}
                    language={language}
                    orderCode={orderCode}
                    focus={focus}
                    onNotify={onNotify}
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
    const [qrImageRetryKey, setQrImageRetryKey] = useState(0);
    const [faqSearch, setFaqSearch] = useState('');
    const faqSearchId = useId();
    const [faqPage, setFaqPage] = useState(0);
    const isZh = language === 'zh';
    const service = supportServiceDetails(content, language);
    const channels = storefrontSupportChannels(content);
    const faqs = publishedSupportFaqs(content);

    const filteredFaqs = filterSupportFaqs(faqs, faqSearch, language);
    const faqPageCount = Math.max(1, Math.ceil(filteredFaqs.length / 8));
    const currentFaqPage = Math.min(faqPage, faqPageCount - 1);
    const visibleFaqs = filteredFaqs.slice(currentFaqPage * 8, currentFaqPage * 8 + 8);

    const openChannel = (channel: StorefrontSupportChannel) => {
        if (channel.key === 'WECHAT') {
            if (channel.item.imageUrl) {
                setQrImageRetryKey(0);
                setQrChannel(channel);
            }
        }
    };
    const closeQrSheet = () => {
        setQrChannel(null);
    };
    const retryQrImage = () => {
        setQrImageRetryKey(value => value + 1);
    };

    if (!channels.length && !faqs.length) {
        return (
            <SubpageBody className="support-center-content">
                <EmptyState
                    icon={<Headphones />}
                    title={supportPageTitle(content, language)}
                    detail={
                        isZh
                            ? '商家尚未启用联系方式或常见问题，暂时无法通过这里咨询。'
                            : 'No contact channels or FAQs are available yet.'
                    }
                />
            </SubpageBody>
        );
    }

    return (
        <SubpageBody className="support-center-content">
            <header className="support-desktop-hero">
                <div>
                    <span>{isZh ? '客户支持' : 'Customer support'}</span>
                    <h1>{supportPageTitle(content, language)}</h1>
                    {content.subtitle.trim() ? <ContentText>{content.subtitle.trim()}</ContentText> : null}
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
            {content.subtitle.trim() ? (
                <ContentText className="support-page-intro">{content.subtitle.trim()}</ContentText>
            ) : null}
            <div className="support-workspace">
                <div className="support-contact-panel">
                    {channels.length ? (
                        <div className="support-hours-card">
                            <span className="support-hours-label">{isZh ? '服务时间' : 'Service hours'}</span>
                            <div className="support-hours-value">
                                <span>{service.days}</span>
                                <strong className="support-hours-time">{service.time}</strong>
                            </div>
                        </div>
                    ) : null}

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
                                            {isWeChat ? (isZh ? '扫码' : 'Scan') : isZh ? '联系' : 'Contact'}
                                            {isWeChat ? (
                                                <QrCode aria-hidden="true" />
                                            ) : (
                                                <ArrowUpRight aria-hidden="true" />
                                            )}
                                        </span>
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
                                            isWeChat ? (isZh ? '扫码' : 'Scan') : isZh ? '联系' : 'Contact'
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
                                        aria-label={`${channel.item.label} ${isZh ? '联系' : 'Contact'}`}
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
                    {channels.length && service.note ? (
                        <section className="support-contact-note">
                            <h3>{isZh ? '咨询说明' : 'Before you contact us'}</h3>
                            <ContentText>{service.note}</ContentText>
                        </section>
                    ) : null}
                </div>
                {faqs.length > 0 ? (
                    <section
                        className="support-faq-card"
                        aria-label={isZh ? '常见问题' : 'Frequently asked questions'}
                    >
                        <div className="support-faq-header">
                            <h2>{isZh ? '常见问题' : 'Frequently asked questions'}</h2>
                            <label htmlFor={faqSearchId}>
                                {isZh ? '搜索常见问题' : 'Search frequently asked questions'}
                            </label>
                        </div>
                        <div className="support-faq-search">
                            <input
                                id={faqSearchId}
                                type="search"
                                value={faqSearch}
                                onChange={event => {
                                    setFaqSearch(event.target.value);
                                    setFaqPage(0);
                                }}
                                placeholder={isZh ? '输入问题关键词' : 'Search questions'}
                            />
                        </div>
                        <div className="support-faq-list">
                            {visibleFaqs.map(item => (
                                <details key={item.id} className="support-faq-item">
                                    <summary>
                                        <span>{isZh ? item.questionZh.trim() : item.questionEn.trim()}</span>
                                        <ChevronRight aria-hidden="true" />
                                    </summary>
                                    <p>{isZh ? item.answerZh.trim() : item.answerEn.trim()}</p>
                                </details>
                            ))}
                        </div>
                        {!filteredFaqs.length && (
                            <p role="status">
                                {channels.length
                                    ? isZh
                                        ? '没有找到相关问题，请联系客服。'
                                        : 'No matching questions. Please contact support.'
                                    : isZh
                                      ? '没有找到相关问题。'
                                      : 'No matching questions found.'}
                            </p>
                        )}
                        {filteredFaqs.length > 0 && (
                            <nav
                                className="support-faq-pagination"
                                aria-label={isZh ? '常见问题分页' : 'FAQ pages'}
                            >
                                <button
                                    type="button"
                                    disabled={currentFaqPage === 0}
                                    onClick={() => setFaqPage(currentFaqPage - 1)}
                                >
                                    {isZh ? '上一页' : 'Previous'}
                                </button>
                                <span aria-live="polite">
                                    {currentFaqPage + 1} / {faqPageCount}
                                </span>
                                <button
                                    type="button"
                                    disabled={currentFaqPage + 1 === faqPageCount}
                                    onClick={() => setFaqPage(currentFaqPage + 1)}
                                >
                                    {isZh ? '下一页' : 'Next'}
                                </button>
                            </nav>
                        )}
                    </section>
                ) : (
                    <section className="support-faq-card">
                        <h2>{isZh ? '常见问题' : 'Frequently asked questions'}</h2>
                        <p>
                            {channels.length
                                ? isZh
                                    ? '商家暂未发布常见问题，可通过客服联系方式咨询。'
                                    : 'No FAQs have been published. Please use the support channels to get help.'
                                : isZh
                                  ? '商家暂未发布常见问题。'
                                  : 'No FAQs have been published.'}
                        </p>
                    </section>
                )}
            </div>

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
                            <SafeImage
                                key={qrImageRetryKey}
                                src={qrChannel.item.imageUrl}
                                alt={isZh ? '微信客服二维码' : 'WeChat support QR code'}
                                errorFallback={
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
                                }
                            />
                        </div>
                        <p>{isZh ? '长按保存或使用微信扫一扫' : 'Save the code or scan it with WeChat'}</p>
                        {typeof qrChannel.item.settings?.supportAccount === 'string' ? (
                            <SupportQrAccount
                                key={qrChannel.item.settings.supportAccount}
                                account={qrChannel.item.settings.supportAccount}
                                language={language}
                            />
                        ) : null}
                        <a
                            className="support-qr-save"
                            href={qrChannel.item.imageUrl}
                            download
                            target="_blank"
                            rel="noreferrer"
                        >
                            {isZh ? '保存二维码' : 'Save QR code'}
                        </a>
                    </div>
                </Sheet>
            ) : null}
        </SubpageBody>
    );
}

function SupportQrAccount({ account, language }: { account: string; language: StorefrontLanguage }) {
    const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
    const isZh = language === 'zh';
    const wechatId = account.trim();
    if (!wechatId) return null;

    const copyAccount = async () => {
        setCopyState('copying');
        try {
            await navigator.clipboard.writeText(wechatId);
            setCopyState('copied');
        } catch {
            setCopyState('failed');
        }
    };
    const result =
        copyState === 'copied'
            ? isZh
                ? '微信号已复制'
                : 'WeChat ID copied'
            : copyState === 'failed'
              ? isZh
                  ? '复制失败，请长按微信号手动复制'
                  : 'Could not copy. Select the WeChat ID to copy it manually.'
              : '';

    return (
        <>
            <div className="support-qr-account">
                <small>
                    {isZh ? '微信号' : 'WeChat ID'}：{wechatId}
                </small>
                <button
                    type="button"
                    className="support-qr-copy"
                    aria-label={isZh ? '复制微信号' : 'Copy WeChat ID'}
                    disabled={copyState === 'copying'}
                    onClick={() => void copyAccount()}
                >
                    {copyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {copyState === 'copied' ? (isZh ? '已复制' : 'Copied') : isZh ? '复制' : 'Copy'}
                </button>
            </div>
            <span
                className={copyState === 'failed' ? 'support-qr-copy-result' : 'sr-only'}
                role="status"
                aria-live="polite"
            >
                {result}
            </span>
        </>
    );
}

export function filterSupportFaqs<
    T extends { questionZh: string; answerZh: string; questionEn: string; answerEn: string },
>(items: T[], query: string, language: StorefrontLanguage): T[] {
    const term = query.trim().toLocaleLowerCase();
    return term
        ? items.filter(item =>
              (language === 'zh'
                  ? `${item.questionZh} ${item.answerZh}`
                  : `${item.questionEn} ${item.answerEn}`
              )
                  .toLocaleLowerCase()
                  .includes(term),
          )
        : items;
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
    const [savedReview, setSavedReview] = useState<CustomerServiceReviewRecord | null>(null);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(Boolean(api));
    const [loadError, setLoadError] = useState('');
    const [rating, setRating] = useState(0);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [comment, setComment] = useState('');
    const [submitted, setSubmitted] = useState(false);
    useEffect(() => {
        let active = true;
        const visitorId = storefrontVisitorId();
        if (!api || !visitorId) return;
        setLoadError('');
        setLoading(true);
        void api.contentReviewsApi
            .currentCustomerServiceReview(visitorId, orderCode)
            .then(review => {
                if (!active) return;
                setSavedReview(review);
                setSubmitted(Boolean(review));
                if (review) {
                    setRating(review.rating);
                    setSelectedTags(review.tags);
                    setComment(review.comment);
                }
            })
            .catch(() => {
                if (active)
                    setLoadError(
                        isZh ? '评价读取失败，请刷新后重试' : 'Unable to load feedback. Please refresh.',
                    );
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [api, customerId, orderCode, isZh]);

    const tags = ['响应迅速', '态度热情', '耐心专业', '问题已解决', '处理高效'];
    const tagLabels: Record<string, string> = {
        响应迅速: 'Fast response',
        态度热情: 'Friendly',
        耐心专业: 'Professional',
        问题已解决: 'Problem solved',
        处理高效: 'Efficient',
    };

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

    const toggleTag = (tag: string) => {
        setSelectedTags(prev => (prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const visitorId = storefrontVisitorId();
        if (!api || !visitorId || saving || loading) return;
        if (orderCode && !customerId) {
            onSignIn?.();
            setLoadError(isZh ? '请登录后评价关联订单' : 'Sign in to rate an order.');
            return;
        }
        if (rating < 1 || rating > 5) {
            setLoadError(isZh ? '请先选择服务评分' : 'Choose a service rating.');
            return;
        }
        setSaving(true);
        setLoadError('');
        try {
            const review = await api.contentReviewsApi.submitCustomerServiceReview({
                id: savedReview?.id,
                visitorId,
                rating,
                tags: selectedTags,
                comment,
                orderCode,
            });
            setSavedReview(review);
            setSubmitted(true);
            onNotify?.(
                isZh
                    ? '感谢您的评价，我们将持续优化服务质量！'
                    : 'Thank you! Your feedback has been recorded.',
            );
        } catch (error) {
            setLoadError(
                storefrontErrorMessage(
                    error,
                    isZh ? 'zh' : 'en',
                    isZh ? '评价提交失败，请稍后重试' : 'Unable to submit feedback. Please try again.',
                ),
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
            {loadError && (
                <p role="alert" className="support-evaluation-error">
                    {loadError}
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
                    {loadError && <p role="alert">{loadError}</p>}
                    {!api && <p role="status">{isZh ? '评价服务暂不可用' : 'Feedback is unavailable'}</p>}
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
                    {loadError && <p role="alert">{loadError}</p>}
                    {!api && <p role="status">{isZh ? '评价服务暂不可用' : 'Feedback is unavailable'}</p>}
                    {orderCode ? (
                        <div className="support-evaluation-order-badge">
                            <span>{isZh ? '当前服务订单：' : 'Order: '}</span>
                            <b>{orderCode}</b>
                        </div>
                    ) : null}

                    <div className="support-evaluation-options">
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
                                        aria-pressed={star === rating}
                                    >
                                        <Star
                                            size={24}
                                            fill={star <= rating ? 'currentColor' : 'none'}
                                            aria-hidden="true"
                                        />
                                    </button>
                                ))}
                            </div>
                            <span className="support-rating-text">
                                {ratingLabels[rating] || (isZh ? '请选择评分' : 'Choose a rating')}
                            </span>
                        </div>

                        <div className="support-evaluation-tags">
                            {tags.map(tag => {
                                const active = selectedTags.includes(tag);
                                return (
                                    <button
                                        type="button"
                                        key={tag}
                                        className={`support-tag-btn ${active ? 'is-active' : ''}`}
                                        onClick={() => toggleTag(tag)}
                                        aria-pressed={active}
                                    >
                                        {isZh ? tag : tagLabels[tag]}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <textarea
                        className="support-evaluation-textarea"
                        placeholder={
                            isZh
                                ? '请填写您对本次客服服务的建议或体验（选填）'
                                : 'Share details about your customer service experience (optional)'
                        }
                        rows={3}
                        maxLength={2000}
                        value={comment}
                        onChange={e => setComment(e.target.value)}
                    />

                    <button
                        type="submit"
                        className="support-evaluation-submit-btn"
                        disabled={saving || loading || !api}
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
