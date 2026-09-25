import { Sheet } from '../../storefront-ui/page-shell';
import { type FulfillmentType, type StorefrontLanguage } from '../../types';

export interface CatalogFilterValues {
    fulfillment: 'all' | FulfillmentType;
    inStockOnly: boolean;
    minPrice: string;
    maxPrice: string;
}

export function categoryFilterActionLabel(language: StorefrontLanguage, resultCount: number | null): string {
    if (resultCount === null) return language === 'zh' ? '应用筛选' : 'Apply filters';
    if (language === 'zh') return `查看 ${resultCount} 件商品`;
    return `View ${resultCount} ${resultCount === 1 ? 'product' : 'products'}`;
}

export function CatalogFilterSheet({
    language,
    currencyCode,
    value,
    resultCount,
    onChange,
    onApply,
    onClose,
}: {
    language: StorefrontLanguage;
    currencyCode: string;
    value: CatalogFilterValues;
    resultCount: number | null;
    onChange: (value: CatalogFilterValues) => void;
    onApply: (value: CatalogFilterValues) => void;
    onClose: () => void;
}) {
    const isZh = language === 'zh';
    const draftType = value.fulfillment;
    const draftStock = value.inStockOnly;
    const draftMinimumPrice = value.minPrice;
    const draftMaximumPrice = value.maxPrice;
    const draftResultCount = resultCount;
    const setDraftType = (fulfillment: CatalogFilterValues['fulfillment']) =>
        onChange({ ...value, fulfillment });
    const setDraftStock = (inStockOnly: boolean) => onChange({ ...value, inStockOnly });
    const setDraftMinimumPrice = (minPrice: string) => onChange({ ...value, minPrice });
    const setDraftMaximumPrice = (maxPrice: string) => onChange({ ...value, maxPrice });
    const invalidPrice =
        [draftMinimumPrice, draftMaximumPrice].some(
            price => price !== '' && (!Number.isFinite(Number(price)) || Number(price) < 0),
        ) ||
        (draftMinimumPrice !== '' &&
            draftMaximumPrice !== '' &&
            Number(draftMinimumPrice) > Number(draftMaximumPrice));
    return (
        <Sheet title={isZh ? '筛选' : 'Filter'} language={language} onClose={onClose}>
            <div className="filter-sheet-content">
                <label className="filter-card filter-stock-card">
                    <span className="filter-stock-title">{isZh ? '仅看有货' : 'In stock only'}</span>
                    <input
                        type="checkbox"
                        checked={draftStock}
                        onChange={event => setDraftStock(event.target.checked)}
                    />
                </label>
                <fieldset className="filter-fieldset">
                    <legend className="filter-legend">{isZh ? '价格区间' : 'Price range'}</legend>
                    <div className="price-range-inputs">
                        <label>
                            <span>{currencyCode}</span>
                            <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                placeholder={isZh ? '最低价' : 'Min'}
                                aria-label={isZh ? '最低价' : 'Minimum price'}
                                value={draftMinimumPrice}
                                onChange={event => setDraftMinimumPrice(event.target.value)}
                            />
                        </label>
                        <span className="price-separator">—</span>
                        <label>
                            <span>{currencyCode}</span>
                            <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                placeholder={isZh ? '最高价' : 'Max'}
                                aria-label={isZh ? '最高价' : 'Maximum price'}
                                value={draftMaximumPrice}
                                onChange={event => setDraftMaximumPrice(event.target.value)}
                            />
                        </label>
                    </div>
                    <div className="price-presets">
                        {(
                            [
                                [0, 100],
                                [100, 300],
                                [300, 800],
                                [800, null],
                            ] as const
                        ).map(([minimum, maximum]) => (
                            <button
                                type="button"
                                key={`${minimum}-${maximum ?? 'up'}`}
                                aria-pressed={
                                    draftMinimumPrice === String(minimum) &&
                                    draftMaximumPrice === (maximum === null ? '' : String(maximum))
                                }
                                className={
                                    draftMinimumPrice === String(minimum) &&
                                    draftMaximumPrice === (maximum === null ? '' : String(maximum))
                                        ? 'is-active'
                                        : undefined
                                }
                                onClick={() => {
                                    onChange({
                                        ...value,
                                        minPrice: String(minimum),
                                        maxPrice: maximum === null ? '' : String(maximum),
                                    });
                                }}
                            >
                                {maximum === null
                                    ? `${minimum}${isZh ? '以上' : '+'}`
                                    : `${minimum}-${maximum}`}
                            </button>
                        ))}
                    </div>
                </fieldset>
                <fieldset className="filter-fieldset">
                    <legend className="filter-legend">{isZh ? '商品类型' : 'Product type'}</legend>
                    <div className="segmented-options">
                        {(['all', 'physical', 'digital'] as const).map(type => (
                            <button
                                type="button"
                                key={type}
                                aria-pressed={draftType === type}
                                className={draftType === type ? 'is-active' : undefined}
                                onClick={() => setDraftType(type)}
                            >
                                {type === 'all'
                                    ? isZh
                                        ? '全部'
                                        : 'All'
                                    : type === 'physical'
                                      ? isZh
                                          ? '实物'
                                          : 'Physical'
                                      : isZh
                                        ? '数字商品'
                                        : 'Digital'}
                            </button>
                        ))}
                    </div>
                </fieldset>
                {invalidPrice && (
                    <p className="inline-error" role="alert">
                        {isZh
                            ? '请输入有效价格，最高价不能低于最低价'
                            : 'Enter valid prices; the maximum must be at least the minimum.'}
                    </p>
                )}
                <div className="sheet-actions filter-actions">
                    <button
                        type="button"
                        className="reset-filter-button"
                        onClick={() => {
                            onChange({ fulfillment: 'all', inStockOnly: false, minPrice: '', maxPrice: '' });
                        }}
                    >
                        {isZh ? '重置' : 'Reset'}
                    </button>
                    <button
                        type="button"
                        className="primary-action filter-confirm-button"
                        disabled={invalidPrice}
                        onClick={() => {
                            if (!invalidPrice) onApply(value);
                        }}
                    >
                        {categoryFilterActionLabel(language, draftResultCount)}
                    </button>
                </div>
            </div>
        </Sheet>
    );
}
