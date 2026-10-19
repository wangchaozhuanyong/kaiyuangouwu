import { useEffect, useRef, useState } from 'react';

import { StorefrontLanguage } from './types';

import './styles/google-auth.css';

const GOOGLE_IDENTITY_SCRIPT_ID = 'google-identity-services';
const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

type GoogleCredentialResponse = { credential?: string; state?: string };
type GoogleIdentityApi = {
    accounts: {
        id: {
            initialize(options: {
                client_id: string;
                nonce?: string;
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
                    state: string;
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
let nextButtonId = 0;
let identitySession:
    | {
          api: GoogleIdentityApi['accounts']['id'];
          key: string;
          callbacks: Map<string, (response: GoogleCredentialResponse) => void>;
      }
    | undefined;

/** GIS owns one configuration per document. Button state keeps responses with their original form. */
function getIdentitySession(api: GoogleIdentityApi['accounts']['id'], clientId: string, nonce?: string) {
    const key = JSON.stringify([clientId, nonce]);
    if (identitySession?.api === api && identitySession.key === key) return identitySession;
    const session = {
        api,
        key,
        callbacks: new Map<string, (response: GoogleCredentialResponse) => void>(),
    };
    api.initialize({
        client_id: clientId,
        ...(nonce ? { nonce } : {}),
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: response => {
            if (identitySession === session && response.state)
                session.callbacks.get(response.state)?.(response);
        },
    });
    identitySession = session;
    return session;
}

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
            reject(new Error());
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
    nonce,
    language,
    disabled,
    disabledReason,
    scope,
    onCredential,
}: {
    clientId: string;
    nonce?: string;
    language: StorefrontLanguage;
    disabled?: boolean;
    disabledReason?: string;
    scope?: unknown;
    onCredential: (credential: string) => Promise<void>;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const callbackRef = useRef(onCredential);
    const [error, setError] = useState('');
    const [ready, setReady] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const busyRef = useRef(false);
    const disabledRef = useRef(disabled);
    const languageRef = useRef(language);
    const renderRef = useRef<(() => void) | null>(null);
    disabledRef.current = disabled;
    languageRef.current = language;

    callbackRef.current = onCredential;

    useEffect(() => {
        let active = true;
        const host = hostRef.current;
        let unregister: (() => void) | undefined;
        setError('');
        setReady(false);
        void loadGoogleIdentityScript()
            .then(() => {
                if (!active || !host || !window.google?.accounts.id) return;
                const session = getIdentitySession(window.google.accounts.id, clientId, nonce);
                const state = `gsi-${++nextButtonId}`;
                session.callbacks.set(state, response => {
                    if (!active || disabledRef.current || busyRef.current) return;
                    if (!response.credential) {
                        setError(
                            languageRef.current === 'zh'
                                ? 'Google 未返回有效凭证'
                                : 'Google returned no credential',
                        );
                        return;
                    }
                    setError('');
                    busyRef.current = true;
                    void callbackRef
                        .current(response.credential)
                        .catch(cause => {
                            if (active)
                                setError(
                                    cause instanceof Error
                                        ? cause.message
                                        : languageRef.current === 'zh'
                                          ? 'Google 登录失败，请重试'
                                          : 'Google sign-in failed. Try again',
                                );
                        })
                        .finally(() => {
                            busyRef.current = false;
                        });
                });
                unregister = () => session.callbacks.delete(state);
                const render = () => {
                    host.replaceChildren();
                    session.api.renderButton(host, {
                        type: 'standard',
                        theme: 'outline',
                        size: 'large',
                        shape: 'rectangular',
                        text: 'continue_with',
                        width: Math.min(400, Math.max(240, host.clientWidth || 320)),
                        locale: languageRef.current === 'zh' ? 'zh-CN' : 'en',
                        state,
                    });
                };
                renderRef.current = render;
                render();
                setReady(true);
            })
            .catch(() => {
                if (active) {
                    setError(
                        languageRef.current === 'zh'
                            ? 'Google 登录加载失败'
                            : 'Google sign-in could not load',
                    );
                }
            });
        return () => {
            active = false;
            unregister?.();
            renderRef.current = null;
            host?.replaceChildren();
        };
    }, [clientId, nonce, scope, attempt]);

    useEffect(() => {
        renderRef.current?.();
    }, [language]);

    return (
        <div className={`google-auth-button${disabled ? ' google-auth-button-disabled' : ''}`}>
            <div ref={hostRef} aria-busy={!ready && !error} inert={disabled || undefined} />
            {!ready && !error && (
                <span className="google-auth-loading" role="status">
                    {language === 'zh' ? '正在加载 Google 登录…' : 'Loading Google sign-in…'}
                </span>
            )}
            {disabledReason ? (
                <small className="google-auth-hint" role="status">
                    {disabledReason}
                </small>
            ) : null}
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
