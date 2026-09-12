import { useEffect, useRef, useState } from 'react';
import type { ActiveCustomer, StorefrontLanguage } from '../../types';

import { browserVaultStorage } from './browser-storage';
import { TwoFactorPage } from './two-factor-page';

export function isolatedVaultOrigin(configured: string, currentOrigin: string): string | null {
    if (!configured) return null;
    const url = new URL(configured);
    if (
        url.protocol !== 'https:' ||
        url.origin === currentOrigin ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
    )
        throw new Error('Invalid isolated vault origin');
    return url.origin;
}

export function CustomerTwoFactorEntry(
    props: Readonly<{
        customer: ActiveCustomer | null;
        language: StorefrontLanguage;
        onBack: () => void;
        onSignIn: () => void;
        onNotify: (message: string) => void;
    }>,
) {
    return <IsolatedEntrySession key={props.customer?.id ?? 'anonymous'} {...props} />;
}

function IsolatedEntrySession(props: Parameters<typeof CustomerTwoFactorEntry>[0]) {
    const iframe = useRef<HTMLIFrameElement>(null);
    const [migrating, setMigrating] = useState(false);
    const [legacy, setLegacy] = useState(false);
    const [ready, setReady] = useState(false);
    let origin: string | null = null;
    let invalid = false;
    try {
        origin = isolatedVaultOrigin(import.meta.env.VITE_TWO_FACTOR_ORIGIN || '', window.location.origin);
    } catch {
        invalid = true;
    }
    useEffect(() => {
        if (!origin || !props.customer) return;
        try {
            const status = browserVaultStorage()?.inspect(props.customer.id);
            setLegacy(!!status && (status.exists || status.legacy));
        } catch {
            setLegacy(true);
        }
        const customerId = props.customer.id;
        const receive = (event: MessageEvent) => {
            if (event.source !== iframe.current?.contentWindow || event.origin !== origin) return;
            if (event.data?.type === 'vendure-vault-ready') {
                iframe.current?.contentWindow?.postMessage(
                    {
                        type: 'vendure-vault-init',
                        ownerId: customerId,
                        language: props.language,
                    },
                    origin,
                );
            } else if (event.data?.type === 'vendure-vault-initialized') setReady(true);
            else if (event.data?.type === 'vendure-vault-back') props.onBack();
        };
        window.addEventListener('message', receive);
        return () => window.removeEventListener('message', receive);
    }, [origin, props.customer?.id, props.language, props.onBack, migrating]);
    if (invalid)
        return (
            <p role="alert">
                {props.language === 'zh'
                    ? '2FA 安全页面配置无效，请联系管理员。'
                    : 'Invalid secure 2FA configuration. Contact support.'}
            </p>
        );
    if (!origin || !props.customer) return <TwoFactorPage {...props} />;
    if (migrating)
        return (
            <div>
                <p className="p-4 text-sm">
                    {props.language === 'zh'
                        ? '在旧页面设置或输入口令，下载加密备份后，返回安全页面恢复。密钥不会通过页面通信传递。'
                        : 'Unlock or migrate old data and download an encrypted backup, then restore it in the secure page. Secrets are never sent between pages.'}
                </p>
                <button
                    type="button"
                    className="m-4 min-h-11 rounded-xl border px-4"
                    onClick={() => {
                        setMigrating(false);
                        setReady(false);
                    }}
                >
                    {props.language === 'zh' ? '返回安全页面' : 'Return to secure page'}
                </button>
                <TwoFactorPage {...props} />
            </div>
        );
    return (
        <section>
            {legacy && (
                <button
                    type="button"
                    className="m-4 min-h-11 rounded-xl border px-4"
                    onClick={() => setMigrating(true)}
                >
                    {props.language === 'zh'
                        ? '迁移旧浏览器中的账号'
                        : 'Migrate accounts from old browser storage'}
                </button>
            )}
            {!ready && (
                <p role="status" className="p-4">
                    {props.language === 'zh'
                        ? '正在连接 2FA 安全页面。若持续未加载，请联系管理员。'
                        : 'Connecting to the secure 2FA page. Contact support if it does not load.'}
                </p>
            )}
            <iframe
                ref={iframe}
                onLoad={() =>
                    iframe.current?.contentWindow?.postMessage(
                        {
                            type: 'vendure-vault-init',
                            ownerId: props.customer?.id,
                            language: props.language,
                        },
                        origin,
                    )
                }
                src={`${origin}/index.html`}
                title={props.language === 'zh' ? '2FA 安全页面' : 'Secure 2FA tool'}
                className="min-h-[85vh] w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-downloads allow-forms"
                allow="clipboard-read; clipboard-write"
                referrerPolicy="no-referrer"
            />
        </section>
    );
}
