import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Asset,
    AssetService,
    Customer,
    CustomerService,
    Permission,
    RequestContext,
    TransactionalConnection,
    User,
    UserInputError,
} from '@vendure/core';
import { ReferralWalletSpendService } from '@vendure/store-management-plugin';

import { ImageGenerationJob } from './entities/image-generation-job.entity';
import { ImageGenerationOutput } from './entities/image-generation-output.entity';
import { ImageGenerationAdministration } from './image-generation-administration';
import { ImageGenerationCatalog } from './image-generation-catalog';
import { ImageGenerationConfigService } from './image-generation-config.service';
import { ImageGenerationCreation } from './image-generation-creation';
import { ImageGenerationCustomerJobs } from './image-generation-customer-jobs';
import { supportsGenerationLock } from './image-generation-helpers';
import { ImageGenerationJobViews } from './image-generation-job-views';
import { ImageGenerationLifecycle } from './image-generation-lifecycle';
import { ImageGenerationReferences } from './image-generation-references';
import { ImageGenerationRequestPolicy } from './image-generation-request-policy';
import { ImageGenerationSettlement } from './image-generation-settlement';
import { ImageGenerationUsageQuery } from './image-generation-usage-query';
import { ImageUsageQuotaService } from './image-usage-quota.service';
import { ImagePromptEngineService } from './prompt/image-prompt-engine.service';
import {
    promptLanguageFromLanguageCode,
    PromptRulesService,
    type PromptOutputLanguage,
} from './prompt/prompt-rules.service';
import { ImagePrivateStorageService, UploadedImageFile } from './storage/image-private-storage.service';
import {
    CreateCatalogImageGenerationInput,
    CreateImageGenerationInput,
    ImageAiUsageRecordListInput,
    OptimizeImagePromptInput,
} from './types';

