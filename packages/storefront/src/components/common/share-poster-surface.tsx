// organize-imports-ignore -- Preserve ESLint type groups and CSS side-effect order.
import type { Product, StorefrontLanguage } from '../../types';
import { Check, Copy, Download, Sparkles } from 'lucide-react';
import type { RefObject } from 'react';

import { productImage } from '../../product-media';
import { storefrontWebpUrl } from '../../responsive-image';
import '../../styles/modals-and-support.css';

export interface SharePosterSurfaceProps {
    product: Product;
    storefrontName: string;
    logoUrl: string | null;
    language: StorefrontLanguage;
    formattedPrice: string;
    pending?: boolean;
    previewRef?: RefObject<HTMLDivElement | null>;
    qrCodeUrl?: string;
    qrReady?: boolean;
    qrError?: string;
    qrAttempt?: number;
    onQrLoad?: () => void;
    onQrError?: () => void;
    onQrRetry?: () => void;
    copied?: boolean;
    downloading?: boolean;
    onDownload?: () => void;
    onCopy?: () => void;
}
/** One preview/action layout owns both module waiting and the working poster. */
export function SharePosterSurface({
    product,
    storefrontName,
    logoUrl,
    language,
    formattedPrice,
    pending = false,
    previewRef,
    qrCodeUrl = '',
    qrReady = false,
    qrError = '',
    qrAttempt = 0,
    onQrLoad,
    onQrError,
    onQrRetry,
    copied = false,
    downloading = false,
    onDownload,
    onCopy,
}: SharePosterSurfaceProps) {
    const isZh = language === 'zh';
    const image = productImage(product);
    const mainImage = image ? storefrontWebpUrl(image, 'detail') : '';
    const storefrontLogo = logoUrl ? storefrontWebpUrl(logoUrl, 'thumbnail') : '';
    return (
        <>
            {pending && (
                <span role="status" className="visually-hidden">
                    {isZh ? '正在加载分享海报…' : 'Loading share poster…'}
                </span>
            )}
            <div className="poster-preview-wrapper" ref={previewRef}>
                <div className="poster-brand-row">
                    {storefrontLogo ? (
                        <img className="poster-brand-logo" src={storefrontLogo} alt={storefrontName} />
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
                    {qrCodeUrl ? (
                        <img
                            key={`${qrAttempt}:${qrCodeUrl}`}
                            className="poster-qrcode"
                            src={qrCodeUrl}
                            alt={isZh ? '商品二维码' : 'Product QR code'}
                            onLoad={onQrLoad}
                            onError={onQrError}
                        />
                    ) : (
                        <span className="poster-qrcode" aria-hidden="true" />
                    )}
                </div>
            </div>

            {!pending && !qrReady && (
                <div className="poster-qr-status" role={qrError ? 'alert' : 'status'}>
                    <span>{qrError || (isZh ? '正在准备二维码…' : 'Preparing QR code…')}</span>
                    {qrError && onQrRetry && (
                        <button type="button" onClick={onQrRetry}>
                            {isZh ? '重试' : 'Retry'}
                        </button>
                    )}
                </div>
            )}

            <div className="poster-actions-row">
                <button
                    type="button"
                    className="poster-action-btn primary"
                    onClick={onDownload}
                    disabled={pending || !qrReady || downloading}
                    aria-busy={downloading || (!pending && !qrReady && !qrError)}
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
                    disabled={pending}
                    className="poster-action-btn secondary"
                    onClick={onCopy}
                >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    <span>{copied ? (isZh ? '已复制' : 'Copied') : isZh ? '复制图文口令' : 'Copy text'}</span>
                </button>
            </div>
        </>
    );
}
