import { useEffect, useRef, useState } from 'react';

import { StorefrontLanguage } from './types';

const GOOGLE_IDENTITY_SCRIPT_ID = 'google-identity-services';
const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

type GoogleCredentialResponse = { credential?: string };
type GoogleIdentityApi = {
    accounts: {
        id: {
            initialize(options: {
                client_id: string;
                callback: (response: GoogleCredentialResponse) => void;
                auto_select?: boolean;
                cancel_on_tap_outside?: boolean;
            }): void;
            renderButton(
                parent: HTMLElement,
                options: {
                    type: 'standard';
                    theme: 'outline';
                    size: 'large';
                    shape: 'rectangular';
                    text: 'continue_with';
                    width: number;
                    locale: string;
                },
            ): void;
        };
    };
};

declare global {
    interface Window {
        google?: GoogleIdentityApi;
    }
}

function loadGoogleIdentityScript(): Promise<void> {
    if (window.google?.accounts.id) return Promise.resolve();
    const existing = document.getElementById(GOOGLE_IDENTITY_SCRIPT_ID) as HTMLScriptElement | null;
    return new Promise((resolve, reject) => {
        const script = existing ?? document.createElement('script');
        const onLoad = () => resolve();
        const onError = () => {
            script.remove();
            reject(new Error('Google Identity Services could not be loaded'));
        };
        script.addEventListener('load', onLoad, { once: true });
        script.addEventListener('error', onError, { once: true });
        if (!existing) {
            script.id = GOOGLE_IDENTITY_SCRIPT_ID;
            script.src = GOOGLE_IDENTITY_SCRIPT_URL;
            script.async = true;
            script.defer = true;
            document.head.append(script);
        }
    });
}

export function GoogleAuthButton({
    clientId,
    language,
    disabled,
    onCredential,
}: {
    clientId: string;
    language: StorefrontLanguage;
    disabled?: boolean;
    onCredential: (credential: string) => Promise<void>;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const callbackRef = useRef(onCredential);
    const [error, setError] = useState('');
    const [ready, setReady] = useState(false);

    callbackRef.current = onCredential;

    useEffect(() => {
        let active = true;
        const host = hostRef.current;
        setError('');
        setReady(false);
        void loadGoogleIdentityScript()
            .then(() => {
                if (!active || !host || !window.google?.accounts.id) return;
                host.replaceChildren();
                window.google.accounts.id.initialize({
                    client_id: clientId,
                    auto_select: false,
                    cancel_on_tap_outside: true,
                    callback: response => {
                        if (!response.credential) {
                            setError(
                                language === 'zh'
                                    ? 'Google 授权未返回有效凭证'
                                    : 'Google did not return a valid credential',
                            );
                            return;
                        }
                        setError('');
                        void callbackRef.current(response.credential).catch(cause => {
                            setError(
                                cause instanceof Error
                                    ? cause.message
                                    : language === 'zh'
                                      ? 'Google 登录失败，请重试'
                                      : 'Google sign-in failed. Try again',
                            );
                        });
                    },
                });
                window.google.accounts.id.renderButton(host, {
                    type: 'standard',
                    theme: 'outline',
                    size: 'large',
                    shape: 'rectangular',
                    text: 'continue_with',
                    width: Math.min(400, Math.max(240, host.clientWidth || 320)),
                    locale: language === 'zh' ? 'zh-CN' : 'en',
                });
                setReady(true);
            })
            .catch(() => {
                if (active) {
                    setError(
                        language === 'zh'
                            ? 'Google 登录组件加载失败，请刷新后重试'
                            : 'Google sign-in could not load. Refresh and try again',
                    );
                }
            });
        return () => {
            active = false;
            host?.replaceChildren();
        };
    }, [clientId, language]);

    return (
        <div className={`google-auth-button${disabled ? ' google-auth-button-disabled' : ''}`}>
            <div ref={hostRef} aria-busy={!ready} />
            {error ? (
                <small className="form-error" role="alert">
                    {error}
                </small>
            ) : null}
        </div>
    );
}