@Injectable()
export class ImageGenerationService {
    private enqueueOutput?: (outputId: ID) => Promise<void>;
    private readonly usageQuery: ImageGenerationUsageQuery;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
        private readonly walletSpend: ReferralWalletSpendService,
        private readonly configService: ImageGenerationConfigService,
        private readonly quota: ImageUsageQuotaService,
        private readonly promptEngine: ImagePromptEngineService,
        private readonly rules: PromptRulesService,
        private readonly storage: ImagePrivateStorageService,
        private readonly assetService: AssetService,
    ) {
        this.usageQuery = new ImageGenerationUsageQuery(connection);
    }

    registerEnqueuer(enqueue: (outputId: ID) => Promise<void>): void {
        this.enqueueOutput = enqueue;
    }

    async catalogConfig(ctx: RequestContext) {
        return this.catalogJobs().catalogConfig(ctx);
    }

    async uploadCatalogReference(
        ctx: RequestContext,
        upload: Promise<UploadedImageFile>,
        termsAccepted: boolean,
    ) {
        return this.catalogJobs().uploadCatalogReference(ctx, upload, termsAccepted);
    }

    async releaseCatalogReference(ctx: RequestContext, assetId: ID) {
        return this.catalogJobs().releaseCatalogReference(ctx, assetId);
    }

    async createCatalogGeneration(ctx: RequestContext, input: CreateCatalogImageGenerationInput) {
        return this.catalogJobs().createCatalogGeneration(ctx, input);
    }

    async catalogGeneration(ctx: RequestContext, id: ID) {
        return this.catalogJobs().catalogGeneration(ctx, id);
    }

    async catalogGenerations(ctx: RequestContext, skip = 0, take = 10) {
        return this.catalogJobs().catalogGenerations(ctx, skip, take);
    }

    async useCatalogOutput(ctx: RequestContext, outputId: ID): Promise<Asset> {
        return this.catalogJobs().useCatalogOutput(ctx, outputId);
    }

    async create(ctx: RequestContext, input: CreateImageGenerationInput) {
        const getEnqueuer = () => this.enqueueOutput?.bind(this);
        return new ImageGenerationCreation(
            {
                connection: this.connection,
                configService: this.configService,
                rules: this.rules,
                promptEngine: this.promptEngine,
                storage: this.storage,
                quota: this.quota,
                walletSpend: this.walletSpend,
                activeCustomer: requestContext => this.activeCustomer(requestContext),
                findMine: (requestContext, id) => this.findMine(requestContext, id),
                get enqueueOutput() {
                    return getEnqueuer();
                },
            },
            new ImageGenerationRequestPolicy(this.rules),
            new ImageGenerationJobViews(this.connection, this.storage, requestContext =>
                this.configService.isStorefrontEntryEnabled(requestContext),
            ),
        ).create(ctx, input);
    }

    async uploadReference(ctx: RequestContext, upload: Promise<UploadedImageFile>, termsAccepted: boolean) {
        return this.references().uploadReference(ctx, upload, termsAccepted);
    }

    async findMine(ctx: RequestContext, id: ID) {
        return this.customerJobs().findMine(ctx, id);
    }

    async findMineList(ctx: RequestContext, skip = 0, take = 20, states?: string[]) {
        return this.customerJobs().findMineList(ctx, skip, take, states);
    }

    async jobView(ctx: RequestContext, job: ImageGenerationJob, customerId: ID) {
        return new ImageGenerationJobViews(this.connection, this.storage, requestContext =>
            this.configService.isStorefrontEntryEnabled(requestContext),
        ).jobView(ctx, job, customerId);
    }

    async cancelQueued(ctx: RequestContext, id: ID) {
        return this.customerJobs().cancelQueued(ctx, id);
    }

    async deleteOutput(ctx: RequestContext, outputId: ID): Promise<boolean> {
        return this.customerJobs().deleteOutput(ctx, outputId);
    }

    async wallet(ctx: RequestContext): Promise<{ availableBalance: number; currencyCode: string }> {
        return this.customerJobs().wallet(ctx);
    }

    async walletBalance(ctx: RequestContext): Promise<number> {
        return this.customerJobs().walletBalance(ctx);
    }

    async modelQuotaStatus(ctx: RequestContext) {
        return this.customerJobs().modelQuotaStatus(ctx);
    }

    async adminJobs(ctx: RequestContext, skip = 0, take = 50, state?: string | null) {
        return this.administration().adminJobs(ctx, skip, take, state);
    }

    async adminUsageRecords(ctx: RequestContext, input: ImageAiUsageRecordListInput = {}) {
        return this.administration().adminUsageRecords(ctx, input);
    }

    async adminUsageRecordDetail(ctx: RequestContext, recordType: string, id: ID) {
        return this.administration().adminUsageRecordDetail(ctx, recordType, id);
    }

    async adminCostSummary(ctx: RequestContext, days = 30) {
        return this.administration().adminCostSummary(ctx, days);
    }

    async deleteJob(ctx: RequestContext, id: ID): Promise<boolean> {
        return this.customerJobs().deleteJob(ctx, id);
    }

    purgeSensitiveRecords(): number {
        return this.administration().purgeSensitiveRecords();
    }

    async complianceAnonymizeCustomer(ctx: RequestContext, customerId: ID, reason: string) {
        return this.administration().complianceAnonymizeCustomer(ctx, customerId, reason);
    }

    async adminRetryUnknown(ctx: RequestContext, outputId: ID) {
        return this.administration().adminRetryUnknown(ctx, outputId);
    }

    async adminRefundOutput(ctx: RequestContext, outputId: ID, reason: string) {
        return this.administration().adminRefundOutput(ctx, outputId, reason);
    }

    async failQueuedOutput(
        ctx: RequestContext,
        outputId: ID,
        message: string,
        failureCode?: string,
    ): Promise<void> {
        return this.lifecycle().failQueuedOutput(ctx, outputId, message, failureCode);
    }

    settleSuccessfulOutput(
        ctx: RequestContext,
        outputId: ID,
        assetId: ID,
        providerRequestId?: string,
    ): Promise<ImageGenerationOutput> {
        return new ImageGenerationSettlement(
            this.connection,
            this.walletSpend,
            this.quota,
        ).settleSuccessfulOutput(ctx, outputId, assetId, providerRequestId);
    }

    async failRunningOutput(
        ctx: RequestContext,
        outputId: ID,
        message: string,
        failureCode?: string,
    ): Promise<boolean> {
        return this.lifecycle().failRunningOutput(ctx, outputId, message, failureCode);
    }

    async settleUnreleasedTerminalOutput(ctx: RequestContext, outputId: ID): Promise<boolean> {
        return this.lifecycle().settleUnreleasedTerminalOutput(ctx, outputId);
    }

    async releaseUnknownOlderThan(ctx: RequestContext, cutoff: Date): Promise<number> {
        return this.lifecycle().releaseUnknownOlderThan(ctx, cutoff);
    }

    async reconcileStaleOutputs(ctx: RequestContext, cutoff = this.staleOutputCutoff()): Promise<number> {
        return this.lifecycle().reconcileStaleOutputs(ctx, cutoff);
    }

    private staleOutputCutoff(): Date {
        return this.lifecycle().staleOutputCutoff();
    }

    previewImageGenerationPrompt(ctx: RequestContext, input: OptimizeImagePromptInput) {
        const normalized = this.validatePromptInput(input, promptLanguageFromLanguageCode(ctx.languageCode));
        const spec = this.rules.fallbackSpec(
            normalized.prompt,
            normalized.referenceMode,
            normalized.promptLanguage,
        );
        const compiled = this.compileFinalPrompt(normalized, spec, false);
        return { length: compiled.length, limit: 8000, valid: compiled.length <= 8000 };
    }

    private validatePromptInput(
        input: Pick<
            CreateImageGenerationInput,
            | 'prompt'
            | 'optimizedPrompt'
            | 'referenceMode'
            | 'referenceAssetId'
            | 'referenceAssetIds'
            | 'referenceInstruction'
        >,
        fallbackLanguage: PromptOutputLanguage = 'en',
    ) {
        return new ImageGenerationRequestPolicy(this.rules).validatePromptInput(input, fallbackLanguage);
    }

    private compileFinalPrompt(
        input: ReturnType<ImageGenerationService['validatePromptInput']>,
        promptSpec: ReturnType<PromptRulesService['fallbackSpec']>,
        enforceLimit = true,
    ): string {
        return new ImageGenerationRequestPolicy(this.rules).compileFinalPrompt(
            input,
            promptSpec,
            enforceLimit,
        );
    }

    private transitionAndRelease(
        ctx: RequestContext,
        job: ImageGenerationJob,
        output: ImageGenerationOutput,
        fromStates: string[],
        targetState: 'FAILED' | 'CANCELLED',
        message: string,
        failureCode?: string,
    ): Promise<boolean> {
        return new ImageGenerationSettlement(
            this.connection,
            this.walletSpend,
            this.quota,
        ).transitionAndRelease(ctx, job, output, fromStates, targetState, message, failureCode);
    }

    async refreshJob(ctx: RequestContext, jobId: ID): Promise<void> {
        return this.lifecycle().refreshJob(ctx, jobId);
    }

    /** Database-only settlement; the caller owns the transaction and post-commit reference cleanup. */
    private async refreshJobSettlement(txCtx: RequestContext, jobId: ID) {
        return new ImageGenerationSettlement(
            this.connection,
            this.walletSpend,
            this.quota,
        ).refreshJobSettlement(txCtx, jobId);
    }

    async releaseReference(ctx: RequestContext, assetId: ID) {
        return this.references().releaseReference(ctx, assetId);
    }

    private assertCatalogImagePermissions(ctx: RequestContext): void {
        const canEditProduct = ctx.userHasPermissions([
            Permission.SuperAdmin,
            Permission.CreateProduct,
            Permission.UpdateProduct,
            Permission.CreateCatalog,
            Permission.UpdateCatalog,
        ]);
        const canCreateAsset = ctx.userHasPermissions([
            Permission.SuperAdmin,
            Permission.CreateAsset,
            Permission.CreateCatalog,
        ]);
        if (!canEditProduct || !canCreateAsset)
            throw new UserInputError('需要商品编辑和素材创建权限才能生成商品主图');
    }

    private activeAdministratorId(ctx: RequestContext): ID {
        if (!ctx.activeUserId) throw new UserInputError('请先登录管理后台');
        return ctx.activeUserId;
    }

    private async lockAdministrator(ctx: RequestContext, administratorUserId: ID): Promise<void> {
        const query = this.connection
            .getRepository(ctx, User)
            .createQueryBuilder('user')
            .where('user.id = :id', { id: administratorUserId });
        if (supportsGenerationLock(this.connection.rawConnection.options.type))
            query.setLock('pessimistic_write');
        if (!(await query.getOne())) throw new UserInputError('找不到当前管理员');
    }

    private async activeCustomer(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('找不到当前客户');
        return customer;
    }

    private catalogJobs(): ImageGenerationCatalog {
        const getEnqueuer = () => this.enqueueOutput?.bind(this);
        return new ImageGenerationCatalog(
            {
                connection: this.connection,
                configService: this.configService,
                rules: this.rules,
                promptEngine: this.promptEngine,
                storage: this.storage,
                assetService: this.assetService,
                assertCatalogImagePermissions: this.assertCatalogImagePermissions.bind(this),
                activeAdministratorId: this.activeAdministratorId.bind(this),
                lockAdministrator: this.lockAdministrator.bind(this),
                staleOutputCutoff: this.staleOutputCutoff.bind(this),
                reconcileStaleOutputs: this.reconcileStaleOutputs.bind(this),
                catalogConfig: this.catalogConfig.bind(this),
                catalogGeneration: this.catalogGeneration.bind(this),
                get enqueueOutput() {
                    return getEnqueuer();
                },
            },
            new ImageGenerationRequestPolicy(this.rules),
            new ImageGenerationJobViews(this.connection, this.storage, ctx =>
                this.configService.isStorefrontEntryEnabled(ctx),
            ),
        );
    }

    private references(): ImageGenerationReferences {
        return new ImageGenerationReferences(
            {
                connection: this.connection,
                configService: this.configService,
                storage: this.storage,
                activeCustomer: this.activeCustomer.bind(this),
            },
            new ImageGenerationJobViews(this.connection, this.storage, ctx =>
                this.configService.isStorefrontEntryEnabled(ctx),
            ),
        );
    }

    private customerJobs(): ImageGenerationCustomerJobs {
        return new ImageGenerationCustomerJobs(
            {
                connection: this.connection,
                storage: this.storage,
                quota: this.quota,
                activeCustomer: this.activeCustomer.bind(this),
                staleOutputCutoff: this.staleOutputCutoff.bind(this),
                reconcileStaleOutputs: this.reconcileStaleOutputs.bind(this),
                refreshJob: this.refreshJob.bind(this),
                transitionAndRelease: this.transitionAndRelease.bind(this),
                findMine: this.findMine.bind(this),
                wallet: this.wallet.bind(this),
            },
            new ImageGenerationJobViews(this.connection, this.storage, ctx =>
                this.configService.isStorefrontEntryEnabled(ctx),
            ),
        );
    }

    private administration(): ImageGenerationAdministration {
        const getEnqueuer = () => this.enqueueOutput?.bind(this);
        return new ImageGenerationAdministration(
            {
                connection: this.connection,
                configService: this.configService,
                storage: this.storage,
                quota: this.quota,
                walletSpend: this.walletSpend,
                reconcileStaleOutputs: this.reconcileStaleOutputs.bind(this),
                refreshJobSettlement: this.refreshJobSettlement.bind(this),
                get enqueueOutput() {
                    return getEnqueuer();
                },
            },
            new ImageGenerationJobViews(this.connection, this.storage, ctx =>
                this.configService.isStorefrontEntryEnabled(ctx),
            ),
            this.usageQuery,
        );
    }

    private lifecycle(): ImageGenerationLifecycle {
        return new ImageGenerationLifecycle({
            connection: this.connection,
            storage: this.storage,
            lockAdministrator: this.lockAdministrator.bind(this),
            refreshJob: this.refreshJob.bind(this),
            refreshJobSettlement: this.refreshJobSettlement.bind(this),
            releaseUnknownOlderThan: this.releaseUnknownOlderThan.bind(this),
            transitionAndRelease: this.transitionAndRelease.bind(this),
        });
    }
}

export interface UsageTimelineItem {
    at: Date;
    stage: string;
    status: string;
    amount: number | null;
    currencyCode: string | null;
    costMicrounits: number | null;
    message: string;
    keyName: string | null;
    keyLast4: string | null;
}

export { referenceModeInstruction } from './image-generation-helpers';
