import { Order, StorefrontLanguage } from './types';

export function TaxSummaryRows({
    order,
    locale,
    language,
}: {
    order: Pick<Order, 'currencyCode' | 'taxSummary'>;
    locale: string;
    language: StorefrontLanguage;
}) {
    const rows = order.taxSummary.filter(summary => summary.taxTotal > 0);
    if (!rows.length) return null;
    return rows.map((summary, index) => (
        <div className="tax-detail" key={`${summary.description}-${summary.taxRate}-${index}`}>
            <dt>
                {language === 'zh' ? '其中' : 'Includes'} {summary.description || (language === 'zh' ? '税费' : 'tax')}
                {summary.taxRate > 0 ? ` (${formatRate(summary.taxRate, locale)}%)` : ''}
            </dt>
            <dd>{formatMoney(summary.taxTotal, order.currencyCode, locale)}</dd>
        </div>
    ));
}

function formatMoney(value: number, currency: string, locale: string): string {
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(value / 100);
}

function formatRate(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}
