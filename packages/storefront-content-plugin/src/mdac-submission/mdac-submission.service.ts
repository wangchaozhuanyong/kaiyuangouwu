import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RequestContext, UserInputError } from '@vendure/core';

import { StorefrontContentService } from '../storefront-content.service';

import { MdacSubmissionStore, type MdacSubmissionRecord } from './mdac-submission.store';
import {
    malaysiaTodayIso,
    normalizeOfficialPayload,
    submissionWindowOpensAt,
    type MdacSubmissionInput,
    type MdacSubmissionStatus,
} from './mdac-submission.types';
import { MdacSubmitter, type MdacSubmitOutcome } from './mdac-submitter';

export interface MdacSubmissionView {
    id: string;
    status: MdacSubmissionStatus;
    referenceNo?: string;
    pin?: string;
    attempts: number;
    lastError?: string;
    submittedAt?: string;
    receiptAvailable: boolean;
    waitingForWindow: boolean;
    travelerName: string;
    arrivalDate: string;
}

export interface MdacSubmissionAdminView extends MdacSubmissionView {
    passportNo: string;
    createdAt: string;
}

const maxAttempts = 5;
const backoffMs = [90_000, 300_000, 900_000, 3_600_000];

function submissionDirectory(): string {
    return process.env.STOREFRONT_MDAC_SUBMIT_DIR?.trim() || `${process.cwd()}/var/mdac-submissions`;
}

function submissionEnabled(): boolean {
    return process.env.STOREFRONT_MDAC_SUBMIT_ENABLED === 'true';
}

/**
 * Owns traveller submissions: validation, idempotency, receipt storage and the
 * worker that posts each traveller to the official MDAC form.
 */
