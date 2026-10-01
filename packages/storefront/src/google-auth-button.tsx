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

let identityScriptPromise: Promise<void> | undefined;

function loadGoogleIdentityScript(): Promise<void> {
    if (window.google?.accounts.id) return Promise.resolve();
    if (identityScriptPromise) return identityScriptPromise;
    const promise = new Promise<void>((resolve, reject) => {
        const existing = document.getElementById(GOOGLE_IDENTITY_SCRIPT_ID) as HTMLScriptElement | null;
        const script = existing ?? document.createElement('script');
        const cleanup = () => {
            clearTimeout(timeout);
            script.removeEventListener('load', onLoad);
            script.removeEventListener('error', onError);
        };
        const onError = () => {
            cleanup();
            script.remove();
            reject(new Error('Google Identity Services could not be loaded'));
        };
        const onLoad = () => {
            if (!window.google?.accounts.id) {
                onError();
                return;
            }
            cleanup();
            resolve();
        };
        const timeout = window.setTimeout(onError, 15000);
        script.addEventListener('load', onLoad);
        script.addEventListener('error', onError);
        if (!existing) {
            script.id = GOOGLE_IDENTITY_SCRIPT_ID;
            script.src = GOOGLE_IDENTITY_SCRIPT_URL;
            script.async = true;
            script.defer = true;
            document.head.append(script);
        }
    });
    identityScriptPromise = promise;
    void promise
        .finally(() => {
            if (identityScriptPromise === promise) identityScriptPromise = undefined;
        })
        .catch(() => undefined);
    return promise;
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
    const [attempt, setAttempt] = useState(0);
    const busyRef = useRef(false);
    const disabledRef = useRef(disabled);
    disabledRef.current = disabled;

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
                        if (!active || disabledRef.current || busyRef.current) return;
                        if (!response.credential) {
                            setError(
                                language === 'zh'
                                    ? 'Google 授权未返回有效凭证'
                                    : 'Google did not return a valid credential',
                            );
                            return;
                        }
                        setError('');
                        busyRef.current = true;
                        void callbackRef
                            .current(response.credential)
                            .catch(cause => {
                                setError(
                                    cause instanceof Error
                                        ? cause.message
                                        : language === 'zh'
                                          ? 'Google 登录失败，请重试'
                                          : 'Google sign-in failed. Try again',
                                );
                            })
                            .finally(() => {
                                busyRef.current = false;
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
    }, [clientId, language, attempt]);

    return (
        <div className={`google-auth-button${disabled ? ' google-auth-button-disabled' : ''}`}>
            <div ref={hostRef} aria-busy={!ready && !error} inert={disabled || undefined} />
            {!ready && !error && (
                <span className="google-auth-loading" role="status">
                    {language === 'zh' ? '正在加载 Google 登录…' : 'Loading Google sign-in…'}
                </span>
            )}
            {error ? (
                <small className="form-error" role="alert">
                    {error}
                    {!ready && (
                        <button
                            className="auth-inline-link"
                            type="button"
                            onClick={() => setAttempt(value => value + 1)}
                        >
                            {language === 'zh' ? '重新加载' : 'Retry'}
                        </button>
                    )}
                </small>
            ) : null}
        </div>
    );
}
