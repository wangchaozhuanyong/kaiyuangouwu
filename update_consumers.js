const fs = require('fs');

const utilsExports = new Set([
    'DEFAULT_STOREFRONT_NAMES',
    'FAVORITE_PRODUCT_LIMIT',
    'FAVORITE_PRODUCT_STORAGE_KEY',
    'RECENT_PRODUCT_LIMIT',
    'RECENT_PRODUCT_STORAGE_KEY',
    'STOREFRONT_CURRENCY_PREFERENCE_STORAGE_KEY',
    'STOREFRONT_LANGUAGE_PREFERENCE_STORAGE_KEY',
    'STOREFRONT_NAME_MAX_DISPLAY_UNITS',
    'STOREFRONT_SETTLEMENT_CURRENCY_PREFERENCE_STORAGE_KEY',
    'contentNumberSetting',
    'contentStringArraySetting',
    'minimumProductPrice',
    'normalizeStorefrontName',
    'productImage',
    'readStoredCurrency',
    'readStoredLanguage',
    'readStoredSettlementCurrency',
    'setMetaContent',
    'storefrontNameDisplayUnits',
    'trimText',
    'writeManualLanguage',
    'writeStoredCurrency',
    'writeStoredSettlementCurrency',
]);
const hookExports = new Set(['useAutoMattedLogo']);

const files = [
    'packages/storefront/src/storefront-ui/product-display.tsx',
    'packages/storefront/src/storefront-ui/content-ui.tsx',
    'packages/storefront/src/checkout-page.tsx',
    'packages/storefront/src/components/common/product-card.tsx',
    'packages/storefront/src/components/common/product-row.tsx',
    'packages/storefront/src/catalog-page-utils.ts',
    'packages/storefront/src/pages/home-page.tsx',
    'packages/storefront/src/pages/category-page.tsx',
    'packages/storefront/src/pages/product-detail-page.tsx',
    'packages/storefront/src/currency-preference.spec.ts'
];

for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, 'utf8');

    // Regex to match imports from '../App' or './App'
    const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]*App)['"];/g;

    content = content.replace(importRegex, (match, importNames, appPath) => {
        const names = importNames.split(',').map(n => n.trim()).filter(Boolean);
        
        const appNames = [];
        const utilNames = [];
        const hookNames = [];
        
        for (const name of names) {
            // handle alias like "storefrontNameDisplayUnits as getUnits"
            const realName = name.split(/\s+as\s+/)[0];
            if (utilsExports.has(realName)) {
                utilNames.push(name);
            } else if (hookExports.has(realName)) {
                hookNames.push(name);
            } else {
                appNames.push(name);
            }
        }
        
        let newImports = [];
        
        // Path logic:
        // If appPath is '../App', utils is '../storefront-utils', hooks is '../hooks/useAutoMattedLogo'
        // If appPath is './App', utils is './storefront-utils', hooks is './hooks/useAutoMattedLogo'
        // If appPath is '../../App', utils is '../../storefront-utils'
        
        const basePath = appPath.replace(/\/App$/, '');
        
        if (appNames.length > 0) {
            newImports.push(`import { ${appNames.join(', ')} } from '${appPath}';`);
        }
        if (utilNames.length > 0) {
            newImports.push(`import { ${utilNames.join(', ')} } from '${basePath}/storefront-utils';`);
        }
        if (hookNames.length > 0) {
            newImports.push(`import { ${hookNames.join(', ')} } from '${basePath}/hooks/useAutoMattedLogo';`);
        }
        
        return newImports.join('\n');
    });

    fs.writeFileSync(file, content);
}
