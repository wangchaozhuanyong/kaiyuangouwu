const desktopCatalogGridSizes =
    '(min-width: 1344px) 195.2px, (min-width: 1268px) calc((100vw - 368px) / 5), ' +
    '(min-width: 1072px) calc((100vw - 352px) / 4), ' +
    '(min-width: 1024px) calc((100vw - 336px) / 3)';
const mobileCategorySidebarSize = 'clamp(64px, calc((100vw - clamp(64px, 22vw, 86px) - 16px) * 0.3), 104px)';

/** Match shared component geometry; these are CSS widths, before device pixel ratio. */
export const STOREFRONT_IMAGE_SIZES = {
    productRow: '(min-width: 1024px) 300px, 104px',
    // category-layout sidebar = clamp(64px, 22%, 86px); list has 8px insets on each side.
    categorySidebarRow: `(min-width: 1024px) 300px, ${mobileCategorySidebarSize}`,
    // min(viewport - 64px, 1280px), 220px sidebar, 20px gutter, 16px card gaps.
    desktopCatalogCard: `${desktopCatalogGridSizes}, 104px`,
    // Standalone search uses the 1280px shell with 24px gaps and four/five columns.
    searchCard:
        '(min-width: 1344px) 236.8px, (min-width: 1280px) calc((100vw - 160px) / 5), (min-width: 1024px) calc((100vw - 136px) / 4), 104px',
    compactProductRow: '104px',
    categoryNavigation: '(min-width: 1024px) 44px, 56px',
    galleryThumbnail: '60px',
} as const;

/** Category grids share the desktop geometry but retain their actual phone sidebar. */
export function catalogCardImageSizes(sidebar = false): string {
    return `${desktopCatalogGridSizes}, ${sidebar ? mobileCategorySidebarSize : '104px'}`;
}
