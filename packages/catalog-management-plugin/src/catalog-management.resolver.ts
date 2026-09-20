import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@vendure/common/lib/generated-types';
import { Allow, Ctx, ID, ListQueryOptions, Product, RequestContext } from '@vendure/core';

import {
    CatalogChannelAssignmentFilter,
    CatalogChannelAssignmentsService,
} from './catalog-channel-assignments.service';
import { CatalogImportService } from './catalog-import.service';
import { CatalogOperationsService } from './catalog-operations.service';
import {
    CatalogProfitReportInput,
    CatalogProfitService,
    ImportCatalogOrderProfitExpensesInput,
    SaveCatalogOrderProfitExpenseInput,
} from './catalog-profit.service';
import { CatalogSupplierService } from './catalog-supplier.service';
import {
    ApplyCatalogVariantMatrixInput,
    CatalogVariantMatrixService,
} from './catalog-variant-matrix.service';
import {
    manageCatalogExportPermission,
    manageCatalogImportPermission,
    manageCatalogOperationsPermission,
    manageCatalogSupplierPermission,
} from './constants';
import { InventoryControlService } from './inventory-control.service';
import { PurchaseOrderService } from './purchase-order.service';
import {
    AdjustLegacyInventoryInput,
    AppendCatalogImportRowsInput,
    BeginCatalogImportInput,
    CatalogImportAction,
    CatalogProductListOptions,
    CatalogProductSummaryFilterInput,
    CatalogSupplierListOptions,
    CreateCatalogProductInput,
    CreateCatalogProductVariantInput,
    CreateCatalogSupplierInput,
    CreatePurchaseOrderInput,
    PurchaseOrderListOptions,
    ReceivePurchaseOrderInput,
    RecordPurchasePaymentInput,
    ResolveCatalogImportRowInput,
    ResolveCatalogImportRowsInput,
    ResolveInventoryReconciliationInput,
    ReturnPurchaseOrderInput,
    SaveCatalogProductInput,
    SaveManualInventoryLotInput,
    TransferInventoryLotInput,
    UpdateCatalogInventoryThresholdInput,
    UpdateCatalogSupplierInput,
    UpdateCatalogVariantOperationsInput,
} from './types';

@Resolver()
export class CatalogManagementAdminResolver {
    constructor(
        private readonly imports: CatalogImportService,
        private readonly operations: CatalogOperationsService,
        private readonly profit: CatalogProfitService,
        private readonly suppliers: CatalogSupplierService,
        private readonly channelAssignments: CatalogChannelAssignmentsService,
        private readonly variantMatrix: CatalogVariantMatrixService,
        private readonly purchaseOrders: PurchaseOrderService,
        private readonly inventoryControl: InventoryControlService,
    ) {}

    @Query()
    @Allow(Permission.ReadProduct)
    catalogProductChannelAssignments(
        @Ctx() ctx: RequestContext,
        @Args('options') options?: ListQueryOptions<Product>,
        @Args('assignmentFilter') assignmentFilter?: CatalogChannelAssignmentFilter,
    ) {
        return this.channelAssignments.list(ctx, options, assignmentFilter);
    }

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
    catalogImportRowPage(
        @Ctx() ctx: RequestContext,
        @Args('jobId') jobId: ID,
        @Args('action') action?: CatalogImportAction,
        @Args('skip') skip?: number,
        @Args('take') take?: number,
    ) {
        return this.imports.findRowPage(ctx, jobId, action, skip, take);
    }

    @Query()
    @Allow(manageCatalogOperationsPermission.Read, manageCatalogImportPermission.Read)
    catalogIntegritySummary(@Ctx() ctx: RequestContext) {
        return this.operations.integritySummary(ctx);
    }

    @Query()
    @Allow(manageCatalogOperationsPermission.Read, manageCatalogImportPermission.Read)
    catalogProductCreationContext(@Ctx() ctx: RequestContext) {
        return this.operations.creationContext(ctx);
    }

