import { ApolloProvider } from '@apollo/client/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { client } from './apollo';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './index.css';
import { ThemeProvider } from './theme/ThemeProvider';
import { registerBuildPreloadRecovery } from './utils/build-recovery';

registerBuildPreloadRecovery();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('管理后台挂载节点不存在');

createRoot(rootElement).render(
    <StrictMode>
        <AppErrorBoundary>
            <ThemeProvider>
                <ApolloProvider client={client}>
                    <App />
                </ApolloProvider>
            </ThemeProvider>
        </AppErrorBoundary>
    </StrictMode>,
);
