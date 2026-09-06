import { Package } from 'lucide-react';
import { useState } from 'react';

import { productGalleryAssets } from '../product-media';
import { Asset, Product, StorefrontLanguage } from '../types';

import { prefetchStorefrontImage, SafeImage, scheduleIdleWork } from './product-display';

export function ProductGallery({ product, language }: { product: Product; language: StorefrontLanguage }) {
    const assets = productGalleryAssets(product);
    // Reset only gallery state when navigating or when Vendure changes the media, not on data refetches.
    const identity = JSON.stringify([product.id, assets.map(asset => [asset.id, asset.preview])]);
    return <GalleryImages key={identity} assets={assets} productName={product.name} language={language} />;
}

function GalleryImages({
    assets,
    productName,
    language,
}: {
    assets: Asset[];
    productName: string;
    language: StorefrontLanguage;
}) {
    const [activeImage, setActiveImage] = useState(0);
    const isZh = language === 'zh';
    const prefetchAdjacentGalleryImages = () => {
        scheduleIdleWork(() => {
            for (const index of [activeImage - 1, activeImage + 1]) {
                const asset = assets[index];
                if (asset) prefetchStorefrontImage(asset.preview, 'detail');
            }
        });
    };

    return (
        <section className="detail-gallery">
            {assets[activeImage] ? (
                <SafeImage
                    src={assets[activeImage].preview}
                    alt={`${productName} ${activeImage + 1}`}
                    imageKind="detail"
                    loading="eager"
                    fetchPriority="high"
                    onLoad={prefetchAdjacentGalleryImages}
                />
            ) : (
                <div className="image-placeholder" aria-hidden="true">
                    <Package />
                </div>
            )}
            {assets.length > 1 && (
                <div className="gallery-dots">
                    {assets.map((asset, index) => (
                        <button
                            type="button"
                            key={asset.id}
                            className={index === activeImage ? 'is-active' : undefined}
                            onClick={() => setActiveImage(index)}
                            aria-label={
                                isZh ? `查看第${index + 1}张商品图` : `View product image ${index + 1}`
                            }
                            aria-current={index === activeImage}
                        />
                    ))}
                </div>
            )}
            {!!assets.length && (
                <span className="gallery-count">
                    {activeImage + 1} / {assets.length}
                </span>
            )}
        </section>
    );
}
