import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ActiveCustomer, StorefrontLanguage } from '../src/types';

import { TwoFactorPage } from '../src/client-plugins/two-factor/two-factor-page';
import './styles.css';

const allowedParents = new Set<string>(
    (import.meta.env.VITE_TWO_FACTOR_PARENT_ORIGINS || '').split(',').filter(Boolean),
);

function IsolatedVault() {
    const [session, setSession] = useState<{
        ownerId: string;
        language: StorefrontLanguage;
        origin: string;
    }>();
    const [notice, setNotice] = useState('');
    useEffect(() => {
        const receive = (event: MessageEvent) => {
            if (
                event.source !== window.parent ||
                window.parent === window ||
                !allowedParents.has(event.origin)
            )
                return;
            const data = event.data;
            if (
                data?.type !== 'vendure-vault-init' ||
                typeof data.ownerId !== 'string' ||
                !/^[a-zA-Z0-9_-]{1,100}$/.test(data.ownerId) ||
                !['zh', 'en'].includes(data.language)
            )
                return;
            setNotice('');
            setSession({ ownerId: data.ownerId, language: data.language, origin: event.origin });
            window.parent.postMessage({ type: 'vendure-vault-initialized' }, event.origin);
        };
        window.addEventListener('message', receive);
        // Only a readiness signal crosses origins. Neither secrets nor encrypted backups are messaged.
        for (const origin of allowedParents)
            window.parent.postMessage({ type: 'vendure-vault-ready' }, origin);
        return () => window.removeEventListener('message', receive);
    }, []);
    if (!session)
        return (
            <p className="p-6" role="status">
                请从已授权的商城页面打开 2FA 工具。 / Open this tool from an authorized storefront.
            </p>
        );
    const customer: ActiveCustomer = {
        id: session.ownerId,
        firstName: '',
        lastName: '',
        emailAddress: '',
        phoneNumber: null,
        addresses: [],
        orders: { items: [], totalItems: 0 },
    };
    return (
        <>
            {notice && (
                <p role="status" className="p-3 text-sm">
                    {notice}
                </p>
            )}
            <TwoFactorPage
                key={`${session.origin}:${session.ownerId}`}
                customer={customer}
                language={session.language}
                onBack={() => window.parent.postMessage({ type: 'vendure-vault-back' }, session.origin)}
                onSignIn={() => undefined}
                onNotify={setNotice}
            />
        </>
    );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing vault root');
createRoot(root).render(<IsolatedVault />);
