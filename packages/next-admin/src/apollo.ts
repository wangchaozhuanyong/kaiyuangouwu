import { ApolloClient, ApolloLink, InMemoryCache, createHttpLink, gql } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';

import { adminMutationFeedbackLink } from './apollo-mutation-feedback';
import { CUSTOM_FIELD_POSSIBLE_TYPES } from './custom-fields/custom-fields.graphql';
import { createAdminFeedbackId, publishAdminFeedback } from './utils/admin-feedback';
import { toUserFacingError } from './utils/user-facing-error';

const AUTH_TOKEN_KEY = 'vendure-auth-token';
const AUTH_PERSISTENCE_KEY = 'vendure-auth-persistence';
const AUTH_TOKEN_HEADER = 'vendure-auth-token';
const ACTIVE_CHANNEL_HEADER = 'vendure-token';
const ACTIVE_CHANNEL_TOKEN_KEY = 'vendure-active-channel-token';
const SENSITIVE_ACTION_PASSWORD_HEADER = 'x-vendure-sensitive-action-password';

export const ADMIN_API_URL = import.meta.env.VITE_VENDURE_ADMIN_API_URL?.trim() || '/admin-api';

export const getServerHealthUrl = () => {
    const apiUrl = new URL(ADMIN_API_URL, window.location.origin);
    apiUrl.pathname = '/health';
    apiUrl.search = '';
    apiUrl.hash = '';
    return apiUrl.toString();
};

const getAuthToken = () => sessionStorage.getItem(AUTH_TOKEN_KEY) || localStorage.getItem(AUTH_TOKEN_KEY);

const getActiveChannelToken = () => localStorage.getItem(ACTIVE_CHANNEL_TOKEN_KEY);

export const hasActiveChannelSelection = () => Boolean(getActiveChannelToken());

export const setInitialActiveChannel = (channelToken: string) => {
    if (channelToken.trim()) localStorage.setItem(ACTIVE_CHANNEL_TOKEN_KEY, channelToken);
};

const persistAuthToken = (token: string) => {
    const persistence = sessionStorage.getItem(AUTH_PERSISTENCE_KEY);
    if (persistence === 'session') {
        sessionStorage.setItem(AUTH_TOKEN_KEY, token);
        localStorage.removeItem(AUTH_TOKEN_KEY);
    } else {
        localStorage.setItem(AUTH_TOKEN_KEY, token);
        sessionStorage.removeItem(AUTH_TOKEN_KEY);
    }
};

export const prepareAuthSession = (rememberMe: boolean) => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(ACTIVE_CHANNEL_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.setItem(AUTH_PERSISTENCE_KEY, rememberMe ? 'local' : 'session');
};

export const clearAuthSession = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(ACTIVE_CHANNEL_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_PERSISTENCE_KEY);
};

export const sensitiveActionContext = (currentPassword: string) => ({
    headers: {
        [SENSITIVE_ACTION_PASSWORD_HEADER]: currentPassword,
    },
});

const vendureFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, {
        ...init,
        credentials: 'include',
    });
    const authToken = response.headers.get(AUTH_TOKEN_HEADER);
    if (authToken) persistAuthToken(authToken);
    return response;
};

interface GraphqlUploadResponse<T> {
    data?: T;
    errors?: Array<{ message: string }>;
}

/**
 * Vendure 的 Upload 标量遵循 GraphQL multipart request 规范，普通 HttpLink
 * 无法直接序列化浏览器 File，因此素材上传单独走 FormData 请求。
 */
export const uploadAdminFiles = async <T>(
    query: string,
    files: File[],
    buildVariables: (filePlaceholders: null[]) => Record<string, unknown>,
): Promise<T> => {
    const feedbackId = createAdminFeedbackId('admin-upload');
    publishAdminFeedback({
        id: feedbackId,
        kind: 'loading',
        title: '上传中…',
        message: '正在等待管理服务返回结果，请勿重复提交',
    });

    try {
        const formData = new FormData();
        const variables = buildVariables(files.map(() => null));
        const fileMap = Object.fromEntries(
            files.map((_, index) => [String(index), [`variables.input.${index}.file`]]),
        );

        formData.append('operations', JSON.stringify({ query, variables }));
        formData.append('map', JSON.stringify(fileMap));
        files.forEach((file, index) => formData.append(String(index), file, file.name));

        const token = getAuthToken();
        const response = await vendureFetch(ADMIN_API_URL, {
            method: 'POST',
            headers: token ? { authorization: `Bearer ${token}` } : undefined,
            body: formData,
        });
        const result = (await response.json()) as GraphqlUploadResponse<T>;

        if (!response.ok || result.errors?.length) {
            throw new Error(
                result.errors?.map(error => error.message).join('；') || `上传请求失败 (${response.status})`,
            );
        }
        if (!result.data) {
            throw new Error('上传成功但后端未返回数据');
        }
        publishAdminFeedback({ id: feedbackId, kind: 'success', title: '上传成功' });
        return result.data;
    } catch (error) {
        publishAdminFeedback({
            id: feedbackId,
            kind: 'error',
            title: '上传失败',
            message: toUserFacingError(error, '上传失败，请检查文件和账号权限后重试'),
        });
        throw error;
    }
};

// 指向 Vendure 真实的 Admin GraphQL API，并同时支持 Cookie 与 Bearer Token。
const httpLink = createHttpLink({
    uri: ADMIN_API_URL,
    credentials: 'include',
    fetch: vendureFetch,
});

// 在请求头中注入 Token
const authLink = setContext((_, { headers }) => {
    const token = getAuthToken();
    const channelToken = getActiveChannelToken();
    return {
        headers: {
            ...headers,
            authorization: token ? `Bearer ${token}` : '',
            ...(channelToken ? { [ACTIVE_CHANNEL_HEADER]: channelToken } : {}),
        },
    };
});

export const client = new ApolloClient({
    link: ApolloLink.from([authLink, adminMutationFeedbackLink, httpLink]),
    cache: new InMemoryCache({ possibleTypes: CUSTOM_FIELD_POSSIBLE_TYPES }),
});

const LOGOUT_MUTATION = gql`
    mutation LogoutAdministrator {
        logout {
            success
        }
    }
`;

export const logoutAdministrator = async () => {
    try {
        await client.mutate({ mutation: LOGOUT_MUTATION, context: { adminFeedback: false } });
    } finally {
        clearAuthSession();
        await client.clearStore();
    }
};

export const switchActiveChannel = async (channelToken: string) => {
    if (!channelToken.trim()) {
        throw new Error('销售渠道标识不能为空');
    }
    setInitialActiveChannel(channelToken);
    await client.resetStore();
};
