import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

import { standaloneEnvironmentMonitorApi } from '../src/api/standalone-environment-monitor';
import { EnvironmentMonitorPage } from '../src/client-plugins/environment-monitor/environment-monitor-page';
import { createStorefrontQueryClient } from '../src/query-client';
import { standaloneToolNavigation } from '../src/standalone-tool-navigation';
import { type StorefrontLanguage } from '../src/types';

const navigation = standaloneToolNavigation(() => window.history.back());

function setDocumentLanguage(language: StorefrontLanguage) {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.title = language === 'zh' ? '环境检测' : 'Environment check';
}

function StandaloneEnvironmentMonitor() {
    const [language, setLanguage] = useState<StorefrontLanguage>(navigation.language);

    function changeLanguage(next: StorefrontLanguage) {
        const address = new URL(window.location.href);
        if (next === 'en') address.searchParams.set('lang', 'en');
        else address.searchParams.delete('lang');
        history.replaceState(history.state, '', address);
        setDocumentLanguage(next);
        setLanguage(next);
    }

    return (
        <EnvironmentMonitorPage
            api={standaloneEnvironmentMonitorApi}
            marketScope="standalone-environment-monitor"
            language={language}
            onBack={navigation.onBack}
            standaloneLanguageControl={
                <select
                    className="environment-language-select"
                    aria-label={language === 'zh' ? '语言' : 'Language'}
                    value={language}
                    onChange={event => changeLanguage(event.currentTarget.value === 'en' ? 'en' : 'zh')}
                >
                    <option value="zh" lang="zh-CN">
                        简体中文
                    </option>
                    <option value="en" lang="en">
                        English
                    </option>
                </select>
            }
        />
    );
}

setDocumentLanguage(navigation.language);
const root = document.getElementById('root');
if (!root) throw new Error('Missing environment check root');

createRoot(root).render(
    <QueryClientProvider client={createStorefrontQueryClient()}>
        <StandaloneEnvironmentMonitor />
    </QueryClientProvider>,
);
