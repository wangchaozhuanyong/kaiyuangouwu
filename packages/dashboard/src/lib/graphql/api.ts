import {
    LS_KEY_SELECTED_CHANNEL_TOKEN,
    LS_KEY_SESSION_TOKEN,
    LS_KEY_USER_SETTINGS,
} from '@/vdb/constants.js';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { AwesomeGraphQLClient } from 'awesome-graphql-client';
import { DocumentNode, print } from 'graphql';
import { uiConfig } from 'virtual:vendure-ui-config';

import { getApiBaseUrl } from '../utils/config-utils.js';
import { addDashboardLanguageParams } from './language-request.js';

const API_URL = getApiBaseUrl() + `/${uiConfig.api.adminApiPath}`;
const DISPLAY_LANGUAGE_HEADER = 'x-vendure-dashboard-display-language';
const REQUEST_KIND_HEADER = 'x-vendure-dashboard-request-kind';
const QUERY_TIMEOUT_MS = 30_000;
const MUTATION_TIMEOUT_MS = 90_000;

export type Variables = object;
export type RequestDocument = string | DocumentNode;

const awesomeClient = new AwesomeGraphQLClient({
    endpoint: API_URL,
    fetch: async (url: string, options: RequestInit = {}) => {
        // Get the active channel token from localStorage
        const channelToken = localStorage.getItem(LS_KEY_SELECTED_CHANNEL_TOKEN);
        const sessionToken = localStorage.getItem(LS_KEY_SESSION_TOKEN);
        const headers = new Headers(options.headers);
        const displayLanguage = headers.get(DISPLAY_LANGUAGE_HEADER);
        const requestKind = headers.get(REQUEST_KIND_HEADER) === 'mutation' ? 'mutation' : 'query';

        // This header is only used internally to select the request language.
        // Do not send it to the API, where it would trigger an unnecessary CORS preflight.
        headers.delete(DISPLAY_LANGUAGE_HEADER);
        headers.delete(REQUEST_KIND_HEADER);

        if (sessionToken) {
            headers.set('Authorization', `Bearer ${sessionToken}`);
        }
        if (channelToken && !headers.has(uiConfig.api.channelTokenKey)) {
            headers.set(uiConfig.api.channelTokenKey, channelToken);
        }

        // Business content follows the content language by default. Dashboard configuration
        // definitions can explicitly use the display language without changing product content.
        let finalUrl = url;
        try {
            const userSettings = localStorage.getItem(LS_KEY_USER_SETTINGS);
            const settings = userSettings ? JSON.parse(userSettings) : undefined;
            finalUrl = addDashboardLanguageParams(finalUrl, settings, displayLanguage);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn('Failed to read content language from user settings:', error);
        }

        const timeoutMs = requestKind === 'mutation' ? MUTATION_TIMEOUT_MS : QUERY_TIMEOUT_MS;
        const controller = new AbortController();
        let timedOut = false;
        const abortFromCaller = () => controller.abort(options.signal?.reason);
        if (options.signal?.aborted) {
            abortFromCaller();
        } else {
            options.signal?.addEventListener('abort', abortFromCaller, { once: true });
        }
        const timeoutId = globalThis.setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);

        try {
            const response = await fetch(finalUrl, {
                ...options,
                headers,
                credentials: 'include',
                mode: 'cors',
                signal: controller.signal,
            });
            const authToken = response.headers.get(uiConfig.api.authTokenHeaderKey);
            if (authToken) {
                localStorage.setItem(LS_KEY_SESSION_TOKEN, authToken);
            }
            return response;
        } catch (error) {
            if (timedOut) {
                throw new Error(
                    requestKind === 'mutation'
                        ? '提交超时（90 秒），请先刷新确认数据是否已保存，再决定是否重试'
                        : '加载超时（30 秒），请检查网络或稍后重试',
                );
            }
            throw error;
        } finally {
            globalThis.clearTimeout(timeoutId);
            options.signal?.removeEventListener('abort', abortFromCaller);
        }
    },
});

