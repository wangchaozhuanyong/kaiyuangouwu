import { useRouter } from '@tanstack/react-router';
import { ChevronRight, Clock3, Headphones, MessageCircle, QrCode } from 'lucide-react';
import { useState } from 'react';

import '../styles/modals-and-support.css';

import qqIcon from '../assets/support/qq.svg';
import telegramIcon from '../assets/support/telegram.svg';
import wechatIcon from '../assets/support/wechat.svg';
import whatsappIcon from '../assets/support/whatsapp.svg';
import { EmptyState, Sheet, Subpage } from '../storefront-ui/page-shell';
import { useStorefront } from '../StorefrontContext';
import {
    StorefrontSupportChannel,
    SupportChannelKey,
    storefrontSupportChannels,
    supportChannelDetail,
    supportServiceDetails,
} from '../support-content';
import { StorefrontContentBlock, StorefrontLanguage } from '../types';

// TODO: Fix internal imports later

interface SupportPageProps {
    content?: StorefrontContentBlock;
    language: StorefrontLanguage;
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
    const { content, language } = useStorefront<SupportPageProps>();
    const isZh = language === 'zh';
    return (
        <Subpage
            title={isZh ? '客服中心' : 'Customer support'}
            language={language}
            onBack={goBack}
            surfaceColor={content?.backgroundColor}
        >
            {content ? (
                <SupportContent content={content} language={language} />
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
    content,
    language,
}: Readonly<{
    content: StorefrontContentBlock;
    language: StorefrontLanguage;
}>) {
    const [qrChannel, setQrChannel] = useState<StorefrontSupportChannel | null>(null);
    const [qrImageFailed, setQrImageFailed] = useState(false);
    const [qrImageRetryKey, setQrImageRetryKey] = useState(0);
    const isZh = language === 'zh';
    const service = supportServiceDetails(content, language);
    const channels = storefrontSupportChannels(content);

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
            <section className="support-hours-card" aria-labelledby="support-hours-title">
                <div className="support-hours-rail" aria-hidden="true">
                    <Clock3 />
                </div>
                <div className="support-hours-main">
                    <div className="support-hours-heading">
                        <h2 id="support-hours-title">{isZh ? '客服服务时间' : 'Customer-service hours'}</h2>
                        <span>{service.days}</span>
                    </div>
                    <strong className="support-hours-time">{service.time}</strong>
                    <i aria-hidden="true" />
                    <div className="support-hours-note">
                        <MessageCircle aria-hidden="true" />
                        <p>{service.note}</p>
                    </div>
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
                                    <img src={icon} alt="" />
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
