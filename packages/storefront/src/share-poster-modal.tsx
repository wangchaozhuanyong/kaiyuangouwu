// organize-imports-ignore -- Preserve ESLint import groups and CSS side-effect order.
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { isArtworkPosterDesign, type PosterQrStyle } from '../../common/src/referral-poster-design';

import { ShopApi } from './api';
import { SharePosterSurface } from './components/common/share-poster-surface';
import { languageCodeFor } from './i18n';
import { storefrontInitialQueryError } from './loading-state';
import { Overlay } from './overlay-host';
import { createCircularQrSvgDataUrl } from './poster-qr';
import { productImage } from './product-media';
import { PUBLIC_QUERY_GC_TIME, ROUTE_QUERY_STALE_TIME, storefrontQueryKeys } from './query-client';
import { storefrontWebpUrl } from './responsive-image';
import './styles/modals-and-support.css';
import { MarketConfig, Product, ReferralProgram, StorefrontLanguage } from './types';

export function productPosterQrStyle(program: ReferralProgram | undefined): PosterQrStyle {
    if (!program) return 'minimal';
    const template = [
        ...(program.systemPosterTemplateConfigs ?? []).filter(item =>
            program.posterTemplates.includes(item.id),
        ),
        ...(program.posterTemplateConfigs ?? []),
    ].find(item => item.enabled && item.id === program.defaultPosterTemplate);
    return isArtworkPosterDesign(template?.design) ? template.design.qr.style : 'minimal';
}

function loadPosterImage(source: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        if (!source.startsWith('data:')) image.crossOrigin = 'anonymous';
        const timer = setTimeout(() => reject(new Error('Poster image timed out')), 15000);
        image.onload = () => {
            clearTimeout(timer);
            if (image.naturalWidth > 0) resolve(image);
            else reject(new Error('Poster image unavailable'));
        };
        image.onerror = () => {
            clearTimeout(timer);
            reject(new Error('Poster image unavailable'));
        };
        image.src = source;
    });
}

