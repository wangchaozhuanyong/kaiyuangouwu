import { ArrowLeft, Copy, Expand, Image, Mail, Minimize2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { type IcloudMailItem } from '../../api';
import { Sheet } from '../../storefront-ui/page-shell';
import { type StorefrontLanguage } from '../../types';

import { createMailPreview } from './mail-preview';

function cleanSenderDisplay(fromName?: string, fromAddress?: string): string {
    const raw = (fromName || fromAddress || '').trim();
    if (!raw) return '';
    const match = raw.match(/^"?([^"<]+)"?\s*<.*>$/);
    if (match && match[1].trim()) {
        return match[1].trim();
    }
    return raw.replace(/^"|"$/g, '');
}

export function MailBody({
    mail,
    language,
}: Readonly<{ mail: IcloudMailItem; language: StorefrontLanguage }>) {
    const isZh = language === 'zh';
    const [showImages, setShowImages] = useState(false);
    const [fit, setFit] = useState(true);
    const [fullscreen, setFullscreen] = useState(false);
    const [revision, setRevision] = useState(0);
    const [height, setHeight] = useState(560);
    const [failedImages, setFailedImages] = useState(0);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const preview = useMemo(
        () => createMailPreview(mail.bodyHtml || '', { showImages, fit, isZh }),
        [mail.bodyHtml, showImages, fit, isZh],
    );
    useEffect(() => {
        const receive = (event: MessageEvent) => {
            if (
                event.source !== frameRef.current?.contentWindow ||
                event.data?.type !== 'mail-preview-layout'
            )
                return;
            const measured = event.data.height;
            if (typeof measured !== 'number' || !Number.isFinite(measured) || measured < 0) return;
            setHeight(Math.max(240, Math.min(100_000, measured)));
            const failures = event.data.failedImages;
            setFailedImages(Number.isSafeInteger(failures) && failures >= 0 ? failures : 0);
        };
        window.addEventListener('message', receive);
        return () => window.removeEventListener('message', receive);
    }, []);
    const content = (
        <div className="mail-reader-body">
            <div className="mail-reader-toolbar">
                <button type="button" aria-pressed={fit} onClick={() => setFit(value => !value)}>
                    {fit ? (isZh ? '适应宽度' : 'Fit width') : isZh ? '原始尺寸' : 'Original size'}
                </button>
                {preview.hasRemoteImages && (
                    <button
                        type="button"
                        aria-pressed={showImages}
                        onClick={() => setShowImages(value => !value)}
                    >
                        <Image aria-hidden="true" />
                        {showImages
                            ? isZh
                                ? '隐藏图片'
                                : 'Hide images'
                            : isZh
                              ? '显示邮件图片'
                              : 'Show email images'}
                    </button>
                )}
                <button type="button" onClick={() => setFullscreen(value => !value)}>
                    {fullscreen ? <Minimize2 aria-hidden="true" /> : <Expand aria-hidden="true" />}
                    {fullscreen
                        ? isZh
                            ? '退出全屏'
                            : 'Exit full screen'
                        : isZh
                          ? '全屏阅读'
                          : 'Full screen'}
                </button>
            </div>
            {failedImages > 0 && (
                <div className="mail-image-feedback" role="status">
                    <span>{isZh ? '部分图片暂时无法加载。' : 'Some images are unavailable.'}</span>
                    <button
                        type="button"
                        onClick={() => {
                            setFailedImages(0);
                            setRevision(value => value + 1);
                        }}
                    >
                        <RefreshCw aria-hidden="true" />
                        {isZh ? '重试图片' : 'Retry images'}
                    </button>
                </div>
            )}
            <div className="mail-body-content">
                {mail.bodyHtml ? (
                    <iframe
                        key={revision}
                        ref={frameRef}
                        title={isZh ? '邮件正文' : 'Email content'}
                        className="mail-iframe"
                        srcDoc={preview.html}
                        style={{ height }}
                        referrerPolicy="no-referrer"
                        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                    />
                ) : (
                    <pre>{mail.bodyText || (isZh ? '此邮件无正文内容' : 'This email has no content')}</pre>
                )}
            </div>
        </div>
    );
    return fullscreen ? (
        <Sheet
            title={mail.subject || (isZh ? '邮件正文' : 'Email content')}
            language={language}
            className="mail-reading-sheet"
            onClose={() => setFullscreen(false)}
        >
            {content}
        </Sheet>
    ) : (
        content
    );
}

export function MailReader({
    items,
    language,
    copiedCode,
    onCopy,
    formatTime,
}: Readonly<{
    items: IcloudMailItem[];
    language: StorefrontLanguage;
    copiedCode: string | null;
    onCopy: (code: string) => void;
    formatTime: (time: string) => string;
}>) {
    const isZh = language === 'zh';
    const [selectedId, setSelectedId] = useState<string>(items[0].id);
    const [mobileReading, setMobileReading] = useState(false);
    const selected = items.find(item => item.id === selectedId) ?? items[0];
    const title = selected.subject || (isZh ? '无主题' : 'No subject');
    return (
        <div className="mail-reader" data-mobile-reading={mobileReading}>
            <div className="mail-reader-list" aria-label={isZh ? '最近邮件' : 'Recent emails'}>
                {items.map(mail => (
                    <button
                        type="button"
                        key={mail.id}
                        aria-current={mail.id === selected.id ? 'true' : undefined}
                        onClick={() => {
                            setSelectedId(mail.id);
                            setMobileReading(true);
                        }}
                    >
                        <span className="mail-reader-list-meta">
                            <strong>
                                {cleanSenderDisplay(mail.fromName, mail.fromAddress) || mail.fromAddress}
                            </strong>
                            <time>{formatTime(mail.receivedAt)}</time>
                        </span>
                        <span className="mail-reader-list-preview">
                            <span className="mail-reader-list-subject">
                                {mail.subject || (isZh ? '无主题' : 'No subject')}
                            </span>
                            {mail.extractedCode && (
                                <span className="mail-list-code">{mail.extractedCode}</span>
                            )}
                        </span>
                    </button>
                ))}
            </div>
            <article className="mail-reader-message">
                <button className="mail-reader-back" type="button" onClick={() => setMobileReading(false)}>
                    <ArrowLeft aria-hidden="true" />
                    {isZh ? '返回邮件列表' : 'Back to emails'}
                </button>
                <header className="mail-reader-message-header">
                    <h2>{title}</h2>
                    <div className="mail-reader-sender">
                        <Mail aria-hidden="true" />
                        <span>{selected.fromName || selected.fromAddress}</span>
                        <time>{formatTime(selected.receivedAt)}</time>
                    </div>
                </header>
                {selected.extractedCode && (
                    <div className="otp-banner">
                        <div className="otp-info">
                            <span className="otp-title">{isZh ? '提取到的验证码' : 'Verification code'}</span>
                            <span className="otp-code-text">{selected.extractedCode}</span>
                        </div>
                        <button
                            type="button"
                            className="otp-copy-btn"
                            onClick={() => onCopy(selected.extractedCode || '')}
                        >
                            <Copy aria-hidden="true" />
                            {copiedCode === selected.extractedCode
                                ? isZh
                                    ? '已复制'
                                    : 'Copied'
                                : isZh
                                  ? '一键复制'
                                  : 'Copy'}
                        </button>
                    </div>
                )}
                <MailBody key={selected.id} mail={selected} language={language} />
            </article>
        </div>
    );
}
