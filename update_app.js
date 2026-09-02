const fs = require('fs');

let content = fs.readFileSync('packages/storefront/src/App.tsx', 'utf8');

// The lines we want to remove are between
// "export type { MainPage, OrderTab, RouteName, RouteState, SortMode };\n\n"
// and "\nexport function App() {"
content = content.replace(
    /export const STOREFRONT_NAME_MAX_DISPLAY_UNITS[\s\S]*?export const DEFAULT_STOREFRONT_NAMES: Record<StorefrontLanguage, string> = \{\n    zh: '云桥Ai',\n    en: 'Yunqiao Ai',\n\};\n/,
    `export { useAutoMattedLogo } from './hooks/useAutoMattedLogo';
export {
    DEFAULT_STOREFRONT_NAMES,
    FAVORITE_PRODUCT_LIMIT,
    FAVORITE_PRODUCT_STORAGE_KEY,
    RECENT_PRODUCT_LIMIT,
    RECENT_PRODUCT_STORAGE_KEY,
    STOREFRONT_CURRENCY_PREFERENCE_STORAGE_KEY,
    STOREFRONT_LANGUAGE_PREFERENCE_STORAGE_KEY,
    STOREFRONT_NAME_MAX_DISPLAY_UNITS,
    STOREFRONT_SETTLEMENT_CURRENCY_PREFERENCE_STORAGE_KEY,
    contentNumberSetting,
    contentStringArraySetting,
    minimumProductPrice,
    normalizeStorefrontName,
    productImage,
    readStoredCurrency,
    readStoredLanguage,
    readStoredSettlementCurrency,
    setMetaContent,
    storefrontNameDisplayUnits,
    trimText,
    writeManualLanguage,
    writeStoredCurrency,
    writeStoredSettlementCurrency,
} from './storefront-utils';\n`
);

// We also need to remove lines 1762-1789:
// export function productImage ...
// to the end of contentStringArraySetting.
content = content.replace(
    /export function productImage\([\s\S]*?\];\n\}\n/g,
    ''
);

fs.writeFileSync('packages/storefront/src/App.tsx', content);
