import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';

import { standaloneAddressApi } from '../src/api/tax-free-address';
import { TaxFreeAddressPage } from '../src/client-plugins/tax-free-address/tax-free-address-page';
import './styles.css';

const location = new URL(window.location.href);
const language = location.searchParams.get('lang') === 'en' ? 'en' : 'zh';
if (location.hash === '#back') {
    // Only store a boolean in this history entry. Never receive or persist the referring site URL.
    history.replaceState({ fromPreviousPage: history.length > 1 }, '', location.pathname + location.search);
}
const back = history.state?.fromPreviousPage === true && history.length > 1;
document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
document.title = language === 'zh' ? '免税地址提取' : 'Tax-free address templates';

const root = document.getElementById('root');
if (!root) throw new Error('Missing address tool root');
const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
createRoot(root).render(
    <QueryClientProvider client={client}>
        <TaxFreeAddressPage
            api={standaloneAddressApi}
            language={language}
            onBack={back ? () => window.history.back() : undefined}
        />
    </QueryClientProvider>,
);
