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

        // This header is only used internally to select the request language.
        // Do not send it to the API, where it would trigger an unnecessary CORS preflight.
        headers.delete(DISPLAY_LANGUAGE_HEADER);

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

        return fetch(finalUrl, {
            ...options,
            headers,
            credentials: 'include',
            mode: 'cors',
        }).then(res => {
            const authToken = res.headers.get(uiConfig.api.authTokenHeaderKey);
            if (authToken) {
                localStorage.setItem(LS_KEY_SESSION_TOKEN, authToken);
            }
            return res;
        });
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
    return awesomeClient.request(documentString, variables, { headers: requestHeaders }).catch(err => {
        handleInvalidChannelToken(err);
        throw err;
    }) as any;
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
): Promise<T>;
function mutate(document: RequestDocument, variables: Variables): Promise<unknown>;
function mutate<T, V extends Variables = Variables>(
    document: RequestDocument | TypedDocumentNode<T, V>,
    maybeVariables?: V,
): Promise<T> | ((variables: V) => Promise<T>) {
    const documentString = typeof document === 'string' ? document : print(document);
    if (maybeVariables) {
        return awesomeClient.request(documentString, maybeVariables) as any;
    } else {
        return (variables: V): Promise<T> => {
            return awesomeClient.request(documentString, variables) as any;
        };
    }
}

export const api = {
    query,
    queryForDisplayLanguage,
    queryForChannel,
    mutate,
};
