import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext } from '@vendure/core';

import { manageImageGenerationPermission } from './constants';
import { ImageGenerationConfigService } from './image-generation-config.service';
import { ImageGenerationService } from './image-generation.service';
import { ImagePromptEngineService } from './prompt/image-prompt-engine.service';
import { UploadedImageFile } from './storage/image-private-storage.service';
import {
    CreateImageGenerationInput,
    ImageProviderScope,
    OptimizeImagePromptInput,
    SaveImageGenerationConfigInput,
    SaveImageModelInput,
    SaveImageProviderCredentialInput,
} from './types';

@Resolver()
export class ImageGenerationShopResolver {
    constructor(
        private readonly configService: ImageGenerationConfigService,
        private readonly promptEngine: ImagePromptEngineService,
        private readonly generations: ImageGenerationService,
    ) {}

    @Query()
    @Allow(Permission.Public)
    imageStudioConfig(@Ctx() ctx: RequestContext) {
        return this.configService.shopConfig(ctx);
    }

    @Query()
    @Allow(Permission.Authenticated)
    imageStudioBalance(@Ctx() ctx: RequestContext) {
        return this.generations.walletBalance(ctx);
    }

    @Query()
    @Allow(Permission.Authenticated)
    recommendImageModel(@Ctx() ctx: RequestContext, @Args('input') input: OptimizeImagePromptInput) {
        return this.promptEngine.recommend(ctx, input.prompt, input.referenceMode);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myImageGenerationJob(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.generations.findMine(ctx, id);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myImageGenerationJobs(
        @Ctx() ctx: RequestContext,
        @Args('skip') skip?: number,
        @Args('take') take?: number,
    ) {
        return this.generations.findMineList(ctx, skip, take);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    optimizeImagePrompt(@Ctx() ctx: RequestContext, @Args('input') input: OptimizeImagePromptInput) {
        return this.promptEngine.optimize(ctx, input);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    uploadImageReference(
        @Ctx() ctx: RequestContext,
        @Args('file') file: Promise<UploadedImageFile>,
        @Args('termsAccepted') termsAccepted: boolean,
    ) {
        return this.generations.uploadReference(ctx, file, termsAccepted);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    createImageGeneration(@Ctx() ctx: RequestContext, @Args('input') input: CreateImageGenerationInput) {
        return this.generations.create(ctx, input);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    cancelQueuedImageGeneration(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.generations.cancelQueued(ctx, id);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    deleteMyGeneratedImage(@Ctx() ctx: RequestContext, @Args('outputId') outputId: ID) {
        return this.generations.deleteOutput(ctx, outputId);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    deleteMyImageGenerationJob(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.generations.deleteJob(ctx, id);
    }
}

@Resolver()
export class ImageGenerationAdminResolver {
    constructor(
        private readonly configService: ImageGenerationConfigService,
        private readonly generations: ImageGenerationService,
    ) {}

    @Query()
    @Allow(manageImageGenerationPermission.Read)
    imageGenerationAdminConfig(@Ctx() ctx: RequestContext) {
        return this.configService.adminConfig(ctx);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    imageProviderAdminConfigs(@Ctx() ctx: RequestContext) {
        return this.configService.providerAdminConfigs(ctx);
    }

    @Query()
    @Allow(manageImageGenerationPermission.Read)
    imageGenerationJobs(
        @Ctx() ctx: RequestContext,
        @Args('skip') skip?: number,
        @Args('take') take?: number,
        @Args('state') state?: string,
    ) {
        return this.generations.adminJobs(ctx, skip, take, state);
    }

    @Query()
    @Allow(manageImageGenerationPermission.Read)
    imagePromptSkillReleases(@Ctx() ctx: RequestContext) {
        return this.configService.skillReleases(ctx);
    }

    @Query()
    @Allow(manageImageGenerationPermission.Read)
    imageGenerationCostSummary(@Ctx() ctx: RequestContext, @Args('days') days?: number) {
        return this.generations.adminCostSummary(ctx, days);
    }

    @Mutation()
    @Allow(manageImageGenerationPermission.Update)
    saveImageGenerationConfig(
        @Ctx() ctx: RequestContext,
        @Args('input') input: SaveImageGenerationConfigInput,
    ) {
        return this.configService.saveConfig(ctx, input);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    saveImageProviderCredential(
        @Ctx() ctx: RequestContext,
        @Args('input') input: SaveImageProviderCredentialInput,
    ) {
        return this.configService.saveCredential(ctx, input);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    testImageProviderConnection(@Ctx() ctx: RequestContext, @Args('scope') scope: ImageProviderScope) {
        return this.configService.testConnection(ctx, scope);
    }

    @Mutation()
    @Allow(manageImageGenerationPermission.Update)
    testImageModel(@Ctx() ctx: RequestContext, @Args('code') code: string) {
        return this.configService.testModel(ctx, code);
    }

    @Mutation()
    @Allow(manageImageGenerationPermission.Update)
    smokeTestImageModel(@Ctx() ctx: RequestContext, @Args('code') code: string) {
        return this.configService.smokeTestModel(ctx, code);
    }

    @Mutation()
    @Allow(manageImageGenerationPermission.Update)
    saveImageModel(@Ctx() ctx: RequestContext, @Args('input') input: SaveImageModelInput) {
        return this.configService.saveModel(ctx, input);
    }

    @Mutation()
    @Allow(manageImageGenerationPermission.Update)
    activateImagePromptSkillRelease(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.configService.activateSkillRelease(ctx, id);
    }

    @Mutation()
    @Allow(manageImageGenerationPermission.Update)
    retryUnknownImageOutput(@Ctx() ctx: RequestContext, @Args('outputId') outputId: ID) {
        return this.generations.adminRetryUnknown(ctx, outputId);
    }

    @Mutation()
    @Allow(manageImageGenerationPermission.Update)
    refundImageOutput(
        @Ctx() ctx: RequestContext,
        @Args('outputId') outputId: ID,
        @Args('reason') reason: string,
    ) {
        return this.generations.adminRefundOutput(ctx, outputId, reason);
    }
}
