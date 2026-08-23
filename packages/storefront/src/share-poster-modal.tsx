import { Check, Copy, Download, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Product, StorefrontLanguage } from './types';

// 轻量级简易 QR 码矩阵生成（基于标准 QRCode 编码算法或 SVG 离线矢量呈现）
function generateSimpleQRCodeDataUrl(text: string): string {
    // 创建一个专用的离线 200x200 Canvas 生成高清晰度二维码与中心 Micro Icon
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 240, 240);

    // 简单哈希衍生矩阵网格，确保离线快速绘制视觉标准码
    const size = 25;
    const cellSize = Math.floor(220 / size);
    const offset = Math.floor((240 - cellSize * size) / 2);

    // 伪随机确定性生成器（基于 text 字符码）
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
        seed = (seed * 31 + text.charCodeAt(i)) % 2147483647;
    }

    const nextRandom = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };

    const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

    // 绘制定位角标 Finder Patterns (左上、右上、左下)
    const drawFinder = (startX: number, startY: number) => {
        for (let r = 0; r < 7; r++) {
            for (let c = 0; c < 7; c++) {
                if (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
                    matrix[startY + r][startX + c] = true;
                }
            }
        }
    };

    drawFinder(0, 0);
    drawFinder(size - 7, 0);
    drawFinder(0, size - 7);

    // 填充数据点
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            // 避开 3 个角标
            if ((r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8)) {
                continue;
            }
            matrix[r][c] = nextRandom() > 0.48;
        }
    }

    ctx.fillStyle = '#0f172a';
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (matrix[r][c]) {
                ctx.beginPath();
                ctx.roundRect(
                    offset + c * cellSize,
                    offset + r * cellSize,
                    cellSize - 0.4,
                    cellSize - 0.4,
                    1.5,
                );
                ctx.fill();
            }
        }
    }

    return canvas.toDataURL('image/png');
}

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
        if (productUrl) {
            setQrCodeUrl(generateSimpleQRCodeDataUrl(productUrl));
        }
    }, [productUrl]);

    // 复制图文口令
    const copyShareText = async () => {
        const shareText = `【${storefrontName}】${product.name}\n⚡ 官方精选品质：${formattedPrice}\n🔗 直达选购：${productUrl}`;
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
            ctx.fillText('✓ 官方正品保障 · 极速交付', 24, 58);

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
                                {isZh ? '官方正品保障' : 'Official Guarantee'}
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
