import type { GptRechargeClient, RechargeCode, RechargeTask } from '../client-plugins/gpt-recharge/contracts';

import { shopAbuseHeaders, type ShopAbuseChallenge, type ShopAbuseProof } from '../shop-abuse';

import {
    createRequestSignal,
    createShopApiTimeoutError,
    parseShopApiResponse,
    SHOP_API_QUERY_TIMEOUT_MS,
} from './helpers';
import { standaloneRechargeApiPath } from './standalone-recharge-path';

type PortalResponses = {
    config: { gptRechargeConfig: { enabled: boolean; maintenance: boolean } };
    verify: { verifyGptRechargeCode: RechargeCode };
    query: { queryGptRechargeCode: RechargeCode };
    authorize: { startGptRechargeAuthorization: { authorizationUrl?: string | null; task: RechargeTask } };
    task: { gptRechargeTask: RechargeTask };
    challenge: { createShopAbuseChallenge: ShopAbuseChallenge };
};

async function request<K extends keyof PortalResponses>(
    operation: K,
    variables: Record<string, string>,
    signal?: AbortSignal,
    proof?: ShopAbuseProof,
) {
    const authorizing = operation === 'authorize';
    const timeout = createRequestSignal(signal, authorizing ? 25000 : SHOP_API_QUERY_TIMEOUT_MS);
    try {
        const response = await fetch(standaloneRechargeApiPath(operation), {
            method: 'POST',
            credentials: 'omit',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            redirect: 'error',
            headers: { 'content-type': 'application/json', ...shopAbuseHeaders(proof) },
            body: JSON.stringify(variables),
            signal: timeout.signal,
        });
        return parseShopApiResponse<PortalResponses[K]>(await response.text(), response.status, response.ok);
    } catch (error) {
        if (timeout.didTimeout()) throw createShopApiTimeoutError(authorizing);
        throw error;
    } finally {
        timeout.cleanup();
    }
}

/** All requests stay on the portal origin. Store selection is owned by the server. */
export const standaloneRechargeApi: GptRechargeClient = {
    config: async signal => (await request('config', {}, signal)).gptRechargeConfig,
    verify: async (code, proof) =>
        (await request('verify', { code }, undefined, proof)).verifyGptRechargeCode,
    query: async (code, proof) => (await request('query', { code }, undefined, proof)).queryGptRechargeCode,
    task: async (id, credential, signal) =>
        (await request('task', { id, credential }, signal)).gptRechargeTask,
    authorize: async (code, requestKey, proof) =>
        (await request('authorize', { code, requestKey }, undefined, proof)).startGptRechargeAuthorization,
    createShopAbuseChallenge: async (action, target, signal) =>
        (await request('challenge', { action, target }, signal)).createShopAbuseChallenge,
    async watch(id, credential, signal, onTask, onConnection) {
        const { watchRechargeEvents } = await import('./recharge-events');
        if (!signal.aborted)
            await watchRechargeEvents(id, credential, '', () => null, signal, onTask, onConnection, true);
    },
};
