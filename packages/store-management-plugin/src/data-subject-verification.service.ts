import { Injectable } from '@nestjs/common';
import { HistoryEntryType } from '@vendure/common/lib/generated-types';
import {
    ConfigService,
    Customer,
    CustomerHistoryEntry,
    CustomerService,
    RequestContext,
    TransactionalConnection,
    User,
    UserInputError,
} from '@vendure/core';
import { createHash, randomBytes } from 'node:crypto';

export type DataSubjectAction = 'EXPORT' | 'ACCOUNT_CLOSURE';
export interface DataSubjectVerification {
    challengeId: string;
    nonce: string;
    credential: string;
}
interface ActionVerifier {
    customerActionClientId(ctx: RequestContext): Promise<string | undefined>;
    verifyCustomerAction(
        ctx: RequestContext,
        proof: { credential: string; nonce: string; issuedAt: number },
    ): Promise<boolean>;
}
interface ChallengeRecord {
    dataSubjectChallenge: string;
    binding: string;
    nonceDigest: string;
    action: DataSubjectAction;
    issuedAt: number;
    expiresAt: number;
    consumed: boolean;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const error = () => new UserInputError('身份确认已过期或无效，请重新确认');

@Injectable()
export class DataSubjectVerificationService {
    constructor(
        private connection: TransactionalConnection,
        private customers: CustomerService,
        private config: ConfigService,
    ) {}

    async start(ctx: RequestContext, action: DataSubjectAction) {
        if (!['EXPORT', 'ACCOUNT_CLOSURE'].includes(action)) throw error();
        const customer = await this.customer(ctx);
        const user = await this.connection
            .getRepository(ctx, User)
            .findOne({ where: { id: ctx.activeUserId }, relations: ['authenticationMethods'] });
        if (!user || user.deletedAt) throw error();
        if (user.getNativeAuthenticationMethod(false))
            return { mode: 'PASSWORD', challengeId: null, nonce: null, clientId: null, expiresAt: null };
        const strategy = this.verifier();
        const clientId = await strategy?.customerActionClientId(ctx);
        if (
            !clientId ||
            !user.authenticationMethods.some(method => 'strategy' in method && method.strategy === 'google')
        )
            throw error();
        return this.connection.withTransaction(ctx, async tx => {
            await this.lockUser(tx);
            const history = this.connection.getRepository(tx, CustomerHistoryEntry);
            const query = history
                .createQueryBuilder('history')
                .where('history.customerId = :customerId', { customerId: customer.id })
                .andWhere('history.type = :type', { type: HistoryEntryType.CUSTOMER_NOTE })
                .andWhere('history.data LIKE :key', { key: '%"dataSubjectChallenge":%' })
                .andWhere('history.createdAt > :cutoff', { cutoff: new Date(Date.now() - 600_000) })
                .orderBy('history.createdAt', 'DESC')
                .take(5);
            this.lockRead(query);
            const recent = await query.getMany();
            if (recent.length >= 5 || (recent[0] && Date.now() - recent[0].createdAt.getTime() < 30_000))
                throw new UserInputError('身份确认请求过于频繁，请稍后重试');
            const challengeId = randomBytes(32).toString('base64url');
            const nonce = randomBytes(32).toString('base64url');
            const issuedAt = Date.now();
            const expiresAt = issuedAt + 300_000;
            const row = new CustomerHistoryEntry({
                customer,
                type: HistoryEntryType.CUSTOMER_NOTE,
                isPublic: false,
            });
            row.data = {
                note: 'Privacy action verification requested',
                dataSubjectChallenge: digest(challengeId),
                binding: this.binding(ctx),
                nonceDigest: digest(nonce),
                action,
                issuedAt,
                expiresAt,
                consumed: false,
            };
            await history.save(row);
            return { mode: 'GOOGLE', challengeId, nonce, clientId, expiresAt: new Date(expiresAt) };
        });
    }

