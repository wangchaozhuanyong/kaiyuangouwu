import { CONTROLLED_TEST_PAYMENT_METHOD_PREFIX } from '@vendure/common/lib/controlled-test-payment';
import {
    Fulfillment,
    FulfillmentLine,
    Order,
    OrderLine,
    Payment,
    ProductVariant,
    Refund,
    RefundLine,
    RequestContext,
    scopeOrderQuery,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import type { EntityTarget } from 'typeorm';

import { AfterSalesRequest } from './entities/after-sales-request.entity';
import { AutoCardDelivery } from './entities/auto-card-delivery.entity';
import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';
import { CheckoutResourceHold, DigitalOrderReservation } from './entities/digital-product.entity';
import { FulfillmentDeliveryRecord } from './entities/fulfillment-delivery-record.entity';
import { ManualDigitalDelivery } from './entities/manual-digital-delivery.entity';
import { type ProcessingCategory } from './order-processing-summary';
import { type OrderProcessingListOptions } from './order-processing.service';

export interface ProcessingFileCandidate {
    channelId: string;
    fileVersionId: string | null;
    sku: string;
}

/** SQL reads only lifecycle facts. Full Order graphs and encrypted payloads are never materialized
 * for historical rows. Keep predicates equivalent to summarizeProcessing and digital entitlement;
 * the database contract suite compares every category against those canonical functions. */
export class OrderProcessingProjection {
    private readonly parameters: Record<string, unknown> = {};
    private readonly ctes: string[] = [];
    private readonly driver = this.connection.rawConnection.driver;
    private readonly manager = this.connection.getRepository(this.ctx, Order).manager;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly ctx: RequestContext,
        private readonly options: OrderProcessingListOptions,
    ) {
        const query = this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .leftJoin('order.customer', 'customer')
            .select('order.id', 'id')
            .addSelect('order.state', 'state')
            .addSelect('order.active', 'active')
            .addSelect('order.orderPlacedAt', 'placedAt')
            .addSelect('order.createdAt', 'createdAt')
            .addSelect('order.code', 'code')
            .addSelect('order.salesChannelId', 'channelId')
            .addSelect('order.subTotalWithTax + COALESCE(order.shippingWithTax, 0)', 'total')
            .addSelect('customer.lastName', 'customerLastName')
            .where('(order.active = :inactive OR order.state = :draft)', { inactive: false, draft: 'Draft' });
        scopeOrderQuery(ctx, query, 'read');
        const term = options.term?.trim();
        if (term) {
            if (term.length > 120) throw new UserInputError('订单搜索词过长');
            const paymentMatches = query
                .subQuery()
                .select('1')
                .from(Payment, 'searchPayment')
                .where('searchPayment.orderId = order.id')
                .andWhere("searchPayment.transactionId LIKE :term ESCAPE '!'")
                .getQuery();
            query.andWhere(
                `(order.code LIKE :term ESCAPE '!' OR customer.emailAddress LIKE :term ESCAPE '!'
                OR customer.firstName LIKE :term ESCAPE '!' OR customer.lastName LIKE :term ESCAPE '!'
                OR EXISTS ${paymentMatches})`,
                { term: `%${term.replace(/[%_!]/gu, '!$&')}%` },
            );
        }
        this.ctes.push(`base AS (${query.getQuery()})`);
        Object.assign(this.parameters, query.getParameters(), { projectionNow: new Date() });
    }

    private escape(name: string) {
        return this.driver.escape(name);
    }
    private table(entity: EntityTarget<any>) {
        return this.connection.rawConnection
            .getMetadata(entity)
            .tablePath.split('.')
            .map(name => this.escape(name))
            .join('.');
    }
    private column(entity: EntityTarget<any>, alias: string, path: string, optional = false) {
        const metadata = this.connection.rawConnection.getMetadata(entity);
        const column = metadata.columns.find(
            item => item.propertyPath === path || item.propertyName === path || item.databaseName === path,
        );
        if (!column) {
            // Custom fields are optional in framework-only fixtures. Production registration owns them.
            if (optional) return 'NULL';
            throw new Error(`Missing order projection column: ${metadata.name}.${path}`);
        }
        return `${alias}.${this.escape(column.databaseName)}`;
    }
    private json(column: string, path: string, stringOnly = false) {
        const type = this.connection.rawConnection.options.type;
        if (type === 'postgres' || type === 'cockroachdb') {
            const keys = path
                .split('.')
                .map(part => `'${part}'`)
                .join(',');
            const postgresValue = `${column}::jsonb #>> ARRAY[${keys}]`;
            return stringOnly
                ? `CASE WHEN jsonb_typeof(${column}::jsonb #> ARRAY[${keys}]) = 'string' THEN ${postgresValue} END`
                : postgresValue;
        }
        const target = `'$.${path}'`;
        const value = ['mysql', 'mariadb'].includes(type)
            ? `JSON_UNQUOTE(JSON_EXTRACT(${column}, ${target}))`
            : `json_extract(${column}, ${target})`;
        const jsonType = ['mysql', 'mariadb'].includes(type)
            ? `JSON_TYPE(JSON_EXTRACT(${column}, ${target}))`
            : `json_type(${column}, ${target})`;
        return stringOnly ? `CASE WHEN ${jsonType} IN ('STRING', 'text') THEN ${value} END` : value;
    }
    private jsonTrue(column: string, path: string) {
        const type = this.connection.rawConnection.options.type;
        if (type === 'postgres' || type === 'cockroachdb') return `(${this.json(column, path)} = 'true')`;
        const target = `'$.${path}'`;
        return ['mysql', 'mariadb'].includes(type)
            ? `(JSON_TYPE(JSON_EXTRACT(${column}, ${target})) = 'BOOLEAN' AND ${this.json(column, path)} = 'true')`
            : `(json_type(${column}, ${target}) = 'true')`;
    }
    private caseSensitive(value: string) {
        return ['mysql', 'mariadb'].includes(this.connection.rawConnection.options.type)
            ? `BINARY ${value}`
            : value;
    }
    private maxZero(value: string) {
        return `CASE WHEN (${value}) > 0 THEN (${value}) ELSE 0 END`;
    }
    private min(a: string, b: string) {
        return `CASE WHEN (${a}) < (${b}) THEN (${a}) ELSE (${b}) END`;
    }
    private async read<T>(selection: string): Promise<T[]> {
        const sql = `WITH ${this.ctes.join(',\n')} ${selection}`;
        const [query, parameters] = this.driver.escapeQueryWithParameters(sql, this.parameters, {});
        return this.manager.query(query, parameters);
    }

    /** Filesystem truth cannot be fabricated from a configured filename. Read each distinct
     * channel/version or legacy SKU once, then use the verified readiness in SQL classification. */
    async fileCandidates(): Promise<ProcessingFileCandidate[]> {
        const l = (path: string, optional = false) => this.column(OrderLine, 'l', path, optional);
        const v = (path: string, optional = false) => this.column(ProductVariant, 'v', path, optional);
        const r = (path: string) => this.column(DigitalOrderReservation, 'r', path);
        return this.read(`SELECT DISTINCT b.${this.escape('channelId')} AS ${this.escape('channelId')},
            ${r('fileVersionId')} AS ${this.escape('fileVersionId')}, ${v('sku')} AS ${this.escape('sku')}
            FROM base b JOIN ${this.table(OrderLine)} l ON ${l('orderId')} = b.id
            JOIN ${this.table(ProductVariant)} v ON ${v('id')} = ${l('productVariantId')}
            LEFT JOIN ${this.table(DigitalOrderReservation)} r ON ${r('orderLineId')} = ${l('id')} AND ${r('channelId')} = b.${this.escape('channelId')}
            WHERE COALESCE(${l('customFields.fulfillmentTypeSnapshot', true)}, ${v('customFields.fulfillmentType', true)}, 'physical') = 'digital'
            AND COALESCE(${l('customFields.digitalDeliveryModeSnapshot', true)}, ${v('customFields.digitalDeliveryMode', true)}, 'manual_service') = 'file_download'`);
    }

    prepare(readyFiles: ProcessingFileCandidate[]) {
        const c = (entity: EntityTarget<any>, alias: string, property: string, optional = false) =>
            this.column(entity, alias, property, optional);
        const p = (path: string) => c(Payment, 'p', path);
        const r = (path: string) => c(Refund, 'r', path);
        const l = (path: string, optional = false) => c(OrderLine, 'l', path, optional);
        const v = (path: string, optional = false) => c(ProductVariant, 'v', path, optional);
        const ref = (path: string) => c(RefundLine, 'lr', path);
        const fl = (path: string) => c(FulfillmentLine, 'fl', path);
        const f = (path: string) => c(Fulfillment, 'f', path);
        const m = (path: string) => c(ManualDigitalDelivery, 'm', path);
        const a = (path: string) => c(AutoCardDelivery, 'a', path);
        const pool = (path: string) => c(AutoCardPoolItem, 'pool', path);
        const reservation = (path: string) => c(DigitalOrderReservation, 'reservation', path);
        this.parameters.simulatedPrefix = CONTROLLED_TEST_PAYMENT_METHOD_PREFIX;
        this.parameters.simulatedPrefixLength = CONTROLLED_TEST_PAYMENT_METHOD_PREFIX.length;
        this.ctes.push(`payments AS (
            SELECT ${p('id')} AS id, ${p('orderId')} AS orderId, ${p('state')} AS state, ${p('amount')} AS amount,
                CASE WHEN ${this.caseSensitive(`SUBSTR(${p('method')}, 1, :simulatedPrefixLength)`)} = :simulatedPrefix
                OR ${this.jsonTrue(p('metadata'), 'public.testPayment')} THEN 1 ELSE 0 END AS simulated,
                CASE WHEN ${this.jsonTrue(p('metadata'), 'manualReview.required')}
                AND ${this.caseSensitive(this.json(p('metadata'), 'manualReview.receivedState'))} = 'Settled' THEN 1 ELSE 0 END AS receiptReview,
                CASE WHEN ${this.jsonTrue(p('metadata'), 'manualReview.required')} THEN 1 ELSE 0 END AS reviewRequired
            FROM ${this.table(Payment)} p JOIN base b ON b.id = ${p('orderId')}
        )`);
        this.ctes.push(
            `refunds AS (
            SELECT ${r('id')} AS id, p.id AS paymentId, p.orderId, p.state AS paymentState,
                ${r('state')} AS state, ${r('total')} AS total,
                ${this.caseSensitive(`NULLIF(${this.json(r('metadata'), 'refundRequest.quantityGroup.key', true)}, '')`)} AS quantityGroup
            FROM ${this.table(Refund)} r JOIN payments p ON p.id = ${r('paymentId')} AND p.simulated = 0
        )`,
            `refundGroups AS (
            SELECT orderId, quantityGroup, MAX(CASE WHEN state IN ('Pending', 'Settled') THEN 1 ELSE 0 END) AS activeGroup,
                MAX(CASE WHEN state IN ('Pending', 'Settled') AND paymentState = 'Settled' THEN 1 ELSE 0 END) AS activeSettledGroup
            FROM refunds WHERE quantityGroup IS NOT NULL GROUP BY orderId, quantityGroup
        )`,
            `refundQuantities AS (
            SELECT ${ref('orderLineId')} AS lineId,
                SUM(CASE WHEN (r.quantityGroup IS NULL AND r.state IN ('Pending', 'Settled')) OR g.activeGroup = 1
                THEN ${this.maxZero(ref('quantity'))} ELSE 0 END) AS quantity,
                SUM(CASE WHEN r.paymentState = 'Settled' AND ((r.quantityGroup IS NULL AND r.state IN ('Pending', 'Settled'))
                OR g.activeSettledGroup = 1) THEN ${ref('quantity')} ELSE 0 END) AS settledQuantity
            FROM ${this.table(RefundLine)} lr JOIN refunds r ON r.id = ${ref('refundId')}
            LEFT JOIN refundGroups g ON g.orderId = r.orderId AND g.quantityGroup = r.quantityGroup
            WHERE ${ref('discriminator')} = 'RefundLine' GROUP BY ${ref('orderLineId')}
        )`,
            `refundAmounts AS (
            SELECT paymentId, SUM(CASE WHEN state = 'Pending' THEN total ELSE 0 END) AS pending,
                SUM(CASE WHEN state = 'Settled' THEN total ELSE 0 END) AS refunded,
                MAX(CASE WHEN state = 'Failed' THEN 1 ELSE 0 END) AS hasFailed
            FROM refunds GROUP BY paymentId
        )`,
            `paymentFacts AS (
            SELECT b.id AS orderId, COUNT(p.id) AS paymentCount,
                SUM(CASE WHEN p.simulated = 0 THEN 1 ELSE 0 END) AS realCount,
                SUM(CASE WHEN p.simulated = 0 AND p.state = 'Settled' THEN p.amount ELSE 0 END) AS settled,
                SUM(CASE WHEN p.simulated = 0 AND p.state = 'Authorized' THEN p.amount ELSE 0 END) AS authorized,
                SUM(CASE WHEN p.simulated = 0 AND p.state = 'Settled' THEN 1 ELSE 0 END) AS settledCount,
                SUM(COALESCE(r.pending, 0)) AS pendingRefund, SUM(COALESCE(r.refunded, 0)) AS refunded,
                MAX(CASE WHEN p.simulated = 0 AND r.hasFailed = 1 AND p.amount > COALESCE(r.pending, 0) + COALESCE(r.refunded, 0) THEN 1 ELSE 0 END) AS failedRefund,
                MAX(CASE WHEN p.simulated = 0 AND p.state = 'PendingManual' THEN 1 ELSE 0 END) AS pendingManual,
                MAX(CASE WHEN p.simulated = 0 THEN p.receiptReview ELSE 0 END) AS receiptReview,
                MAX(CASE WHEN p.id IS NOT NULL AND (p.simulated = 1 OR p.state NOT IN ('Authorized', 'Settled', 'Declined', 'Cancelled')
                OR p.reviewRequired = 1) THEN 1 ELSE 0 END) AS entitlementBlocked
            FROM base b LEFT JOIN payments p ON p.orderId = b.id LEFT JOIN refundAmounts r ON r.paymentId = p.id GROUP BY b.id
        )`,
        );
        this.ctes.push(
            `shipmentQuantities AS (
            SELECT ${fl('orderLineId')} AS lineId,
                SUM(CASE WHEN ${f('state')} = 'Delivered' THEN ${fl('quantity')} ELSE 0 END) AS delivered,
                SUM(CASE WHEN ${f('state')} IN ('Shipped', 'Delivered') THEN ${fl('quantity')} ELSE 0 END) AS shipped
            FROM ${this.table(FulfillmentLine)} fl JOIN ${this.table(Fulfillment)} f ON ${f('id')} = ${fl('fulfillmentId')}
            JOIN ${this.table(OrderLine)} l ON ${l('id')} = ${fl('orderLineId')} JOIN base b ON b.id = ${l('orderId')}
            WHERE ${fl('discriminator')} = 'FulfillmentLine' GROUP BY ${fl('orderLineId')}
        )`,
            `cardQuantities AS (
            SELECT ${pool('deliveryId')} AS deliveryId, COUNT(*) AS quantity FROM ${this.table(AutoCardPoolItem)} pool
            JOIN ${this.table(AutoCardDelivery)} a ON ${a('id')} = ${pool('deliveryId')}
            JOIN base b ON b.id = ${a('orderId')} AND ${a('channelId')} = b.${this.escape('channelId')}
            WHERE ${pool('state')} = 'ASSIGNED' GROUP BY ${pool('deliveryId')}
        )`,
        );
        const fileRows = readyFiles.map((file, index) => {
            Object.assign(this.parameters, {
                [`fileChannel${index}`]: file.channelId,
                [`fileVersion${index}`]: file.fileVersionId,
                [`fileSku${index}`]: file.sku,
            });
            return `SELECT :fileChannel${index} AS channelId, :fileVersion${index} AS versionId, :fileSku${index} AS sku`;
        });
        this.ctes.push(
            `readyFiles AS (${fileRows.join(' UNION ALL ') || 'SELECT NULL AS channelId, NULL AS versionId, NULL AS sku WHERE 1 = 0'})`,
        );
        this.ctes.push(`lineFacts AS (
            SELECT b.id AS orderId, b.state AS orderState, b.active, b.${this.escape('placedAt')} AS placedAt, b.total,
                pf.paymentCount, pf.realCount, pf.settled, pf.authorized, pf.settledCount, pf.entitlementBlocked, pf.receiptReview,
                ${l('id')} AS lineId, ${l('quantity')} AS quantity, ${l('orderPlacedQuantity')} AS placedQuantity,
                COALESCE(${l('customFields.fulfillmentTypeSnapshot', true)}, ${v('customFields.fulfillmentType', true)}, 'physical') AS type,
                COALESCE(${l('customFields.digitalDeliveryModeSnapshot', true)}, ${v('customFields.digitalDeliveryMode', true)}, 'manual_service') AS mode,
                COALESCE(rq.quantity, 0) AS refundQuantity, COALESCE(rq.settledQuantity, 0) AS settledRefundQuantity,
                COALESCE(s.delivered, 0) AS physicalDelivered, COALESCE(s.shipped, 0) AS physicalShipped,
                ${m('id')} AS manualId, ${m('state')} AS manualState, COALESCE(${m('quantity')}, 0) AS manualQuantity,
                CASE WHEN ${m('encryptedPackages')} IS NOT NULL AND ${m('encryptedPackages')} <> '' THEN 1 ELSE 0 END AS hasPackages,
                CASE WHEN ${m('expectedAt')} < :projectionNow AND ${m('state')} IN ('WAITING_PROCESSING', 'DRAFT') THEN 1 ELSE 0 END AS overdue,
                ${a('id')} AS cardId, ${a('state')} AS cardState, COALESCE(cq.quantity, 0) AS cardQuantity,
                CASE WHEN EXISTS (SELECT 1 FROM readyFiles rf WHERE rf.channelId = b.${this.escape('channelId')} AND
                    ((${reservation('fileVersionId')} IS NOT NULL AND rf.versionId = ${reservation('fileVersionId')}) OR
                    (${reservation('fileVersionId')} IS NULL AND rf.versionId IS NULL AND ${this.caseSensitive('rf.sku')} = ${v('sku')}))) THEN 1 ELSE 0 END AS fileExists
            FROM ${this.table(OrderLine)} l JOIN base b ON b.id = ${l('orderId')}
            JOIN paymentFacts pf ON pf.orderId = b.id JOIN ${this.table(ProductVariant)} v ON ${v('id')} = ${l('productVariantId')}
            LEFT JOIN refundQuantities rq ON rq.lineId = ${l('id')} LEFT JOIN shipmentQuantities s ON s.lineId = ${l('id')}
            LEFT JOIN ${this.table(ManualDigitalDelivery)} m ON ${m('orderLineId')} = ${l('id')} AND ${m('channelId')} = b.${this.escape('channelId')}
            LEFT JOIN ${this.table(AutoCardDelivery)} a ON ${a('orderLineId')} = ${l('id')} AND ${a('channelId')} = b.${this.escape('channelId')}
            LEFT JOIN cardQuantities cq ON cq.deliveryId = ${a('id')}
            LEFT JOIN ${this.table(DigitalOrderReservation)} reservation ON ${reservation('orderLineId')} = ${l('id')}
                AND ${reservation('channelId')} = b.${this.escape('channelId')}
        )`);
        const required = this.maxZero(
            this.min(
                'quantity',
                '(CASE WHEN placedQuantity <> 0 THEN placedQuantity ELSE quantity END) - refundQuantity',
            ),
        );
        const entitlement = this.maxZero(
            this.min(
                'quantity',
                '(CASE WHEN placedQuantity > 0 THEN placedQuantity ELSE quantity END) - settledRefundQuantity',
            ),
        );
        this.ctes.push(
            `lineQuantities AS (
            SELECT lf.*, CASE WHEN orderState = 'Cancelled' THEN 0 ELSE ${required} END AS required,
                CASE WHEN active = :inactive AND orderState NOT IN ('Cancelled', 'Modifying', 'ArrangingAdditionalPayment') AND quantity > 0
                AND settledCount > 0 AND entitlementBlocked = 0 AND settled >= total THEN ${entitlement} ELSE 0 END AS entitled,
                CASE WHEN (settled > 0 OR (paymentCount > 0 AND realCount > 0 AND placedAt IS NOT NULL AND total = 0 AND settledCount > 0))
                AND total <= settled THEN 1 ELSE 0 END AS paidEnough,
                CASE WHEN manualId IS NOT NULL THEN manualState ELSE cardState END AS taskState
            FROM lineFacts lf
        )`,
            `lineReadiness AS (
            SELECT lq.*, CASE WHEN type = 'physical' THEN physicalDelivered
                WHEN mode = 'auto_card' THEN ${this.min('entitled', 'cardQuantity')}
                WHEN mode = 'manual_service' AND hasPackages = 1 AND manualState IN ('SENDING', 'SENT', 'EMAIL_FAILED', 'MANUAL_REVIEW')
                THEN ${this.min('entitled', 'manualQuantity')}
                WHEN mode = 'file_download' AND fileExists = 1 THEN entitled ELSE 0 END AS ready,
                CASE WHEN type = 'digital' AND mode = 'auto_card' THEN COALESCE(cardState, 'NOT_REQUIRED')
                    WHEN type = 'digital' AND mode = 'manual_service' THEN COALESCE(manualState, 'NOT_REQUIRED')
                    WHEN type = 'digital' THEN 'NOT_REQUIRED' ELSE COALESCE(taskState, 'NONE') END AS notificationState
            FROM lineQuantities lq
        )`,
            `lineState AS (
            SELECT lr.*, ${this.min('required', this.maxZero('ready'))} AS delivered,
                ${this.maxZero("required - CASE WHEN type = 'physical' THEN physicalShipped ELSE " + this.min('required', this.maxZero('ready')) + ' END')} AS pending,
                CASE WHEN orderState <> 'Cancelled' AND required > 0 AND ready < required AND (overdue = 1 OR taskState = 'WAITING_STOCK'
                OR taskState = 'MANUAL_REVIEW' OR (type = 'digital' AND mode = 'file_download' AND paidEnough = 1 AND NOT (fileExists = 1
                AND entitled > 0))) THEN 1 ELSE 0 END AS lineException
            FROM lineReadiness lr
        )`,
            `lineTotals AS (
            SELECT orderId, COUNT(*) AS lineCount, SUM(quantity) AS totalQuantity,
                SUM(CASE WHEN type = 'digital' THEN pending ELSE 0 END) AS digitalPending,
                SUM(CASE WHEN type = 'physical' THEN pending ELSE 0 END) AS physicalPending,
                MAX(CASE WHEN type = 'digital' THEN lineException ELSE 0 END) AS digitalException,
                MAX(lineException) AS lineException,
                MAX(CASE WHEN required > 0 AND orderState <> 'Cancelled' AND notificationState IN ('EMAIL_FAILED', 'MANUAL_REVIEW') THEN 1 ELSE 0 END)
                AS notificationException,
                MAX(CASE WHEN required > 0 AND delivered < required THEN 1 ELSE 0 END) AS incomplete,
                MAX(CASE WHEN type = 'physical' AND required > delivered AND pending = 0 AND lineException = 0 AND receiptReview = 0
                AND orderState NOT IN ('Cancelled', 'Modifying') AND realCount > 0 AND
                    (paidEnough = 1 OR (authorized > 0 AND total <= settled + authorized)) THEN 1 ELSE 0 END) AS inTransit
            FROM lineState GROUP BY orderId
        )`,
        );
        const h = (path: string) => c(CheckoutResourceHold, 'h', path);
        const as = (path: string) => c(AfterSalesRequest, 'a', path);
        const d = (path: string) => c(FulfillmentDeliveryRecord, 'd', path);
        this.ctes.push(
            `otherFacts AS (
            SELECT b.id AS orderId,
                CASE WHEN EXISTS (SELECT 1 FROM ${this.table(CheckoutResourceHold)} h WHERE ${h('orderId')} = b.id AND ${h('state')} = 'REVIEW')
                THEN 1 ELSE 0 END AS resourceReview,
                CASE WHEN EXISTS (SELECT 1 FROM ${this.table(AfterSalesRequest)} a WHERE ${as('orderId')} = b.id
                AND ${as('state')} IN ('PENDING', 'APPROVED')) THEN 1 ELSE 0 END AS activeAfterSales,
                CASE WHEN EXISTS (SELECT 1 FROM ${this.table(FulfillmentDeliveryRecord)} d WHERE ${d('orderId')} = b.id
                AND (${d('status')} = 'EXCEPTION' OR (${d('status')} = 'IN_TRANSIT' AND ${d('nextActionDueAt')} < :projectionNow))) THEN 1 ELSE 0 END AS deliveryException
            FROM base b
        )`,
            `orderFacts AS (
            SELECT b.*, pf.settled, pf.authorized, pf.pendingRefund, pf.refunded, pf.failedRefund, pf.pendingManual, pf.receiptReview,
                CASE WHEN pf.paymentCount > 0 AND pf.realCount = 0 THEN 1 ELSE 0 END AS isTest,
                ${this.maxZero('b.total - pf.settled - pf.authorized')} AS outstanding,
                ${this.maxZero('pf.settled - pf.pendingRefund - pf.refunded')} AS refundable,
                COALESCE(lt.totalQuantity, 0) AS totalQuantity, COALESCE(lt.digitalPending, 0) AS digitalPending,
                COALESCE(lt.physicalPending, 0) AS physicalPending, COALESCE(lt.digitalException, 0) AS digitalException,
                CASE WHEN lt.lineCount > 0 AND lt.incomplete = 0 THEN 1 ELSE 0 END AS complete,
                COALESCE(lt.inTransit, 0) AS inTransit, COALESCE(lt.notificationException, 0) AS notificationException,
                CASE WHEN b.state <> 'Cancelled' AND (ofacts.resourceReview = 1 OR ofacts.deliveryException = 1 OR lt.lineException = 1) THEN 1
                ELSE 0 END AS deliveryException,
                ofacts.resourceReview, ofacts.activeAfterSales
            FROM base b JOIN paymentFacts pf ON pf.orderId = b.id JOIN otherFacts ofacts ON ofacts.orderId = b.id LEFT JOIN lineTotals lt ON lt.orderId = b.id
        )`,
            `orderStatus AS (
            SELECT facts.*, CASE WHEN isTest = 1 THEN 0 WHEN deliveryException = 1 OR notificationException = 1 OR failedRefund = 1
                OR receiptReview = 1 THEN 1 ELSE 0 END AS hasException,
                CASE WHEN isTest = 1 THEN 'TEST' WHEN receiptReview = 1 THEN 'RECEIPT_REVIEW'
                    WHEN pendingManual = 1 AND state = 'AwaitingManualPayment' THEN 'PENDING_MANUAL'
                    WHEN pendingRefund > 0 THEN 'REFUND_PENDING' WHEN failedRefund = 1 THEN 'REFUND_FAILED'
                    WHEN refunded > 0 AND refunded >= settled THEN 'REFUNDED' WHEN refunded > 0 THEN 'PARTIALLY_REFUNDED'
                    WHEN total > settled AND settled > 0 THEN 'ADDITIONAL_PAYMENT'
                    WHEN settled > 0 OR (total = 0 AND ${this.escape('placedAt')} IS NOT NULL AND EXISTS (SELECT 1 FROM payments p
                    WHERE p.orderId = facts.id AND p.state = 'Settled' AND p.simulated = 0)) THEN 'PAID'
                    WHEN authorized > 0 THEN 'AUTHORIZED' ELSE 'UNPAID' END AS paymentStatus
            FROM orderFacts facts
        )`,
            `classified AS (
            SELECT status.*, CASE WHEN isTest = 0 AND (receiptReview = 1 OR (pendingManual = 1 AND state = 'AwaitingManualPayment') OR state = 'Modifying'
                OR (state = 'Cancelled' AND (refundable > 0 OR authorized > 0)) OR pendingRefund > 0 OR activeAfterSales = 1 OR hasException = 1
                OR (${this.escape('placedAt')} IS NOT NULL AND state <> 'Cancelled' AND (digitalPending > 0 OR physicalPending > 0 OR outstanding > 0
                OR (authorized > 0 AND settled = 0)))) THEN 1 ELSE 0 END AS needsProcessing
            FROM orderStatus status
        )`,
        );
    }

    private category(category: ProcessingCategory) {
        switch (category) {
            case 'LEGACY_TEST':
                return 'isTest = 1';
            case 'PENDING':
                return 'needsProcessing = 1';
            case 'DIGITAL':
                return "isTest = 0 AND state <> 'Cancelled' AND (digitalPending > 0 OR digitalException = 1)";
            case 'PHYSICAL':
                return "isTest = 0 AND state <> 'Cancelled' AND physicalPending > 0";
            case 'EXCEPTIONS':
                return 'hasException = 1';
            case 'AFTER_SALES':
                return `activeAfterSales = 1 OR pendingRefund > 0 OR paymentStatus = 'REFUND_FAILED'
                    OR (state = 'Cancelled' AND (refundable > 0 OR paymentStatus = 'AUTHORIZED'))`;
            case 'DRAFT':
                return "state = 'Draft'";
            case 'IN_TRANSIT':
                return "state <> 'Cancelled' AND deliveryException = 0 AND complete = 0 AND inTransit = 1";
            case 'DELIVERED':
                return "state <> 'Cancelled' AND deliveryException = 0 AND complete = 1 AND needsProcessing = 0";
            case 'CANCELLED':
                return "state = 'Cancelled'";
            case 'TO_SETTLE':
                return "paymentStatus IN ('AUTHORIZED', 'ADDITIONAL_PAYMENT', 'PENDING_MANUAL', 'RECEIPT_REVIEW')";
            default:
                return "active = :inactive OR state = 'Draft'";
        }
    }

    async page(category: ProcessingCategory, skip: number, take: number) {
        const columns: Record<string, string> = {
            createdAt: 'createdAt',
            orderPlacedAt: 'placedAt',
            code: 'code',
            totalWithTax: 'total',
            totalQuantity: 'totalQuantity',
            state: 'state',
            customerLastName: 'customerLastName',
        };
        const sort = this.options.sortBy ?? 'orderPlacedAt';
        const direction = this.options.sortOrder ?? 'DESC';
        if (!Object.prototype.hasOwnProperty.call(columns, sort) || !['ASC', 'DESC'].includes(direction))
            throw new UserInputError('订单排序参数无效');
        Object.assign(this.parameters, { pageSkip: skip, pageTake: take });
        // The empty or out-of-range page still returns its truthful count in one database pass.
        const rows = await this.read<{ id: string | null; totalItems: string | number }>(`
            , filtered AS (SELECT * FROM classified WHERE ${this.category(category)}),
            page AS (SELECT id, ${this.escape(columns[sort])} AS sortValue FROM filtered
                ORDER BY ${this.escape(columns[sort])} ${direction}, id ${direction} LIMIT :pageTake OFFSET :pageSkip)
            SELECT page.id, totals.totalItems AS ${this.escape('totalItems')} FROM (SELECT COUNT(*) AS totalItems FROM filtered) totals LEFT JOIN page ON 1 = 1
            ORDER BY page.sortValue ${direction}, page.id ${direction}`);
        return {
            ids: rows.flatMap(row => (row.id == null ? [] : [row.id])),
            totalItems: Number(rows[0]?.totalItems ?? 0),
        };
    }

    async counts() {
        const categories = {
            pending: 'PENDING',
            digital: 'DIGITAL',
            physical: 'PHYSICAL',
            exceptions: 'EXCEPTIONS',
            afterSales: 'AFTER_SALES',
        } as const;
        const selection = Object.entries(categories)
            .map(
                ([key, value]) =>
                    `COALESCE(SUM(CASE WHEN ${this.category(value)} THEN 1 ELSE 0 END), 0) AS ${this.escape(key)}`,
            )
            .join(', ');
        const [row] = await this.read<Record<keyof typeof categories, number | string>>(
            `SELECT ${selection} FROM classified`,
        );
        return Object.fromEntries(
            Object.keys(categories).map(key => [key, Number(row?.[key as keyof typeof categories] ?? 0)]),
        ) as Record<keyof typeof categories, number>;
    }
}
