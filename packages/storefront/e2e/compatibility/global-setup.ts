import { request } from '@playwright/test';

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
        const promoResponse = await api.get('https://damatong.net/promo');
        if (!promoResponse.ok()) {
            throw new Error(`生产推广页返回 ${promoResponse.status()}`);
        }

        const promoHtml = await promoResponse.text();
        const ticket = promoHtml.match(/name="ticket" value="([^"]+)"/u)?.[1];
        if (!ticket) throw new Error('生产推广页没有返回入口票据');

        const entryResponse = await api.post('https://damatong.net/promo/enter', {
            form: { ticket },
            maxRedirects: 0,
        });
        if (![302, 303].includes(entryResponse.status())) {
            throw new Error(`生产推广入口返回 ${entryResponse.status()}`);
        }

        const accessCookie = (await api.storageState()).cookies.find(
            cookie => cookie.name === 'storefront-entry',
        );
        if (!accessCookie) throw new Error('生产推广入口没有签发 storefront-entry Cookie');

        process.env.COMPAT_STOREFRONT_ENTRY_COOKIE = accessCookie.value;
    } finally {
        await api.dispose();
    }
}