/**
 * @description
 * Handles the scenario where there's an invalid channel token in local storage.
 * Most often seen in local development when testing multiple backends on the same
 * localhost origin.
 */
function handleInvalidChannelToken(err: unknown) {
    if (err instanceof Error) {
        if ((err as any).extensions?.code === 'CHANNEL_NOT_FOUND') {
            localStorage.removeItem(LS_KEY_SELECTED_CHANNEL_TOKEN);
        }
    }
}

function withRequestKind(headers: HeadersInit | undefined, kind: 'query' | 'mutation'): Headers {
    const nextHeaders = new Headers(headers);
    nextHeaders.set(REQUEST_KIND_HEADER, kind);
    return nextHeaders;
}

function handleRequestError(err: unknown): never {
    handleInvalidChannelToken(err);
    throw err;
}

export type VariablesAndRequestHeadersArgs<V extends Variables> =
    V extends Record<any, never>
        ? [variables?: V, requestHeaders?: HeadersInit]
        : [variables: V, requestHeaders?: HeadersInit];

function query<T, V extends Variables = Variables>(
    document: RequestDocument | TypedDocumentNode<T, V>,
    variables?: V,
    requestHeaders?: HeadersInit,
): Promise<T> {
    const documentString = typeof document === 'string' ? document : print(document);
    return awesomeClient
        .request(documentString, variables, { headers: withRequestKind(requestHeaders, 'query') })
        .catch(handleRequestError) as any;
}

/**
 * Queries localized configuration metadata in the dashboard display language.
 * Product and other business content continues to use the independently selected content language.
 */
function queryForDisplayLanguage<T, V extends Variables = Variables>(
    document: RequestDocument | TypedDocumentNode<T, V>,
    displayLanguage: string,
    variables?: V,
): Promise<T> {
    return query(document, variables, { [DISPLAY_LANGUAGE_HEADER]: displayLanguage });
}

/**
 * Runs a read-only query against a specific channel without changing the active channel.
 * This is useful for cross-channel reporting where switching the global dashboard context
 * for every request would invalidate unrelated page data.
 */
function queryForChannel<T, V extends Variables = Variables>(
    document: RequestDocument | TypedDocumentNode<T, V>,
    channelToken: string,
    variables?: V,
): Promise<T> {
    return query(document, variables, { [uiConfig.api.channelTokenKey]: channelToken });
}

function mutate<T, V extends Variables = Variables>(
    document: TypedDocumentNode<T, V>,
): (variables: V) => Promise<T>;
function mutate(document: RequestDocument): (variables: Variables) => Promise<unknown>;
function mutate<T, V extends Variables = Variables>(
    document: TypedDocumentNode<T, V>,
    variables: V,
    requestHeaders?: HeadersInit,
): Promise<T>;
function mutate(
    document: RequestDocument,
    variables: Variables,
    requestHeaders?: HeadersInit,
): Promise<unknown>;
function mutate<T, V extends Variables = Variables>(
    document: RequestDocument | TypedDocumentNode<T, V>,
    maybeVariables?: V,
    requestHeaders?: HeadersInit,
): Promise<T> | ((variables: V) => Promise<T>) {
    const documentString = typeof document === 'string' ? document : print(document);
    if (maybeVariables) {
        return awesomeClient
            .request(documentString, maybeVariables, {
                headers: withRequestKind(requestHeaders, 'mutation'),
            })
            .catch(handleRequestError) as any;
    } else {
        return (variables: V): Promise<T> => {
            return awesomeClient
                .request(documentString, variables, {
                    headers: withRequestKind(undefined, 'mutation'),
                })
                .catch(handleRequestError) as any;
        };
    }
}

export const api = {
    query,
    queryForDisplayLanguage,
    queryForChannel,
    mutate,
};
