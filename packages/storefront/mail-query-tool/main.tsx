// Shared shell foundations load before the page's responsive layout rules.
import { createRoot } from 'react-dom/client';
import './styles.css';

import { standaloneMailQueryApi } from '../src/api/standalone-mail-query';
import { MailQueryPage } from '../src/client-plugins/mail-query/mail-query-page';
import { standaloneToolNavigation } from '../src/standalone-tool-navigation';

const { language, onBack } = standaloneToolNavigation(() => window.history.back());
document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
document.title = language === 'zh' ? '邮箱查询服务' : 'Email lookup';
const root = document.getElementById('root');
if (!root) throw new Error('Missing mail tool root');
createRoot(root).render(
    <MailQueryPage
        api={standaloneMailQueryApi}
        marketCode="standalone-mail"
        language={language}
        onBack={onBack}
        standalone
    />,
);
