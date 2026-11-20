// organize-imports-ignore -- Preserve production stylesheet order.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';

import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import { MdacPage } from '../../src/client-plugins/mdac/mdac-page';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import '../../src/storefront-styles';
import '../../src/commerce-styles';

const params = new URLSearchParams(location.search);
const preset = params.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const palette = resolveStorefrontSemanticPalette(preset);
document.documentElement.dataset.storefrontPreset = preset;
for (const [key, value] of Object.entries({
    ...semanticPaletteCssVariables(palette),
    ...storefrontSkinCssVariables(preset, palette),
}))
    document.documentElement.style.setProperty(key, value);
const client = new QueryClient();
function Fixture() {
    const desktop = useDesktopViewport();
    return (
        <QueryClientProvider client={client}>
            <DesktopLayoutContext.Provider value={desktop}>
                <div
                    className={desktop ? 'storefront-app desktop-store-layout' : 'storefront-app'}
                    data-route="mdac"
                    style={{ maxWidth: 1344, margin: 'auto' }}
                >
                    <MdacPage language={language} storeName={language === 'zh' ? '大马通' : 'Damatong'} />
                    <p className="type-helper">本地实际组件预览 · 请使用虚构资料 · 未发布</p>
                </div>
            </DesktopLayoutContext.Provider>
        </QueryClientProvider>
    );
}
const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
});
const mount = document.getElementById('root');
if (!mount) throw new Error('Missing MDAC fixture root');
createRoot(mount).render(<RouterProvider router={router} />);