    @Query()
    @Allow(manageCatalogOperationsPermission.Read, manageCatalogImportPermission.Read)
    catalogProductWorkspace(@Ctx() ctx: RequestContext, @Args('productId') productId: ID) {
        return this.operations.workspace(ctx, productId);
    }

    @Query()
    @Allow(manageCatalogOperationsPermission.Read, manageCatalogImportPermission.Read)
    catalogProductSummaries(
        @Ctx() ctx: RequestContext,
        @Args('filter') filter?: CatalogProductSummaryFilterInput,
        @Args('skip') skip?: number,
        @Args('take') take?: number,
    ) {
        return this.operations.productSummaries(ctx, filter ?? {}, skip, take);
    }

    @Query()
    @Allow(manageCatalogOperationsPermission.Read)
    catalogProductOperations(@Ctx() ctx: RequestContext, @Args('productIds') productIds: ID[]) {
        return this.operations.productOperations(ctx, productIds);
    }

    @Query()
    @Allow(Permission.ReadOrder, manageCatalogOperationsPermission.Read)
    catalogOrderProfitExpense(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.profit.orderExpense(ctx, String(orderId));
    }

    @Query()
    @Allow(Permission.ReadOrder, manageCatalogOperationsPermission.Read)
    catalogProfitReport(@Ctx() ctx: RequestContext, @Args('input') input: CatalogProfitReportInput) {
        return this.profit.report(ctx, input);
    }

    @Query()
    @Allow(manageCatalogOperationsPermission.Read, manageCatalogImportPermission.Read)
    catalogProducts(
        @Ctx() ctx: RequestContext,
        @Args('filter') filter?: CatalogProductSummaryFilterInput,
        @Args('options') options?: CatalogProductListOptions,
    ) {
        return this.operations.filteredProducts(ctx, filter ?? {}, options ?? {});
    }

    @Query()
    @Allow(manageCatalogExportPermission.Read, manageCatalogImportPermission.Read)
    catalogExportRows(@Ctx() ctx: RequestContext, @Args('skip') skip?: number, @Args('take') take?: number) {
        return this.operations.exportRows(ctx, skip, take);
    }

    @Query()
    @Allow(Permission.ReadProduct)
    catalogInventoryAlertOverview(@Ctx() ctx: RequestContext) {
        return this.operations.inventoryAlertOverview(ctx);
    }

    @Query()
    @Allow(manageCatalogOperationsPermission.Read)
    catalogInventoryOperations(
        @Ctx() ctx: RequestContext,
        @Args('skip') skip?: number,
        @Args('take') take?: number,
    ) {
        return this.inventoryControl.findOperations(ctx, skip, take);
    }

    @Query()
    @Allow(manageCatalogOperationsPermission.Read)
    catalogInventoryReconciliation(@Ctx() ctx: RequestContext) {
        return this.inventoryControl.reconciliationOverview(ctx);
    }

    @Query()
    @Allow(manageCatalogSupplierPermission.Read, manageCatalogImportPermission.Read)
    catalogSuppliers(@Ctx() ctx: RequestContext, @Args('options') options?: CatalogSupplierListOptions) {
        return this.suppliers.findAll(ctx, options ?? {});
    }

    @Query()
    @Allow(manageCatalogSupplierPermission.Read, manageCatalogImportPermission.Read)
    catalogSupplier(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.suppliers.findOneWithLinkedCount(ctx, id);
    }

    @Query()
    @Allow(manageCatalogSupplierPermission.Read, manageCatalogImportPermission.Read)
    catalogSupplierVariants(
        @Ctx() ctx: RequestContext,
        @Args('supplierId') supplierId: ID,
        @Args('skip') skip?: number,
        @Args('take') take?: number,
    ) {
        return this.suppliers.linkedVariants(ctx, supplierId, skip, take);
    }

    @Query()
    @Allow(manageCatalogSupplierPermission.Read, manageCatalogOperationsPermission.Read)
    catalogPurchaseOrders(@Ctx() ctx: RequestContext, @Args('options') options?: PurchaseOrderListOptions) {
        return this.purchaseOrders.findAll(ctx, options ?? {});
    }

