const fs = require('fs');

let content = fs.readFileSync('packages/storefront/src/App.tsx', 'utf8');

const additionalImports = `
import { useAutoMattedLogo } from './hooks/useAutoMattedLogo';
import {
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
} from './storefront-utils';
`;

// Find where StorefrontUpdatePrompt is imported and insert after it
content = content.replace(
    /(import \{ StorefrontUpdatePrompt \} from '\.\/StorefrontUpdatePrompt';\n)/,
    `$1${additionalImports}`
);

// Wait, I previously inserted exports in update_app.js:
// export { useAutoMattedLogo } from './hooks/useAutoMattedLogo';
// export { ... } from './storefront-utils';
// But the exports are fine. I just need the imports inside App.tsx so App() can use them.
// But if I already have `export { ... } from './storefront-utils'`, it doesn't import them into the file's scope.
// So I should replace those exports with imports, and then export them.

content = content.replace(
    /export \{ useAutoMattedLogo \} from '\.\/hooks\/useAutoMattedLogo';[\s\S]*?\} from '\.\/storefront-utils';\n/,
    `export { useAutoMattedLogo };
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
};\n`
);

fs.writeFileSync('packages/storefront/src/App.tsx', content);
