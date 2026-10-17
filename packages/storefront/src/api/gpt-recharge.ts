import type { ShopAbuseClient, ShopAbuseProof } from '../shop-abuse';

import {
    type GptRechargeClient,
    type RechargeCode,
    type RechargeTask,
} from '../client-plugins/gpt-recharge/contracts';

import { type ShopApiContext } from './client-context';
import { requestShopAbuseChallenge } from './shop-abuse';

const taskFields = 'id credential plan status updatedAt';
const codeFields = `plan status task { ${taskFields} }`;
export class GptRechargeApi implements GptRechargeClient {
    createShopAbuseChallenge: ShopAbuseClient['createShopAbuseChallenge'];
    constructor(private readonly ctx: Pick<ShopApiContext, 'request'>) {
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
