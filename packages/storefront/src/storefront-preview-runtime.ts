// The interactive preview is intentionally self-contained. It uses the same
// read-only fixture as visual acceptance so a missing local API cannot turn
// skin and route review into a retry-heavy error screen.
// @ts-expect-error The fixture is an ESM QA module outside the TypeScript source tree.
import { fixtureData } from '../e2e/visual-presets/fixtures.mjs';

function requestUrl(input: RequestInfo | URL): URL {
    if (input instanceof Request) return new URL(input.url, window.location.href);
    return new URL(String(input), window.location.href);
}

export function installStorefrontPreviewRuntime(): void {
    const parameters = new URLSearchParams(window.location.search);
    if (parameters.get('storefrontPreviewEmbedded') !== '1') return;

    const preset = parameters.get('storefrontPreviewPreset') ?? 'classic';
    const signedIn = parameters.get('storefrontPreviewAuth') === 'authenticated';
    const scenario = parameters.get('storefrontPreviewScenario');
    const content =
        scenario === 'dense' || scenario === 'aftercare' || scenario === 'catalog-scroll'
            ? scenario
            : 'normal';
    const data = fixtureData(preset, signedIn, content);
    const nativeFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.origin === window.location.origin && url.pathname.includes('/shop-api')) {
            let responseData = data;
            if (content === 'catalog-scroll') {
                const body = input instanceof Request ? await input.clone().text() : init?.body;
                const request = typeof body === 'string' && body ? JSON.parse(body) : {};
                const catalogInput = request.variables?.input;
                if (catalogInput && request.query?.includes('storefrontCatalog')) {
                    const skip = catalogInput.skip ?? 0;
                    const take = catalogInput.take ?? 12;
                    responseData = {
                        ...data,
                        storefrontCatalog: {
                            ...data.storefrontCatalog,
                            items: data.storefrontCatalog.items.slice(skip, skip + take),
                        },
                    };
                }
            }
            return new Response(JSON.stringify({ data: responseData }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (url.origin === window.location.origin && url.pathname.includes('/storefront-realtime')) {
            return new Response(null, { status: 204 });
        }
        return nativeFetch(input, init);
    };
}