    async consume(
        ctx: RequestContext,
        action: DataSubjectAction,
        proof: DataSubjectVerification,
    ): Promise<void> {
        if (
            !proof ||
            !/^[\w-]{43}$/.test(proof.challengeId) ||
            !/^[\w-]{43}$/.test(proof.nonce) ||
            !proof.credential ||
            proof.credential.length > 16_384
        )
            throw error();
        const customer = await this.customer(ctx);
        const load = (request: RequestContext) => {
            const query = this.connection
                .getRepository(request, CustomerHistoryEntry)
                .createQueryBuilder('history')
                .where('history.customerId = :customerId', { customerId: customer.id })
                .andWhere('history.type = :type', { type: HistoryEntryType.CUSTOMER_NOTE })
                .andWhere('history.data LIKE :key', {
                    key: `%"dataSubjectChallenge":"${digest(proof.challengeId)}"%`,
                })
                .orderBy('history.createdAt', 'DESC');
            return query;
        };
        const row = await load(ctx).getOne();
        const record = row?.data as unknown as ChallengeRecord | undefined;
        this.assertRecord(ctx, action, proof, record);
        const strategy = this.verifier();
        if (
            !strategy ||
            !(await strategy.verifyCustomerAction(ctx, {
                credential: proof.credential,
                nonce: proof.nonce,
                issuedAt: record.issuedAt,
            }))
        )
            throw error();
        // Network verification precedes the short transaction. User locking serializes
        // one-time consumption across API instances, and all binding is checked again.
        await this.connection.withTransaction(ctx, async tx => {
            await this.lockUser(tx);
            const query = load(tx);
            this.lockRead(query);
            const current = await query.getOne();
            if (!current) throw error();
            this.assertRecord(tx, action, proof, current.data);
            current.data = { ...current.data, consumed: true };
            await this.connection.getRepository(tx, CustomerHistoryEntry).save(current);
        });
    }

    private assertRecord(
        ctx: RequestContext,
        action: DataSubjectAction,
        proof: DataSubjectVerification,
        row?: ChallengeRecord,
    ): asserts row is ChallengeRecord {
        if (
            !row ||
            row.consumed ||
            row.action !== action ||
            row.binding !== this.binding(ctx) ||
            row.nonceDigest !== digest(proof.nonce) ||
            !Number.isFinite(row.expiresAt) ||
            row.expiresAt <= Date.now() ||
            !Number.isFinite(row.issuedAt) ||
            row.issuedAt > Date.now()
        )
            throw error();
    }
    private binding(ctx: RequestContext) {
        if (!ctx.activeUserId || !ctx.session?.id) throw error();
        return digest(
            JSON.stringify([String(ctx.activeUserId), String(ctx.session.id), String(ctx.channelId)]),
        );
    }
    private verifier(): ActionVerifier | undefined {
        return this.config.authOptions.shopAuthenticationStrategy.find(
            strategy =>
                strategy.name === 'google' &&
                'verifyCustomerAction' in strategy &&
                'customerActionClientId' in strategy,
        ) as unknown as ActionVerifier | undefined;
    }
    private async customer(ctx: RequestContext): Promise<Customer> {
        this.binding(ctx);
        const userId = ctx.activeUserId;
        if (!userId) throw error();
        const customer = await this.customers.findOneByUserId(ctx, userId);
        if (!customer || customer.deletedAt) throw error();
        return customer;
    }
    private async lockUser(ctx: RequestContext) {
        const query = this.connection
            .getRepository(ctx, User)
            .createQueryBuilder('user')
            .where('user.id = :id AND user.deletedAt IS NULL', { id: ctx.activeUserId });
        this.lockRead(query);
        if (!(await query.getOne())) throw error();
    }
    private lockRead(query: { setLock(mode: 'pessimistic_write'): unknown }) {
        if (
            ['mysql', 'mariadb', 'postgres', 'aurora-mysql', 'aurora-postgres'].includes(
                this.connection.rawConnection.options.type,
            )
        )
            query.setLock('pessimistic_write');
    }
}
