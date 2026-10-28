import { type PublicSeoDocument } from '../../../storefront-content-plugin/src/shared/public-seo';
import { NEUTRAL_STOREFRONT_SOCIAL_IMAGE } from '../storefront-images';
import { type RouteName } from '../storefront-router';
import { productImage, setMetaContent } from '../storefront-utils';
import { type Product } from '../types';

export type SecondaryMetadata =
    | { publicSeo: PublicSeoDocument; storefrontName: string; isZh: boolean }
    | {
          route: { name: RouteName };
          storefrontName: string;
          title: string;
          description: string;
          product: Product | null | undefined;
          logoUrl: string | null;
          isZh: boolean;
          canonical: string;
      };

/** Only the validated, still-current document effect may call this optional writer. */
export function applySecondaryMetadata(input: SecondaryMetadata, documentUrl: string) {
    if ('publicSeo' in input) {
        const { publicSeo, storefrontName, isZh } = input;
        const share = publicSeo as PublicSeoDocument & { shareTitle?: string; shareDescription?: string };
        const shareTitle = share.shareTitle || publicSeo.title;
        const shareDescription = share.shareDescription || publicSeo.description;
        setMetaContent('meta[property="og:site_name"]', storefrontName);
        setMetaContent('meta[property="og:type"]', 'website');
        setMetaContent('meta[property="og:title"]', shareTitle);
        setMetaContent('meta[property="og:description"]', shareDescription);
        setMetaContent('meta[property="og:url"]', publicSeo.canonical);
        setMetaContent('meta[property="og:locale"]', isZh ? 'zh_CN' : 'en');
        setMetaContent('meta[name="twitter:title"]', shareTitle);
        setMetaContent('meta[name="twitter:description"]', shareDescription);
        setMetaContent('meta[name="twitter:card"]', publicSeo.image ? 'summary_large_image' : 'summary');
        if (publicSeo.image) {
            setMetaContent('meta[property="og:image"]', publicSeo.image);
            setMetaContent('meta[name="twitter:image"]', publicSeo.image);
        } else {
            document.querySelector('meta[property="og:image"]')?.remove();
            document.querySelector('meta[name="twitter:image"]')?.remove();
            document.querySelector('meta[property="og:image:alt"]')?.remove();
            document.querySelector('meta[name="twitter:image:alt"]')?.remove();
        }
        for (const alternate of publicSeo.alternates) {
            const link = document.createElement('link');
            link.rel = 'alternate';
            link.hreflang = alternate.language;
            link.href = alternate.href;
            document.head.append(link);
        }
        for (const data of publicSeo.structuredData) {
            const script = document.createElement('script');
            script.type = 'application/ld+json';
            script.dataset.storefrontSeo = '';
            script.textContent = JSON.stringify(data);
            document.head.append(script);
        }
    } else {
        const { route, storefrontName, title, description, product, logoUrl, isZh, canonical } = input;
        const imagePath = storefrontShareImage(route.name, product, logoUrl);
        const image = new URL(imagePath, documentUrl).href;
        const imageAlt =
            route.name === 'product' && product
                ? product.name
                : isZh
                  ? `${storefrontName}精选商品`
                  : `Featured products from ${storefrontName}`;
        setMetaContent('meta[property="og:type"]', route.name === 'product' ? 'product' : 'website');
        setMetaContent('meta[property="og:site_name"]', storefrontName);
        setMetaContent('meta[property="og:title"]', title);
        setMetaContent('meta[property="og:description"]', description);
        setMetaContent('meta[property="og:image"]', image);
        document.querySelector('meta[property="og:image:width"]')?.remove();
        document.querySelector('meta[property="og:image:height"]')?.remove();
        setMetaContent('meta[property="og:image:alt"]', imageAlt);
        setMetaContent('meta[property="og:url"]', canonical);
        setMetaContent('meta[name="twitter:title"]', title);
        setMetaContent('meta[name="twitter:description"]', description);
        setMetaContent('meta[name="twitter:image"]', image);
        setMetaContent('meta[name="twitter:image:alt"]', imageAlt);
    }
}

export function storefrontShareImage(
    route: RouteName,
    product: Product | null | undefined,
    logoUrl: string | null,
): string {
    return (route === 'product' ? productImage(product) : null) || logoUrl || NEUTRAL_STOREFRONT_SOCIAL_IMAGE;
}
