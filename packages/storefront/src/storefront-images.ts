import accountRecommendationCrest from './assets/storefront/account-recommendation-crest.webp';
import heroAccountServices1440 from './assets/storefront/carousel/colorful-marketplace-v1/account-services-v1-1440.webp';
import heroAccountServices1600 from './assets/storefront/carousel/colorful-marketplace-v1/account-services-v1-1600.webp';
import heroAccountServices32 from './assets/storefront/carousel/colorful-marketplace-v1/account-services-v1-32.webp';
import heroAccountServices480 from './assets/storefront/carousel/colorful-marketplace-v1/account-services-v1-480.webp';
import heroAccountServices960 from './assets/storefront/carousel/colorful-marketplace-v1/account-services-v1-960.webp';
import heroAccountServicesFallback from './assets/storefront/carousel/colorful-marketplace-v1/account-services-v1.png';
import heroCodexTiers1440 from './assets/storefront/carousel/colorful-marketplace-v1/codex-tiers-v1-1440.webp';
import heroCodexTiers1600 from './assets/storefront/carousel/colorful-marketplace-v1/codex-tiers-v1-1600.webp';
import heroCodexTiers32 from './assets/storefront/carousel/colorful-marketplace-v1/codex-tiers-v1-32.webp';
import heroCodexTiers480 from './assets/storefront/carousel/colorful-marketplace-v1/codex-tiers-v1-480.webp';
import heroCodexTiers960 from './assets/storefront/carousel/colorful-marketplace-v1/codex-tiers-v1-960.webp';
import heroCodexTiersFallback from './assets/storefront/carousel/colorful-marketplace-v1/codex-tiers-v1.png';
import heroTokenTopup1440 from './assets/storefront/carousel/colorful-marketplace-v1/token-topup-v1-1440.webp';
import heroTokenTopup1600 from './assets/storefront/carousel/colorful-marketplace-v1/token-topup-v1-1600.webp';
import heroTokenTopup32 from './assets/storefront/carousel/colorful-marketplace-v1/token-topup-v1-32.webp';
import heroTokenTopup480 from './assets/storefront/carousel/colorful-marketplace-v1/token-topup-v1-480.webp';
import heroTokenTopup960 from './assets/storefront/carousel/colorful-marketplace-v1/token-topup-v1-960.webp';
import heroTokenTopupFallback from './assets/storefront/carousel/colorful-marketplace-v1/token-topup-v1.png';
import defaultHero1376 from './assets/storefront/default-hero-1376.webp';
import defaultHero32 from './assets/storefront/default-hero-32.webp';
import defaultHero480 from './assets/storefront/default-hero-480.webp';
import defaultHero960 from './assets/storefront/default-hero-960.webp';
import defaultHeroFallback from './assets/storefront/default-hero.jpg';
import heroGateway1376 from './assets/storefront/hero-01-gateway-1376.webp';
import heroGateway32 from './assets/storefront/hero-01-gateway-32.webp';
import heroGateway480 from './assets/storefront/hero-01-gateway-480.webp';
import heroGateway960 from './assets/storefront/hero-01-gateway-960.webp';
import heroGatewayFallback from './assets/storefront/hero-01-gateway.jpg';
import heroVip1376 from './assets/storefront/hero-02-vip-1376.webp';
import heroVip32 from './assets/storefront/hero-02-vip-32.webp';
import heroVip480 from './assets/storefront/hero-02-vip-480.webp';
import heroVip960 from './assets/storefront/hero-02-vip-960.webp';
import heroVipFallback from './assets/storefront/hero-02-vip.jpg';
import heroCloudBridge1440 from './assets/storefront/hero-cloudbridge-ai-hub-1440.webp';
import heroCloudBridge1600 from './assets/storefront/hero-cloudbridge-ai-hub-1600.webp';
import heroCloudBridge32 from './assets/storefront/hero-cloudbridge-ai-hub-32.webp';
import heroCloudBridge480 from './assets/storefront/hero-cloudbridge-ai-hub-480.webp';
import heroCloudBridge960 from './assets/storefront/hero-cloudbridge-ai-hub-960.webp';
import heroCloudBridgeFallback from './assets/storefront/hero-cloudbridge-ai-hub.jpg';

export interface StaticStorefrontImageSource {
    fallbackSrc: string;
    fallbackSrcSet: string;
    height: number;
    placeholderSrc: string;
    sizes: string;
    webpSrcSet: string;
    width: number;
}

const HERO_SIZES = '(min-width: 1024px) 850px, calc(100vw - 20px)';

