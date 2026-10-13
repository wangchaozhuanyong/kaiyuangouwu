// organize-imports-ignore -- Use the production cascade with the real brand component.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import { BrandLoadingIndicator } from '../../src/brand-loading';
import { StorefrontContext, type StorefrontContextValue } from '../../src/StorefrontContext';
import '../../src/storefront-styles';

type Brand = { name: string; subtitle: string; logo: string };
declare global {
    interface Window {
        brandFixture: { set: (brand: Brand) => void };
    }
}
const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const preset = params.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
const palette = resolveStorefrontSemanticPalette(preset);
document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
document.documentElement.dataset.storefrontPreset = preset;
for (const [key, value] of Object.entries({
    ...semanticPaletteCssVariables(palette),
    ...storefrontSkinCssVariables(preset, palette),
}))
    document.documentElement.style.setProperty(key, value);

function Fixture() {
    const [brand, setBrand] = useState<Brand>({ name: '', subtitle: '', logo: '' });
    useEffect(() => {
        window.brandFixture = { set: setBrand };
    }, []);
    return (
        <StorefrontContext.Provider
            value={
                {
                    storefrontCode: 'synthetic-brand-fixture',
                    storefrontName: brand.name,
                    logoUrl: brand.logo,
                    language,
                    configQuery: {
                        data: {
                            code: 'synthetic-brand-fixture',
                            customFields: { storefrontNameEn: brand.subtitle },
                        },
                    },
                } as unknown as StorefrontContextValue
            }
        >
            <main className="page-skeleton page-skeleton--viewport" role="status" aria-label="Loading page">
                <BrandLoadingIndicator />
            </main>
        </StorefrontContext.Provider>
    );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing brand fixture root');
createRoot(rootElement).render(<Fixture />);