@Injectable()
export class MdacSubmissionService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(MdacSubmissionService.name);
    private store?: MdacSubmissionStore;
    private timer?: ReturnType<typeof setTimeout>;
    private running = false;
    private stopping = false;

    constructor(private readonly content: StorefrontContentService) {}

    async onModuleInit(): Promise<void> {
        if (!submissionEnabled()) return;
        this.store = await MdacSubmissionStore.create(submissionDirectory());
        this.schedule(2_000);
        this.logger.log(`MDAC submission worker enabled (${submissionDirectory()})`);
    }

    onModuleDestroy(): void {
        this.stopping = true;
        if (this.timer) clearTimeout(this.timer);
    }

    async create(ctx: RequestContext, input: MdacSubmissionInput): Promise<MdacSubmissionView> {
        if (!(await this.content.canSubmitMdac(ctx)))
            throw new UserInputError('当前店铺未获准使用入境卡提交');
        if (!submissionEnabled()) throw new UserInputError('自动提交服务尚未启用，请使用官方入口完成提交');
        const normalized = normalizeOfficialPayload(input);
        if (!normalized.submission) {
            throw new UserInputError(`资料不完整或格式不符：${normalized.errors.slice(0, 3).join('；')}`);
        }
        const store = await this.requireStore();
        const { payload, arrivalIso } = normalized.submission;
        const existing = await store.findByPassport(payload.passNo, arrivalIso);
        if (existing) return this.toView(existing);

        const record = await store.create({
            payload,
            arrivalIso,
            channelId: ctx.channelId?.toString() ?? null,
            language: ctx.languageCode ?? 'zh',
        });
        this.logger.log(`MDAC submission queued ${record.id}`);
        this.schedule(500);
        return this.toView(record);
    }

    async find(ctx: RequestContext, id: string): Promise<MdacSubmissionView | undefined> {
        if (!(await this.content.canSubmitMdac(ctx)))
            throw new UserInputError('当前店铺未获准使用入境卡提交');
        const record = await (await this.requireStore()).get(id);
        if (!record || record.channelId !== (ctx.channelId?.toString() ?? null)) return undefined;
        return this.toView(record);
    }

    async receipt(
        ctx: RequestContext,
        id: string,
    ): Promise<{ fileName: string; mimeType: string; base64: string } | undefined> {
        const view = await this.find(ctx, id);
        if (!view) return undefined;
        const store = await this.requireStore();
        const record = await store.get(id);
        if (!record?.receiptFile) return undefined;
        const bytes = await store.readReceipt(id, record.receiptFile);
        if (!bytes) return undefined;
        return {
            fileName: `mdac-${record.payload.passNo}.pdf`,
            mimeType: record.receiptMime ?? 'application/pdf',
            base64: bytes.toString('base64'),
        };
    }

    /** Runs one worker tick. Exposed for tests and for manual pokes from the admin shell. */
    async tick(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            const store = await this.requireStore();
            for (let guard = 0; guard < 5; guard++) {
                const record = await store.claimNext(Date.now());
                if (!record) return;
                await this.process(store, record);
            }
        } catch (error) {
            this.logger.warn(`MDAC worker tick failed: ${String(error).slice(0, 200)}`);
        } finally {
            this.running = false;
        }
    }

    private async process(store: MdacSubmissionStore, record: MdacSubmissionRecord): Promise<void> {
        try {
            const opensAt = submissionWindowOpensAt(record.arrivalIso);
            if (Date.now() < opensAt) {
                record.status = 'QUEUED';
                record.nextAttemptAt = opensAt;
                record.log.push(`waiting for the official window from ${new Date(opensAt).toISOString()}`);
                await store.save(record);
                return;
            }
            const submitter = new MdacSubmitter({
                dryRun: process.env.STOREFRONT_MDAC_SUBMIT_DRY_RUN === 'true',
                proxy: process.env.STOREFRONT_MDAC_SUBMIT_PROXY?.trim() || undefined,
                headless: process.env.STOREFRONT_MDAC_SUBMIT_HEADLESS !== 'false',
                channel: process.env.STOREFRONT_MDAC_SUBMIT_CHANNEL?.trim() || undefined,
            });
            const outcome = await submitter.submit(record.payload, record.log);
            await this.apply(store, record, outcome);
        } catch (error) {
            record.status = 'FAILED';
            record.lastError = `worker error: ${String(error).slice(0, 200)}`;
            record.log.push(record.lastError);
        } finally {
            await store.save(record).catch(() => undefined);
            await store.unlock(record.id);
        }
    }

    private async apply(
        store: MdacSubmissionStore,
        record: MdacSubmissionRecord,
        outcome: MdacSubmitOutcome,
    ): Promise<void> {
        record.log = outcome.log;
        if (outcome.status === 'DONE') {
            record.status = 'DONE';
            record.referenceNo = outcome.referenceNo;
            record.pin = outcome.pin;
            record.submittedAt = new Date().toISOString();
            record.lastError = undefined;
            if (outcome.pdf) {
                record.receiptFile = await store.writeReceipt(
                    record.id,
                    outcome.pdf,
                    outcome.receiptMime ?? 'application/pdf',
                );
                record.receiptBytes = outcome.pdf.length;
                record.receiptMime = outcome.receiptMime ?? 'application/pdf';
            }
            this.logger.log(`MDAC submission done ${record.id} pin=${outcome.pin}`);
            return;
        }
        if (outcome.status === 'MANUAL') {
            record.status = 'MANUAL';
            record.lastError = outcome.detail.slice(0, 300);
            return;
        }
        record.lastError = `${outcome.reason}: ${outcome.detail}`.slice(0, 300);
        const retryable =
            outcome.reason === 'captcha' || outcome.reason === 'network' || outcome.reason === 'unknown';
        if (retryable && record.attempts < maxAttempts) {
            record.status = 'QUEUED';
            record.nextAttemptAt =
                Date.now() + (backoffMs[record.attempts - 1] ?? backoffMs.at(-1) ?? 600_000);
            return;
        }
        record.status = 'FAILED';
    }

    /** Admin queue: newest first, bounded so one page cannot render the whole store. */
    async adminList(filter: {
        status?: MdacSubmissionStatus;
        limit?: number;
    }): Promise<{ items: MdacSubmissionAdminView[]; totalItems: number }> {
        const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
        const matching = (await (await this.requireStore()).all())
            .filter(item => !filter.status || item.status === filter.status)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return {
            items: matching.slice(0, limit).map(item => this.toAdminView(item)),
            totalItems: matching.length,
        };
    }

    /** Puts a failed or manual job back in the queue with a clean attempt budget. */
    async retry(id: string): Promise<MdacSubmissionAdminView | undefined> {
        const store = await this.requireStore();
        const record = await store.get(id);
        if (!record || (record.status !== 'FAILED' && record.status !== 'MANUAL')) return undefined;
        record.status = 'QUEUED';
        record.attempts = 0;
        record.nextAttemptAt = 0;
        record.lastError = undefined;
        record.log.push('requeued by an administrator');
        await store.save(record);
        this.schedule(500);
        return this.toAdminView(record);
    }

    /** Stops a queued or running job from being submitted again. */
    async cancel(id: string): Promise<MdacSubmissionAdminView | undefined> {
        const store = await this.requireStore();
        const record = await store.get(id);
        if (!record || record.status === 'DONE') return undefined;
        record.status = 'FAILED';
        record.lastError = 'cancelled by an administrator';
        record.nextAttemptAt = 0;
        record.log.push('cancelled by an administrator');
        await store.save(record);
        return this.toAdminView(record);
    }

    private toAdminView(record: MdacSubmissionRecord): MdacSubmissionAdminView {
        return {
            ...this.toView(record),
            passportNo: record.payload.passNo,
            createdAt: record.createdAt,
        };
    }

    private toView(record: MdacSubmissionRecord): MdacSubmissionView {
        return {
            id: record.id,
            status: record.status,
            referenceNo: record.referenceNo,
            pin: record.pin,
            attempts: record.attempts,
            lastError: record.lastError,
            submittedAt: record.submittedAt,
            receiptAvailable: Boolean(record.receiptFile),
            waitingForWindow: record.status === 'QUEUED' && (record.nextAttemptAt ?? 0) > Date.now(),
            travelerName: record.payload.name,
            arrivalDate: record.arrivalIso,
        };
    }

    private schedule(delay: number) {
        if (this.stopping) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            void this.tick();
            this.schedule(Number(process.env.STOREFRONT_MDAC_SUBMIT_INTERVAL_MS) || 20_000);
        }, delay);
        this.timer.unref?.();
    }

    private async requireStore(): Promise<MdacSubmissionStore> {
        if (!this.store) {
            this.store = await MdacSubmissionStore.create(submissionDirectory());
        }
        return this.store;
    }
}

export function mdacSubmissionConfigured(): boolean {
    return submissionEnabled();
}

export function mdacTodayIso(): string {
    return malaysiaTodayIso();
}