function staticSource({
    src,
    srcSet,
    placeholderSrc,
    width,
    height,
    sizes = HERO_SIZES,
}: {
    src: string;
    srcSet: string;
    placeholderSrc: string;
    width: number;
    height: number;
    sizes?: string;
}): StaticStorefrontImageSource {
    return {
        fallbackSrc: src,
        fallbackSrcSet: srcSet,
        height,
        placeholderSrc,
        sizes,
        webpSrcSet: srcSet,
        width,
    };
}

export const HERO_ACCOUNT_SERVICES_IMAGE = heroAccountServices1600;
export const HERO_ACCOUNT_SERVICES_FALLBACK_IMAGE = heroAccountServicesFallback;
export const HERO_CODEX_TIERS_IMAGE = heroCodexTiers1600;
export const HERO_CODEX_TIERS_FALLBACK_IMAGE = heroCodexTiersFallback;
export const HERO_TOKEN_TOPUP_IMAGE = heroTokenTopup1600;
export const HERO_TOKEN_TOPUP_FALLBACK_IMAGE = heroTokenTopupFallback;
export const DEFAULT_HERO_IMAGE = defaultHero1376;
export const DEFAULT_HERO_FALLBACK_IMAGE = defaultHeroFallback;
export const HERO_GATEWAY_IMAGE = heroGateway1376;
export const HERO_GATEWAY_FALLBACK_IMAGE = heroGatewayFallback;
export const HERO_VIP_IMAGE = heroVip1376;
export const HERO_VIP_FALLBACK_IMAGE = heroVipFallback;
export const HERO_CLOUD_BRIDGE_IMAGE = heroCloudBridge1600;
export const HERO_CLOUD_BRIDGE_FALLBACK_IMAGE = heroCloudBridgeFallback;
// Explicit empty-brand fallbacks; historical artwork remains available to published store content.
export const NEUTRAL_STOREFRONT_IMAGE = '/storefront/neutral-store.png';
export const NEUTRAL_STOREFRONT_SOCIAL_IMAGE = '/storefront/neutral-social.png';
export const ACCOUNT_RECOMMENDATION_CREST_IMAGE = accountRecommendationCrest;

const STATIC_IMAGE_SOURCES = new Map<string, StaticStorefrontImageSource>([
    [
        heroTokenTopup1600,
        staticSource({
            src: heroTokenTopupFallback,
            srcSet: `${heroTokenTopup480} 480w, ${heroTokenTopup960} 960w, ${heroTokenTopup1440} 1440w, ${heroTokenTopup1600} 1600w`,
            placeholderSrc: heroTokenTopup32,
            width: 1600,
            height: 900,
        }),
    ],
    [
        heroCodexTiers1600,
        staticSource({
            src: heroCodexTiersFallback,
            srcSet: `${heroCodexTiers480} 480w, ${heroCodexTiers960} 960w, ${heroCodexTiers1440} 1440w, ${heroCodexTiers1600} 1600w`,
            placeholderSrc: heroCodexTiers32,
            width: 1600,
            height: 900,
        }),
    ],
    [
        heroAccountServices1600,
        staticSource({
            src: heroAccountServicesFallback,
            srcSet: `${heroAccountServices480} 480w, ${heroAccountServices960} 960w, ${heroAccountServices1440} 1440w, ${heroAccountServices1600} 1600w`,
            placeholderSrc: heroAccountServices32,
            width: 1600,
            height: 900,
        }),
    ],
    [
        defaultHero1376,
        staticSource({
            src: defaultHero1376,
            srcSet: `${defaultHero480} 480w, ${defaultHero960} 960w, ${defaultHero1376} 1376w`,
            placeholderSrc: defaultHero32,
            width: 1376,
            height: 768,
        }),
    ],
    [
        heroGateway1376,
        staticSource({
            src: heroGateway1376,
            srcSet: `${heroGateway480} 480w, ${heroGateway960} 960w, ${heroGateway1376} 1376w`,
            placeholderSrc: heroGateway32,
            width: 1376,
            height: 768,
        }),
    ],
    [
        heroVip1376,
        staticSource({
            src: heroVip1376,
            srcSet: `${heroVip480} 480w, ${heroVip960} 960w, ${heroVip1376} 1376w`,
            placeholderSrc: heroVip32,
            width: 1376,
            height: 768,
        }),
    ],
    [
        heroCloudBridge1600,
        staticSource({
            src: heroCloudBridge1600,
            srcSet: `${heroCloudBridge480} 480w, ${heroCloudBridge960} 960w, ${heroCloudBridge1440} 1440w, ${heroCloudBridge1600} 1600w`,
            placeholderSrc: heroCloudBridge32,
            width: 1600,
            height: 900,
        }),
    ],
]);

export function staticStorefrontImageSource(source: string): StaticStorefrontImageSource | null {
    return STATIC_IMAGE_SOURCES.get(source) ?? null;
}