export function SharePosterModal({
    api,
    market,
    product,
    storefrontName,
    logoUrl,
    language,
    formattedPrice,
    onClose,
    onNotify,
    embedded = false,
}: {
    api: ShopApi;
    market: MarketConfig;
    product: Product;
    storefrontName: string;
    logoUrl: string | null;
    language: StorefrontLanguage;
    formattedPrice: string;
    onClose: () => void;
    onNotify: (msg: string) => void;
    embedded?: boolean;
}) {
    const isZh = language === 'zh';
    const posterRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [qrAttempt, setQrAttempt] = useState(0);
    const [qrImage, setQrImage] = useState<{ source: string; attempt: number; ready: boolean } | null>(null);
    const exportBusy = useRef(false);
    const exportOwner = useRef('');
    const programQuery = useQuery({
        queryKey: storefrontQueryKeys.referralProgram(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
        ),
        queryFn: ({ signal }) => api.referralProgram(signal),
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });

    const productUrl = typeof window !== 'undefined' ? window.location.href : '';
    const mainImageSource = productImage(product);
    const mainImage = mainImageSource ? storefrontWebpUrl(mainImageSource, 'detail') : '';
    const qrStyle = productPosterQrStyle(programQuery.data);
    const configReady = programQuery.data !== undefined;
    const qr = useMemo(() => {
        if (!configReady || !productUrl) return { source: '', error: false };
        try {
            return { source: createCircularQrSvgDataUrl(productUrl, qrStyle, 480), error: false };
        } catch {
            return { source: '', error: true };
        }
    }, [configReady, productUrl, qrStyle, qrAttempt]);
    const imageMatches = qrImage?.source === qr.source && qrImage?.attempt === qrAttempt;
    const qrReady = Boolean(qr.source && imageMatches && qrImage?.ready);
    const qrError =
        storefrontInitialQueryError(programQuery, language) ||
        (qr.error || (imageMatches && !qrImage?.ready)
            ? isZh
                ? '二维码生成失败，请重试'
                : 'Could not prepare the QR code. Please retry.'
            : '');
    useEffect(() => {
        if (!qr.source || qrReady || qrError) return;
        const timer = setTimeout(() => {
            setQrImage({ source: qr.source, attempt: qrAttempt, ready: false });
        }, 15000);
        return () => clearTimeout(timer);
    }, [qr.source, qrAttempt, qrReady, qrError]);
    exportOwner.current = JSON.stringify([
        storefrontQueryKeys.market(market),
        language,
        product.id,
        productUrl,
        qr.source,
    ]);
    useEffect(
        () => () => {
            exportOwner.current = '';
        },
        [],
    );

    const retryQr = () => {
        setQrImage(null);
        setQrAttempt(attempt => attempt + 1);
        if (!configReady) void programQuery.refetch({ cancelRefetch: false });
    };

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
        if (!qrReady || exportBusy.current) return;
        exportBusy.current = true;
        const owner = exportOwner.current;
        setDownloading(true);
        try {
            // The displayed SVG is also the export source; a failed code can never produce a saved poster.
            const qrImg = await loadPosterImage(qr.source);
            const canvas = document.createElement('canvas');
            const scale = 4;
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
            const img = mainImage ? await loadPosterImage(mainImage).catch(() => null) : null;

            // 绘制商品图 (带圆角和阴影)
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(24, 76, 312, 240, 12);
            ctx.clip();
            if (img) {
                const fit = Math.min(312 / img.naturalWidth, 240 / img.naturalHeight);
                const width = img.naturalWidth * fit;
                const height = img.naturalHeight * fit;
                ctx.drawImage(img, 24 + (312 - width) / 2, 76 + (240 - height) / 2, width, height);
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
            ctx.drawImage(qrImg, 216, 396, 120, 120);

            ctx.fillStyle = '#64748b';
            ctx.font = '12px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            ctx.fillText(isZh ? '扫码直达选购' : 'Scan to explore', 24, 450);

            ctx.fillStyle = '#94a3b8';
            ctx.font = '11px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            ctx.fillText(isZh ? '查看商品详情' : 'View product details', 24, 470);

            // 触发下载
            if (exportOwner.current !== owner) return;
            const dataUrl = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.download = `${product.name}-海报.png`;
            link.href = dataUrl;
            link.click();

            onNotify(isZh ? '海报图片已生成并保存' : 'Poster saved');
        } catch {
            onNotify(isZh ? '海报生成失败，请使用口令分享' : 'Could not export poster');
        } finally {
            exportBusy.current = false;
            setDownloading(false);
        }
    };

    const content = (
        <SharePosterSurface
            product={product}
            storefrontName={storefrontName}
            logoUrl={logoUrl}
            language={language}
            formattedPrice={formattedPrice}
            previewRef={posterRef}
            qrCodeUrl={qr.source}
            qrReady={qrReady}
            qrError={qrError}
            qrAttempt={qrAttempt}
            onQrLoad={() => setQrImage({ source: qr.source, attempt: qrAttempt, ready: true })}
            onQrError={() => setQrImage({ source: qr.source, attempt: qrAttempt, ready: false })}
            onQrRetry={retryQr}
            copied={copied}
            downloading={downloading}
            onDownload={() => void downloadPoster()}
            onCopy={() => void copyShareText()}
        />
    );
    if (embedded) return content;
    return (
        <Overlay className="poster-modal-overlay" onClick={onClose} onClose={onClose}>
            <div
                className="poster-modal-card"
                onClick={event => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={isZh ? '分享海报' : 'Share poster'}
            >
                <button
                    type="button"
                    className="poster-close-btn"
                    onClick={onClose}
                    aria-label={isZh ? '关闭' : 'Close'}
                >
                    <X size={18} />
                </button>
                {content}
            </div>
        </Overlay>
    );
}
