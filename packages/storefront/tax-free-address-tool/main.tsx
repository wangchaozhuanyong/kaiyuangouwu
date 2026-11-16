import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';

import { standaloneAddressApi } from '../src/api/tax-free-address';
import { TaxFreeAddressPage } from '../src/client-plugins/tax-free-address/tax-free-address-page';
import { standaloneToolNavigation } from '../src/standalone-tool-navigation';
import './styles.css';

const { language, onBack } = standaloneToolNavigation(() => window.history.back());
document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
document.title = language === 'zh' ? '免税地址提取' : 'Tax-free address templates';

const root = document.getElementById('root');
if (!root) throw new Error('Missing address tool root');
const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
createRoot(root).render(
    <QueryClientProvider client={client}>
        <TaxFreeAddressPage api={standaloneAddressApi} language={language} onBack={onBack} />
    </QueryClientProvider>,
);
