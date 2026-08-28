import { formatDisplayMoney } from './money-display';
import { Order, StorefrontLanguage } from './types';

export function TaxSummaryRows({
    order,
    locale,
    language,
    useDisplayCurrency = false,
}: {
    order: Pick<Order, 'currencyCode' | 'taxSummary'>;
    locale: string;
    language: StorefrontLanguage;
    useDisplayCurrency?: boolean;
}) {
    const rows = order.taxSummary.filter(summary => summary.taxTotal > 0);
    if (!rows.length) return null;
    return rows.map((summary, index) => (
        <div className="tax-detail" key={`${summary.description}-${summary.taxRate}-${index}`}>
            <dt>
                {language === 'zh' ? '其中' : 'Includes'}{' '}
                {summary.description || (language === 'zh' ? '税费' : 'tax')}
                {summary.taxRate > 0 ? ` (${formatRate(summary.taxRate, locale)}%)` : ''}
            </dt>
            <dd>
                {useDisplayCurrency
                    ? formatDisplayMoney(summary.taxTotal, order.currencyCode, locale)
                    : formatMoney(summary.taxTotal, order.currencyCode, locale)}
            </dd>
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
