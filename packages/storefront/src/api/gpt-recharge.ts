import type { ShopAbuseClient, ShopAbuseProof } from '../shop-abuse';

import {
    type GptRechargeClient,
    type RechargeCode,
    type RechargeTask,
} from '../client-plugins/gpt-recharge/contracts';

import { type ShopApiContext } from './client-context';
import { requestShopAbuseChallenge } from './shop-abuse';

const taskFields =
    'id credential plan status stage updatedAt accountEmail progress { attempt execution version changedAt retryAt milestones { key state at } }';
const codeFields = `plan status reason task { ${taskFields} }`;
export class GptRechargeApi implements GptRechargeClient {
    createShopAbuseChallenge: ShopAbuseClient['createShopAbuseChallenge'];
    constructor(
        private readonly ctx: Pick<ShopApiContext, 'request'> &
            Partial<Pick<ShopApiContext, 'market' | 'getAuthToken'>>,
    ) {
        this.createShopAbuseChallenge = requestShopAbuseChallenge.bind(null, ctx);
    }
    async config(signal?: AbortSignal) {
        return (
            await this.ctx.request<{ gptRechargeConfig: { enabled: boolean; maintenance: boolean } }>(
                'query GptRechargeConfig { gptRechargeConfig { enabled maintenance } }',
                {},
                signal,
            )
        ).gptRechargeConfig;
    }
    async verify(code: string, proof?: ShopAbuseProof): Promise<RechargeCode> {
        return (
            await this.ctx.request<{ verifyGptRechargeCode: RechargeCode }>(
                `mutation VerifyGptRechargeCode($code: String!) { verifyGptRechargeCode(code: $code) { ${codeFields} } }`,
                { code },
                undefined,
                undefined,
                undefined,
                undefined,
                proof,
            )
        ).verifyGptRechargeCode;
    }
    async submit(code: string, session: string, proof?: ShopAbuseProof): Promise<RechargeTask> {
        return (
            await this.ctx.request<{ submitGptRecharge: RechargeTask }>(
                `mutation SubmitGptRecharge($code: String!, $session: String!) { submitGptRecharge(code: $code, session: $session) { ${taskFields} } }`,
                { code, session },
                undefined,
                25000,
                true,
                undefined,
                proof,
            )
        ).submitGptRecharge;
    }
    async authorize(code: string, requestKey: string, proof?: ShopAbuseProof) {
        type Authorization = { authorizationUrl?: string | null; task: RechargeTask };
        return (
            await this.ctx.request<{ startGptRechargeAuthorization: Authorization }>(
                `mutation StartGptRechargeAuthorization($code: String!, $requestKey: String!) {
                    startGptRechargeAuthorization(code: $code, requestKey: $requestKey) {
                        authorizationUrl
                        task { ${taskFields} }
                    }
                }`,
                { code, requestKey },
                undefined,
                25000,
                true,
                undefined,
                proof,
            )
        ).startGptRechargeAuthorization;
    }
    async query(code: string, proof?: ShopAbuseProof): Promise<RechargeCode> {
        return (
            await this.ctx.request<{ queryGptRechargeCode: RechargeCode }>(
                `mutation QueryGptRechargeCode($code: String!) { queryGptRechargeCode(code: $code) { ${codeFields} } }`,
                { code },
                undefined,
                undefined,
                undefined,
                undefined,
                proof,
            )
        ).queryGptRechargeCode;
    }
    async watch(
        id: string,
        credential: string,
        signal: AbortSignal,
        onTask: (task: RechargeTask) => void,
        onConnection: (state: 'connecting' | 'live' | 'error' | 'denied') => void,
    ) {
        const { watchRechargeEvents } = await import('./recharge-events');
        if (signal.aborted) return;
        return watchRechargeEvents(
            id,
            credential,
            this.ctx.market?.code ?? '',
            this.ctx.getAuthToken ?? (() => null),
            signal,
            onTask,
            onConnection,
        );
    }
    async task(id: string, credential: string, signal?: AbortSignal): Promise<RechargeTask> {
        return (
            await this.ctx.request<{ gptRechargeTask: RechargeTask }>(
                `query GptRechargeTask($id: ID!, $credential: String!) { gptRechargeTask(id: $id, credential: $credential) { ${taskFields} } }`,
                { id, credential },
                signal,
            )
        ).gptRechargeTask;
    }
}
