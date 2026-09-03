import { request } from '@playwright/test';

const PROMOTION_ENTRY_MAX_ATTEMPTS = 3;
const TRANSIENT_PROMOTION_STATUSES = new Set([429, 502, 503, 504]);

class TransientPromotionEntryError extends Error {}

async function requestPromotionAccessCookie(api: Awaited<ReturnType<typeof request.newContext>>) {
    const promoResponse = await api.get('https://damatong.net/promo');
    if (!promoResponse.ok()) {
        const ErrorType = TRANSIENT_PROMOTION_STATUSES.has(promoResponse.status())
            ? TransientPromotionEntryError
            : Error;
        throw new ErrorType(`生产推广页返回 ${promoResponse.status()}`);
    }

    const promoHtml = await promoResponse.text();
    const ticket = promoHtml.match(/name="ticket" value="([^"]+)"/u)?.[1];
    if (!ticket) throw new Error('生产推广页没有返回入口票据');

    const entryResponse = await api.post('https://damatong.net/promo/enter', {
        form: { ticket },
        maxRedirects: 0,
    });
    if (![302, 303].includes(entryResponse.status())) {
        const ErrorType = TRANSIENT_PROMOTION_STATUSES.has(entryResponse.status())
            ? TransientPromotionEntryError
            : Error;
        throw new ErrorType(`生产推广入口返回 ${entryResponse.status()}`);
    }

    const accessCookie = (await api.storageState()).cookies.find(
        cookie => cookie.name === 'storefront-entry',
    );
    if (!accessCookie) throw new Error('生产推广入口没有签发 storefront-entry Cookie');

    return accessCookie.value;
}

export default async function globalSetup() {
    if (process.env.COMPAT_BASE_URL) return;

    const api = await request.newContext({
        extraHTTPHeaders: {
            'user-agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
    });

    try {
        let lastError: unknown;
        for (let attempt = 1; attempt <= PROMOTION_ENTRY_MAX_ATTEMPTS; attempt += 1) {
            try {
                process.env.COMPAT_STOREFRONT_ENTRY_COOKIE = await requestPromotionAccessCookie(api);
                return;
            } catch (error) {
                lastError = error;
                if (
                    !(error instanceof TransientPromotionEntryError) ||
                    attempt === PROMOTION_ENTRY_MAX_ATTEMPTS
                ) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, attempt * 500));
            }
        }
        throw lastError;
    } finally {
        await api.dispose();
    }
}
