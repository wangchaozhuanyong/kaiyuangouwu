import { Check, Copy, Download, Sparkles, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';

import { Product, StorefrontLanguage } from './types';

export function SharePosterModal({
    product,
    storefrontName,
    logoUrl,
    language,
    formattedPrice,
    onClose,
    onNotify,
}: {
    product: Product;
    storefrontName: string;
    logoUrl: string | null;
    language: StorefrontLanguage;
    formattedPrice: string;
    onClose: () => void;
    onNotify: (msg: string) => void;
}) {
    const isZh = language === 'zh';
    const posterRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [qrCodeUrl, setQrCodeUrl] = useState('');

    const productUrl = typeof window !== 'undefined' ? window.location.href : '';
    const mainImage = product.featuredAsset?.preview ?? product.assets[0]?.preview ?? '';

    useEffect(() => {
        if (!productUrl) return;
        let cancelled = false;
        void QRCode.toDataURL(productUrl, {
            width: 240,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: { dark: '#0f172a', light: '#ffffff' },
        })
            .then(url => {
                if (!cancelled) setQrCodeUrl(url);
            })
            .catch(() => {
                if (!cancelled) setQrCodeUrl('');
            });
        return () => {
            cancelled = true;
        };
    }, [productUrl]);

    // 复制图文口令
    const copyShareText = async () => {
        const shareText = isZh
            ? `【${storefrontName}】${product.name}\n价格：${formattedPrice}\n商品链接：${productUrl}`
            : `[${storefrontName}] ${product.name}\nPrice: ${formattedPrice}\nProduct link: ${productUrl}`;
        try {
            await navigator.clipboard.writeText(shareText);
            setCopied(true);
            onNotify(isZh ? '商品口令已复制，可直接粘贴分享' : 'Share text copied');
            setTimeout(() => setCopied(false), 2000);
        } catch {
            onNotify(isZh ? '复制失败，请手动长按复制' : 'Failed to copy');
        }
    };

    // 保存海报图片 (Canvas 离线高精度绘制与下载)
    const downloadPoster = async () => {
        setDownloading(true);
        try {
            const canvas = document.createElement('canvas');
            const scale = 2; // 2x 视网膜高清导出
            canvas.width = 360 * scale;
            canvas.height = 540 * scale;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas context unavailable');

            ctx.scale(scale, scale);

            // 1. 渐变背景与圆角卡片
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 360, 540);

            // 顶部渐变装饰底
            const grad = ctx.createLinearGradient(0, 0, 360, 100);
            grad.addColorStop(0, '#f8fafc');
            grad.addColorStop(1, '#ffffff');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 360, 100);

            // 2. 品牌 Header
            ctx.fillStyle = '#0f172a';
            ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            ctx.fillText(storefrontName, 24, 40);

            ctx.fillStyle = '#10b981';
            ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            ctx.fillText(isZh ? '✓ 商品信息 · 扫码直达' : '✓ Product details · Scan to view', 24, 58);

            // 3. 商品大图
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = mainImage;

            await new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
            });

            // 绘制商品图 (带圆角和阴影)
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(24, 76, 312, 240, 12);
            ctx.clip();
            if (img.complete && img.naturalWidth > 0) {
                ctx.drawImage(img, 24, 76, 312, 240);
            } else {
                ctx.fillStyle = '#f1f5f9';
                ctx.fillRect(24, 76, 312, 240);
            }
            ctx.restore();

            // 4. 价格与商品名称
            ctx.fillStyle = '#d33c30';
            ctx.font = 'bold 22px "Inter", -apple-system, sans-serif';
            ctx.fillText(formattedPrice, 24, 348);

            ctx.fillStyle = '#0f172a';
            ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            const displayName = product.name.length > 20 ? product.name.slice(0, 20) + '...' : product.name;
            ctx.fillText(displayName, 24, 376);

            // 5. 底部二维码与扫码指引
            if (qrCodeUrl) {
                const qrImg = new Image();
                qrImg.src = qrCodeUrl;
                await new Promise(resolve => {
                    qrImg.onload = resolve;
                    qrImg.onerror = resolve;
                });
                ctx.drawImage(qrImg, 246, 420, 90, 90);
            }

            ctx.fillStyle = '#64748b';
            ctx.font = '12px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            ctx.fillText('长按识别或扫码直达', 24, 456);

            ctx.fillStyle = '#94a3b8';
            ctx.font = '11px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            ctx.fillText('探索更多优质好物', 24, 476);

            // 触发下载
            const dataUrl = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.download = `${product.name}-海报.png`;
            link.href = dataUrl;
            link.click();

            onNotify(isZh ? '海报图片已生成并保存' : 'Poster saved');
        } catch {
            onNotify(isZh ? '海报生成失败，请使用口令分享' : 'Could not export poster');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="poster-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
            <div className="poster-modal-card" onClick={e => e.stopPropagation()}>
                <button
                    type="button"
                    className="poster-close-btn"
                    onClick={onClose}
                    aria-label={isZh ? '关闭' : 'Close'}
                >
                    <X size={18} />
                </button>

                <div className="poster-preview-wrapper" ref={posterRef}>
                    <div className="poster-brand-row">
                        {logoUrl ? (
                            <img className="poster-brand-logo" src={logoUrl} alt={storefrontName} />
                        ) : null}
                        <div className="poster-brand-info">
                            <span className="poster-brand-name">{storefrontName}</span>
                            <span className="poster-brand-trust">
                                <Sparkles size={11} />
                                {isZh ? '商品分享' : 'Product share'}
                            </span>
                        </div>
                    </div>

                    <div className="poster-image-box">
                        {mainImage ? (
                            <img src={mainImage} alt={product.name} crossOrigin="anonymous" />
                        ) : (
                            <div className="poster-image-fallback" />
                        )}
                    </div>

                    <div className="poster-info-row">
                        <div className="poster-price-badge">{formattedPrice}</div>
                        <h3 className="poster-title">{product.name}</h3>
                    </div>

                    <div className="poster-footer-row">
                        <div className="poster-scan-prompt">
                            <strong>{isZh ? '扫码直达选购' : 'Scan to explore'}</strong>
                            <small>{isZh ? '支持微信 / 浏览器扫码' : 'WeChat / Browser direct scan'}</small>
                        </div>
                        {qrCodeUrl && <img className="poster-qrcode" src={qrCodeUrl} alt="QR Code" />}
                    </div>
                </div>

                <div className="poster-actions-row">
                    <button
                        type="button"
                        className="poster-action-btn primary"
                        onClick={() => void downloadPoster()}
                        disabled={downloading}
                    >
                        <Download size={16} />
                        <span>
                            {downloading
                                ? isZh
                                    ? '正在生成...'
                                    : 'Generating...'
                                : isZh
                                  ? '保存海报图片'
                                  : 'Save poster'}
                        </span>
                    </button>
                    <button
                        type="button"
                        className="poster-action-btn secondary"
                        onClick={() => void copyShareText()}
                    >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        <span>
                            {copied ? (isZh ? '已复制' : 'Copied') : isZh ? '复制图文口令' : 'Copy text'}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
}