    @Query()
    @Allow(manageCatalogSupplierPermission.Read, manageCatalogOperationsPermission.Read)
    catalogPurchaseOrder(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.purchaseOrders.findOne(ctx, id);
    }

    @Query()
    @Allow(manageCatalogSupplierPermission.Read, manageCatalogOperationsPermission.Read)
    catalogSupplierPerformance(
        @Ctx() ctx: RequestContext,
        @Args('supplierId') supplierId: ID,
        @Args('from') from?: Date,
        @Args('to') to?: Date,
    ) {
        return this.purchaseOrders.supplierPerformance(ctx, supplierId, from, to);
    }

    @Mutation()
    @Allow(Permission.UpdateProduct, Permission.UpdateCatalog)
    applyCatalogVariantMatrix(
        @Ctx() ctx: RequestContext,
        @Args('input') input: ApplyCatalogVariantMatrixInput,
    ) {
        return this.variantMatrix.apply(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Create)
    beginCatalogImport(@Ctx() ctx: RequestContext, @Args('input') input: BeginCatalogImportInput) {
        return this.imports.beginImport(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Create)
    appendCatalogImportRows(@Ctx() ctx: RequestContext, @Args('input') input: AppendCatalogImportRowsInput) {
        return this.imports.appendRows(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Create)
    finalizeCatalogImportPreview(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.imports.finalizePreview(ctx, id);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Update)
    resolveCatalogImportRow(@Ctx() ctx: RequestContext, @Args('input') input: ResolveCatalogImportRowInput) {
        return this.imports.resolveRow(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Update)
    resolveCatalogImportRows(
        @Ctx() ctx: RequestContext,
        @Args('input') input: ResolveCatalogImportRowsInput,
    ) {
        return this.imports.resolveRows(ctx, input);
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
    @Allow(manageCatalogOperationsPermission.Update, manageCatalogImportPermission.Update)
    updateCatalogVariantOperations(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateCatalogVariantOperationsInput,
    ) {
        return this.operations.updateVariant(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogOperationsPermission.Update, manageCatalogImportPermission.Update)
    updateCatalogInventoryThreshold(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateCatalogInventoryThresholdInput,
    ) {
        return this.operations.updateInventoryThreshold(ctx, input);
    }

    @Mutation()
    @Allow(
        Permission.CreateProduct,
        Permission.CreateCatalog,
        manageCatalogOperationsPermission.Update,
        manageCatalogImportPermission.Update,
    )
    createCatalogProductVariant(
        @Ctx() ctx: RequestContext,
        @Args('input') input: CreateCatalogProductVariantInput,
    ) {
        return this.operations.createVariant(ctx, input);
    }

    @Mutation()
    @Allow(
        Permission.CreateProduct,
        Permission.CreateCatalog,
        manageCatalogOperationsPermission.Update,
        manageCatalogImportPermission.Update,
    )
    createCatalogProduct(@Ctx() ctx: RequestContext, @Args('input') input: CreateCatalogProductInput) {
        return this.operations.createProduct(ctx, input);
    }

    @Mutation()
    @Allow(
        Permission.UpdateProduct,
        Permission.UpdateCatalog,
        manageCatalogOperationsPermission.Update,
        manageCatalogImportPermission.Update,
    )
    saveCatalogProduct(@Ctx() ctx: RequestContext, @Args('input') input: SaveCatalogProductInput) {
        return this.operations.saveProduct(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogOperationsPermission.Update, manageCatalogImportPermission.Update)
    saveCatalogInventoryLot(@Ctx() ctx: RequestContext, @Args('input') input: SaveManualInventoryLotInput) {
        return this.inventoryControl.saveManualLot(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogOperationsPermission.Update, manageCatalogImportPermission.Update)
    adjustCatalogLegacyInventory(
        @Ctx() ctx: RequestContext,
        @Args('input') input: AdjustLegacyInventoryInput,
    ) {
        return this.inventoryControl.adjustLegacyStock(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogOperationsPermission.Update, manageCatalogImportPermission.Update)
    transferCatalogInventoryLot(@Ctx() ctx: RequestContext, @Args('input') input: TransferInventoryLotInput) {
        return this.inventoryControl.transferLot(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogOperationsPermission.Update, manageCatalogImportPermission.Update)
    resolveCatalogInventoryReconciliation(
        @Ctx() ctx: RequestContext,
        @Args('input') input: ResolveInventoryReconciliationInput,
    ) {
        return this.inventoryControl.resolveReconciliation(ctx, input);
    }

    @Mutation()
    @Allow(Permission.UpdateOrder, manageCatalogOperationsPermission.Update)
    saveCatalogOrderProfitExpense(
        @Ctx() ctx: RequestContext,
        @Args('input') input: SaveCatalogOrderProfitExpenseInput,
    ) {
        return this.profit.saveOrderExpense(ctx, input);
    }

    @Mutation()
    @Allow(Permission.UpdateOrder, manageCatalogOperationsPermission.Update)
    importCatalogOrderProfitExpenses(
        @Ctx() ctx: RequestContext,
        @Args('input') input: ImportCatalogOrderProfitExpensesInput,
    ) {
        return this.profit.importOrderExpenses(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogSupplierPermission.Create)
    async createCatalogSupplier(
        @Ctx() ctx: RequestContext,
        @Args('input') input: CreateCatalogSupplierInput,
    ) {
        const supplier = await this.suppliers.create(ctx, input);
        return { ...supplier, linkedVariantCount: 0 };
    }

    @Mutation()
    @Allow(manageCatalogSupplierPermission.Update)
    async updateCatalogSupplier(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateCatalogSupplierInput,
    ) {
        const supplier = await this.suppliers.update(ctx, input);
        return this.suppliers.findOneWithLinkedCount(ctx, supplier.id);
    }

    @Mutation()
    @Allow(manageCatalogSupplierPermission.Create, manageCatalogOperationsPermission.Create)
    createCatalogPurchaseOrder(@Ctx() ctx: RequestContext, @Args('input') input: CreatePurchaseOrderInput) {
        return this.purchaseOrders.create(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogSupplierPermission.Update, manageCatalogOperationsPermission.Update)
    submitCatalogPurchaseOrder(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.purchaseOrders.submit(ctx, id);
    }

    @Mutation()
    @Allow(manageCatalogSupplierPermission.Update, manageCatalogOperationsPermission.Update)
    receiveCatalogPurchaseOrder(@Ctx() ctx: RequestContext, @Args('input') input: ReceivePurchaseOrderInput) {
        return this.purchaseOrders.receive(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogSupplierPermission.Update, manageCatalogOperationsPermission.Update)
    closeCatalogPurchaseOrder(@Ctx() ctx: RequestContext, @Args('id') id: ID, @Args('note') note?: string) {
        return this.purchaseOrders.close(ctx, id, note);
    }

    @Mutation()
    @Allow(manageCatalogSupplierPermission.Update, manageCatalogOperationsPermission.Update)
    cancelCatalogPurchaseOrder(@Ctx() ctx: RequestContext, @Args('id') id: ID, @Args('note') note?: string) {
        return this.purchaseOrders.cancel(ctx, id, note);
    }

    @Mutation()
    @Allow(manageCatalogSupplierPermission.Update, manageCatalogOperationsPermission.Update)
    recordCatalogPurchasePayment(
        @Ctx() ctx: RequestContext,
        @Args('input') input: RecordPurchasePaymentInput,
    ) {
        return this.purchaseOrders.recordPayment(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogSupplierPermission.Update, manageCatalogOperationsPermission.Update)
    disputeCatalogPurchasePayment(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('note') note: string,
    ) {
        return this.purchaseOrders.disputePayment(ctx, id, note);
    }

    @Mutation()
    @Allow(manageCatalogSupplierPermission.Update, manageCatalogOperationsPermission.Update)
    returnCatalogPurchaseOrder(@Ctx() ctx: RequestContext, @Args('input') input: ReturnPurchaseOrderInput) {
        return this.purchaseOrders.returnToSupplier(ctx, input);
    }
}
