// organize-imports-ignore -- Preserve production stylesheet order.
import type { MdacFlightResult, MdacFlightSearch } from '../../src/client-plugins/mdac/flight-lookup';
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
const demoFlights = params.get('flight') === 'demo';
function lookupDemoFlight({ arrivalDate, arrivalAirport, flightNumber }: MdacFlightSearch): MdacFlightResult {
    if (flightNumber === 'XX998') return { status: 'UNAVAILABLE', flights: [] };
    if (arrivalAirport !== 'KUL' || !['MH123', 'CX777', 'MH999'].includes(flightNumber)) {
        return { status: 'NO_MATCH', flights: [] };
    }
    return {
        status: 'MATCHED',
        flights: [
            {
                flightNumber,
                operatingFlightNumber: flightNumber === 'CX777' ? 'MH123' : flightNumber,
                departureAirport: 'HKG',
                arrivalAirport,
                scheduledArrivalDate: arrivalDate,
                scheduledArrivalTime: '03:00',
                effectiveArrivalDate: arrivalDate,
                effectiveArrivalTime: '03:00',
                status: flightNumber === 'MH999' ? 'CANCELLED' : 'SCHEDULED',
            },
        ],
    };
}
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
                    {demoFlights && (
                        <p className="mdac-message type-label">
                            {language === 'zh'
                                ? '测试预览 · 航班为虚构数据'
                                : 'Test preview · Fictional flight data'}
                        </p>
                    )}
                    <MdacPage
                        language={language}
                        storeName={language === 'zh' ? '大马通' : 'Damatong'}
                        flightService={
                            demoFlights
                                ? {
                                      marketKey: 'mdac-fixture',
                                      lookup: input => Promise.resolve(lookupDemoFlight(input)),
                                  }
                                : undefined
                        }
                    />
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
