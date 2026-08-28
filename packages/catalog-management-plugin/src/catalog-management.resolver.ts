import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, RequestContext } from '@vendure/core';

import { CatalogImportService } from './catalog-import.service';
import { CatalogOperationsService } from './catalog-operations.service';
import { manageCatalogImportPermission } from './constants';
import {
    CatalogImportAction,
    CatalogImportContextInput,
    ResolveCatalogImportRowInput,
    SaveInventoryLotInput,
    UpdateCatalogVariantOperationsInput,
    UploadedCatalogFile,
} from './types';

@Resolver()
export class CatalogManagementAdminResolver {
    constructor(
        private readonly imports: CatalogImportService,
        private readonly operations: CatalogOperationsService,
    ) {}

    @Query()
    @Allow(manageCatalogImportPermission.Read)
    catalogImportJob(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.imports.findJob(ctx, id);
    }

    @Query()
    @Allow(manageCatalogImportPermission.Read)
    catalogImportJobs(@Ctx() ctx: RequestContext, @Args('skip') skip?: number, @Args('take') take?: number) {
        return this.imports.findJobs(ctx, skip, take);
    }

    @Query()
    @Allow(manageCatalogImportPermission.Read)
    catalogImportRows(
        @Ctx() ctx: RequestContext,
        @Args('jobId') jobId: ID,
        @Args('action') action?: CatalogImportAction,
    ) {
        return this.imports.findRows(ctx, jobId, action);
    }

    @Query()
    @Allow(manageCatalogImportPermission.Read)
    catalogProductWorkspace(@Ctx() ctx: RequestContext, @Args('productId') productId: ID) {
        return this.operations.workspace(ctx, productId);
    }

    @Query()
    @Allow(manageCatalogImportPermission.Read)
    catalogStandardImportTemplate() {
        return this.imports.standardTemplate();
    }

    @Query()
    @Allow(manageCatalogImportPermission.Read)
    catalogImportReport(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.imports.report(ctx, id);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Create)
    createCatalogImportPreview(
        @Ctx() ctx: RequestContext,
        @Args('file') file: Promise<UploadedCatalogFile>,
        @Args('input') input: CatalogImportContextInput,
    ) {
        return this.imports.createPreview(ctx, file, input);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Update)
    resolveCatalogImportRow(@Ctx() ctx: RequestContext, @Args('input') input: ResolveCatalogImportRowInput) {
        return this.imports.resolveRow(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Update)
    executeCatalogImport(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.imports.queueExecution(ctx, id);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Delete)
    rollbackCatalogImport(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.imports.rollback(ctx, id);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Update)
    updateCatalogVariantOperations(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateCatalogVariantOperationsInput,
    ) {
        return this.operations.updateVariant(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Update)
    saveCatalogInventoryLot(@Ctx() ctx: RequestContext, @Args('input') input: SaveInventoryLotInput) {
        return this.operations.saveLot(ctx, input);
    }
}
