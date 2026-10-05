import { isControlledTestPaymentMethod } from '@vendure/common/lib/controlled-test-payment';
import { effectiveRefundLines } from '@vendure/core';

export type ProcessingCategory =
    | 'PENDING'
    | 'DIGITAL'
    | 'PHYSICAL'
    | 'EXCEPTIONS'
    | 'AFTER_SALES'
    | 'ALL'
    | 'DRAFT'
    | 'IN_TRANSIT'
    | 'DELIVERED'
    | 'CANCELLED'
    | 'TO_SETTLE';

export interface ProcessingSource {
    id: string;
    state: string;
    active: boolean;
    placed: boolean;
    canManage: boolean;
    canUpdate: boolean;
    canFinance?: boolean;
    canArrangePayment?: boolean;
    totalWithTax: number;
    shippingWithTax?: number;
    recipientEmail?: string | null;
    resourceReviewReason?: string | null;
    payments: Array<{
        id: string;
        state: string;
        amount: number;
        method: string;
        isTest?: boolean;
        canCancel?: boolean;
        refundSettlementMode?: string;
        shippingBudget?: number;
        refunds: Array<{
            id?: string;
            state: string;
            total: number;
            shipping?: number;
            metadata?: Record<string, any>;
            lines?: Array<{ orderLineId: string; quantity: number }>;
        }>;
    }>;
    lines: Array<{
        id: string;
        productName: string;
        sku: string;
        quantity: number;
        placedQuantity: number;
        type: 'physical' | 'digital';
        mode: string;
        fulfillments: Array<{ id?: string; state: string; quantity: number }>;
        task?: {
            id: string;
            state: string;
            quantity: number;
            notificationStatus?: string;
            readyQuantity?: number;
            claimedQuantity?: number;
            recipientEmail?: string | null;
            overdue?: boolean;
        };
        delivery?: { readyQuantity: number; claimedQuantity?: number | null; notificationStatus: string };
        fileReady?: boolean;
    }>;
    afterSales: Array<{ id: string; state: string }>;
    deliveryException: boolean;
}

export interface ProcessingAction {
    code: string;
    label: string;
    enabled: boolean;
    reason: string | null;
    targetId: string | null;
}

export function summarizeProcessing(source: ProcessingSource) {
    const payments = source.payments.filter(
        payment => !payment.isTest && !isControlledTestPaymentMethod(payment.method),
    );
    const isTestOrder = source.payments.length > 0 && payments.length === 0;
    const settledAmount = payments
        .filter(payment => payment.state === 'Settled')
        .reduce((sum, payment) => sum + payment.amount, 0);
    const authorizedAmount = payments
        .filter(payment => payment.state === 'Authorized')
        .reduce((sum, payment) => sum + payment.amount, 0);
    const refunds = payments.flatMap(payment => payment.refunds);
    const pendingRefundAmount = refunds
        .filter(refund => refund.state === 'Pending')
        .reduce((sum, refund) => sum + refund.total, 0);
    const refundedAmount = refunds
        .filter(refund => refund.state === 'Settled')
        .reduce((sum, refund) => sum + refund.total, 0);
    const outstandingAmount = Math.max(0, source.totalWithTax - settledAmount - authorizedAmount);
    const canFinance = source.canFinance ?? source.canUpdate;
    const paymentCapabilities = source.payments.map(payment => {
        const simulated = payment.isTest === true || isControlledTestPaymentMethod(payment.method);
        const balance = Math.max(
            0,
            payment.amount -
                payment.refunds
                    .filter(refund => ['Pending', 'Settled'].includes(refund.state))
                    .reduce((sum, refund) => sum + refund.total, 0),
        );
        const mode = payment.refundSettlementMode ?? 'unsupported';
        const reason = simulated
            ? '模拟付款没有真实资金可退'
            : payment.state !== 'Settled'
              ? '仅已实际收款的支付可以退款'
              : mode === 'unsupported'
                ? '该支付方式不支持退款'
                : balance === 0
                  ? '没有剩余可退款金额'
                  : !canFinance
                    ? '当前岗位未获得敏感店铺财务权限'
                    : null;
        return {
            paymentId: payment.id,
            canRefund: reason === null && source.canManage && source.canUpdate,
            refundBlockedReason: reason,
            canCancel:
                !simulated &&
                payment.state === 'Authorized' &&
                payment.canCancel === true &&
                source.canManage &&
                source.canUpdate &&
                canFinance,
            refundableAmount: reason === null ? balance : 0,
            refundSettlementMode: mode,
        };
    });
    // Funds still owed remain visible even when a provider cannot perform an automatic refund.
    const refundableAmount = Math.max(0, settledAmount - pendingRefundAmount - refundedAmount);
    const hasCollectedMoney =
        settledAmount > 0 ||
        (!isTestOrder &&
            source.placed &&
            source.totalWithTax === 0 &&
            payments.some(payment => payment.state === 'Settled'));
    const paidEnough = hasCollectedMoney && source.totalWithTax <= settledAmount;
    const physicalFunded =
        paidEnough ||
        (payments.some(payment => payment.state === 'Authorized') &&
            source.totalWithTax <= settledAmount + authorizedAmount);
    const containsDigital = source.lines.some(line => line.type === 'digital');
    const cancelled = source.state === 'Cancelled';
    const deliveryUnavailableReason = isTestOrder
        ? '模拟订单不进入真实交付与资金流程'
        : cancelled
          ? '订单已取消，停止交付'
          : !(containsDigital ? paidEnough : physicalFunded)
            ? '请先确认足额实际收款'
            : source.state === 'Modifying'
              ? '请先结束订单修改'
              : (source.resourceReviewReason ?? null);
    const unavailableReason = !source.canManage
        ? '请切换到订单所属经营店铺处理'
        : !source.canUpdate
          ? '当前账号没有订单处理权限'
          : deliveryUnavailableReason;
    const refundLines = effectiveRefundLines(refunds);
    const effectiveRefunds = refunds.filter(refund => ['Pending', 'Settled'].includes(refund.state));
    const lines = source.lines.map(line => {
        const refundedQuantity = refundLines
            .filter(refundLine => refundLine.orderLineId === line.id)
            .reduce((sum, refundLine) => sum + Math.max(0, refundLine.quantity), 0);
        // Cancellation has already reduced current quantity; do not subtract the same units twice.
        const refundableQuantity = Math.max(0, (line.placedQuantity || line.quantity) - refundedQuantity);
        const requiredQuantity = cancelled ? 0 : Math.max(0, Math.min(line.quantity, refundableQuantity));
        const deliveredByRecord = line.fulfillments
            .filter(item => item.state === 'Delivered')
            .reduce((sum, item) => sum + item.quantity, 0);
        const dispatchedQuantity = line.fulfillments
            .filter(item => ['Pending', 'Created', 'Shipped', 'Delivered'].includes(item.state))
            .reduce((sum, item) => sum + item.quantity, 0);
        const shippedQuantity = line.fulfillments
            .filter(item => ['Shipped', 'Delivered'].includes(item.state))
            .reduce((sum, item) => sum + item.quantity, 0);
        const pendingDispatchQuantity =
            line.type === 'physical'
                ? Math.max(
                      0,
                      Math.min(requiredQuantity, dispatchedQuantity) -
                          Math.min(requiredQuantity, shippedQuantity),
                  )
                : 0;
        const unallocatedQuantity =
            line.type === 'physical' ? Math.max(0, requiredQuantity - dispatchedQuantity) : 0;
        const task = line.task;
        const readyQuantity =
            line.type === 'physical'
                ? deliveredByRecord
                : (line.delivery?.readyQuantity ??
                  task?.readyQuantity ??
                  (task?.state === 'SENT'
                      ? task.quantity
                      : line.mode === 'file_download' && line.fileReady === true && paidEnough
                        ? requiredQuantity
                        : 0));
        const deliveredQuantity = Math.min(requiredQuantity, Math.max(0, readyQuantity));
        const pendingQuantity = Math.max(
            0,
            requiredQuantity - (line.type === 'physical' ? shippedQuantity : deliveredQuantity),
        );
        const notificationStatus =
            line.delivery?.notificationStatus ??
            task?.notificationStatus ??
            (task?.state === 'SENT'
                ? 'SENT'
                : task?.state === 'EMAIL_FAILED' || task?.state === 'MANUAL_REVIEW'
                  ? 'FAILED'
                  : ['SENDING', 'ALLOCATED', 'RETRYING'].includes(task?.state ?? '')
                    ? 'QUEUED'
                    : 'NONE');
        const exception =
            !cancelled &&
            requiredQuantity > 0 &&
            (task?.overdue === true ||
                task?.state === 'WAITING_STOCK' ||
                (task?.state === 'MANUAL_REVIEW' && deliveredQuantity < requiredQuantity) ||
                (line.type === 'digital' &&
                    line.mode === 'file_download' &&
                    paidEnough &&
                    line.fileReady !== true));
        const eligibilityReason =
            line.type === 'physical' &&
            physicalFunded &&
            !cancelled &&
            !isTestOrder &&
            source.state !== 'Modifying'
                ? null
                : deliveryUnavailableReason;
        const status =
            cancelled || requiredQuantity === 0
                ? 'CANCELLED'
                : deliveredQuantity >= requiredQuantity
                  ? 'COMPLETE'
                  : exception
                    ? 'EXCEPTION'
                    : eligibilityReason
                      ? 'BLOCKED'
                      : line.type === 'physical' && pendingQuantity === 0
                        ? 'IN_TRANSIT'
                        : 'WAITING';
        const claimedQuantity = line.delivery?.claimedQuantity ?? task?.claimedQuantity ?? null;
        return {
            orderLineId: line.id,
            productName: line.productName,
            sku: line.sku,
            fulfillmentType: line.type,
            digitalDeliveryMode: line.type === 'digital' ? line.mode : null,
            quantity: line.quantity,
            requiredQuantity,
            refundableQuantity,
            deliveredQuantity,
            pendingQuantity,
            pendingDispatchQuantity,
            unallocatedQuantity,
            status,
            notificationStatus,
            claimedQuantity,
            claimStatus:
                claimedQuantity == null
                    ? 'UNKNOWN'
                    : claimedQuantity > 0 && (requiredQuantity === 0 || claimedQuantity >= requiredQuantity)
                      ? 'CLAIMED'
                      : claimedQuantity > 0
                        ? 'PARTIAL'
                        : 'UNCLAIMED',
            taskId: task?.id ?? null,
            recipientEmail:
                line.type === 'digital' ? source.recipientEmail || task?.recipientEmail || null : null,
        };
    });
    const digital = lines.filter(line => line.fulfillmentType === 'digital');
    const physical = lines.filter(line => line.fulfillmentType === 'physical');
    const remainingDigitalQuantity = digital.reduce((sum, line) => sum + line.pendingQuantity, 0);
    const remainingPhysicalQuantity = physical.reduce((sum, line) => sum + line.pendingQuantity, 0);
    const remainingPhysicalLines = physical
        .filter(line => line.unallocatedQuantity > 0)
        .map(line => ({ orderLineId: line.orderLineId, quantity: line.unallocatedQuantity }));
    const shippingSnapshots = payments
        .filter(payment => payment.state === 'Settled')
        .map(payment => payment.shippingBudget)
        .filter(
            (amount): amount is number =>
                typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0,
        );
    const shippingBudget = shippingSnapshots.length
        ? Math.max(...shippingSnapshots)
        : (source.shippingWithTax ?? 0);
    const refundableShippingAmount = physical.length
        ? Math.min(
              refundableAmount,
              Math.max(
                  0,
                  shippingBudget - effectiveRefunds.reduce((sum, refund) => sum + (refund.shipping ?? 0), 0),
              ),
          )
        : 0;
    const activeAfterSales = source.afterSales.find(item => ['PENDING', 'APPROVED'].includes(item.state));
    const afterSalesStatus =
        activeAfterSales?.state ??
        (source.afterSales.some(item => item.state === 'COMPLETED') ? 'COMPLETED' : 'NONE');
    const hasDeliveryException =
        !isTestOrder &&
        !cancelled &&
        (source.deliveryException ||
            !!source.resourceReviewReason ||
            lines.some(line => line.status === 'EXCEPTION'));
    const hasNotificationException =
        !isTestOrder &&
        lines.some(
            line =>
                line.requiredQuantity > 0 &&
                line.status !== 'CANCELLED' &&
                line.notificationStatus === 'FAILED',
        );
    const failedRefund = payments
        .flatMap(payment => payment.refunds.map(refund => ({ payment, refund })))
        .find(
            item =>
                item.refund.state === 'Failed' &&
                item.payment.amount >
                    item.payment.refunds
                        .filter(refund => ['Pending', 'Settled'].includes(refund.state))
                        .reduce((sum, refund) => sum + refund.total, 0),
        );
    const hasException = hasDeliveryException || hasNotificationException || !!failedRefund;
    const complete = lines.length > 0 && lines.every(line => ['COMPLETE', 'CANCELLED'].includes(line.status));
    const inTransit = physical.some(line => line.status === 'IN_TRANSIT');
    const fulfillmentStatus = cancelled
        ? 'CANCELLED'
        : hasDeliveryException
          ? 'EXCEPTION'
          : complete
            ? 'COMPLETE'
            : inTransit
              ? 'IN_TRANSIT'
              : lines.some(line => line.deliveredQuantity > 0)
                ? 'PARTIAL'
                : 'WAITING';
    const paymentStatus = isTestOrder
        ? 'TEST'
        : pendingRefundAmount > 0
          ? 'REFUND_PENDING'
          : failedRefund
            ? 'REFUND_FAILED'
            : refundedAmount > 0 && refundedAmount >= settledAmount
              ? 'REFUNDED'
              : refundedAmount > 0
                ? 'PARTIALLY_REFUNDED'
                : source.totalWithTax > settledAmount && settledAmount > 0
                  ? 'ADDITIONAL_PAYMENT'
                  : settledAmount > 0 || hasCollectedMoney
                    ? 'PAID'
                    : authorizedAmount > 0
                      ? 'AUTHORIZED'
                      : 'UNPAID';
    const action = (
        code: string,
        label: string,
        targetId: string | null = null,
        blocked = unavailableReason,
    ): ProcessingAction => ({ code, label, targetId, enabled: blocked == null, reason: blocked });
    let nextAction: ProcessingAction | null = null;
    if (source.state === 'Modifying')
        nextAction = action(
            'FINISH_MODIFICATION',
            '结束修改',
            null,
            source.canManage && source.canUpdate ? null : '请在订单所属店铺使用订单处理权限',
        );
    else if (failedRefund)
        nextAction = action(
            'RETRY_REFUND',
            '重试原退款',
            failedRefund.refund.id ?? null,
            source.canManage &&
                source.canUpdate &&
                canFinance &&
                paymentCapabilities.some(
                    payment => payment.paymentId === failedRefund.payment.id && payment.canRefund,
                )
                ? null
                : '当前岗位、支付方式或剩余退款额度不允许重试，请核对原退款记录',
        );
    else if (cancelled && refundableAmount > 0)
        nextAction = action(
            'PROCESS_REFUND',
            '处理退款',
            null,
            source.canManage && source.canUpdate && paymentCapabilities.some(payment => payment.canRefund)
                ? null
                : '当前岗位或支付方式没有可执行的退款能力',
        );
    else if (cancelled && authorizedAmount > 0)
        nextAction = action(
            'CANCEL_AUTHORIZATION',
            '撤销支付授权',
            paymentCapabilities.find(payment => payment.canCancel)?.paymentId ?? null,
            paymentCapabilities.some(payment => payment.canCancel)
                ? null
                : '渠道无法直接撤销授权，请核实授权到期或渠道处理结果',
        );
    else if (activeAfterSales)
        nextAction = action(
            'HANDLE_AFTER_SALES',
            '处理售后',
            activeAfterSales.id,
            source.canManage && source.canUpdate ? null : '请在订单所属店铺使用订单处理权限',
        );
    else if (!cancelled && !isTestOrder && source.placed) {
        const missingCards = digital.find(
            line => source.lines.find(item => item.id === line.orderLineId)?.task?.state === 'WAITING_STOCK',
        );
        const failedNotification = digital.find(line => line.notificationStatus === 'FAILED');
        const missingFile = digital.find(
            line => line.digitalDeliveryMode === 'file_download' && line.status === 'EXCEPTION',
        );
        const manual = digital.find(
            line => line.digitalDeliveryMode === 'manual_service' && line.pendingQuantity > 0,
        );
        if (!(containsDigital ? paidEnough : physicalFunded))
            nextAction = action(
                'ARRANGE_PAYMENT',
                authorizedAmount > 0 ? '确认收款' : '处理付款',
                null,
                !source.canManage || !source.canUpdate
                    ? '请在订单所属店铺使用订单处理权限'
                    : !canFinance
                      ? '当前岗位未获得敏感店铺财务权限'
                      : authorizedAmount === 0 && source.canArrangePayment === false
                        ? '登记补款需要读取支付方式的权限，请联系店铺负责人'
                        : null,
            );
        else if (source.resourceReviewReason)
            nextAction = action(
                'RETRY_RESOURCE_DELIVERY',
                '重试交付',
                source.id,
                source.canManage && source.canUpdate ? null : '请在订单所属店铺使用订单处理权限',
            );
        else if (missingCards) nextAction = action('REPLENISH_CARDS', '补充卡密', missingCards.taskId);
        // Newly owed content must be prepared before retrying a notification for older content.
        else if (manual) nextAction = action('PREPARE_DELIVERY', '准备交付', manual.taskId);
        else if (failedNotification)
            nextAction = action('RETRY_NOTIFICATION', '重发通知', failedNotification.taskId);
        else if (missingFile) nextAction = action('CONFIGURE_FILE', '配置交付文件', missingFile.orderLineId);
        else if (physical.some(line => line.pendingDispatchQuantity > 0))
            nextAction = action(
                'DISPATCH_PHYSICAL',
                '发出已有包裹',
                source.lines
                    .flatMap(line => line.fulfillments)
                    .find(item => ['Pending', 'Created'].includes(item.state))?.id ?? null,
            );
        else if (remainingPhysicalQuantity > 0) nextAction = action('SHIP_PHYSICAL', '填写运单');
        else if (inTransit || source.deliveryException) nextAction = action('TRACK_SHIPMENT', '跟进物流');
    }
    const needsProcessing =
        !isTestOrder &&
        (source.state === 'Modifying' ||
            (cancelled && (refundableAmount > 0 || authorizedAmount > 0)) ||
            pendingRefundAmount > 0 ||
            !!activeAfterSales ||
            hasException ||
            (source.placed &&
                !cancelled &&
                (remainingDigitalQuantity > 0 ||
                    remainingPhysicalQuantity > 0 ||
                    outstandingAmount > 0 ||
                    (authorizedAmount > 0 && settledAmount === 0))));
    const refundBlockedReason = !source.canManage
        ? '请切换到订单所属经营店铺处理'
        : !source.canUpdate || !canFinance
          ? '当前账号没有退款权限'
          : isTestOrder
            ? '模拟付款没有真实资金可退'
            : refundableAmount <= 0
              ? '没有可退款的真实收款余额'
              : !paymentCapabilities.some(payment => payment.canRefund)
                ? '当前支付方式没有可执行的退款能力，请核对渠道处理方式'
                : null;
    return {
        orderId: source.id,
        businessState: source.state,
        kind: digital.length && physical.length ? 'MIXED' : digital.length ? 'DIGITAL' : 'PHYSICAL',
        paymentStatus,
        paymentLabel: (
            {
                TEST: '模拟付款，无真实收款',
                UNPAID: '未收款',
                AUTHORIZED: '支付已授权，尚未收款',
                PAID: '已收款',
                ADDITIONAL_PAYMENT: '待补款',
                REFUND_PENDING: '退款处理中',
                REFUND_FAILED: '退款失败，需处理原申请',
                PARTIALLY_REFUNDED: '部分已退款',
                REFUNDED: '已退款',
            } as Record<string, string>
        )[paymentStatus],
        fulfillmentStatus,
        fulfillmentLabel: (
            {
                WAITING: '待处理交付',
                PARTIAL: '部分已交付',
                IN_TRANSIT: '实物运输中',
                COMPLETE: '交付已完成',
                CANCELLED: '已停止交付',
                EXCEPTION: '交付异常待处理',
            } as Record<string, string>
        )[fulfillmentStatus],
        afterSalesStatus,
        afterSalesLabel: (
            {
                NONE: '无待处理售后',
                PENDING: '售后待审核',
                APPROVED: '售后处理中',
                COMPLETED: '售后已完成',
            } as Record<string, string>
        )[afterSalesStatus],
        isTestOrder,
        needsProcessing,
        hasException,
        canManage: source.canManage,
        blockedReason: unavailableReason,
        settledAmount,
        pendingRefundAmount,
        refundedAmount,
        refundableAmount,
        refundableShippingAmount,
        outstandingAmount,
        remainingDigitalQuantity,
        remainingPhysicalQuantity,
        remainingPhysicalLines,
        canRefund: refundBlockedReason == null,
        refundBlockedReason,
        nextAction,
        lines,
        paymentCapabilities,
    };
}

export type OrderProcessingSummary = ReturnType<typeof summarizeProcessing>;

export function matchesProcessingCategory(
    summary: OrderProcessingSummary,
    category: ProcessingCategory,
    active: boolean,
) {
    switch (category) {
        case 'PENDING':
            return summary.needsProcessing;
        case 'DIGITAL':
            return (
                !summary.isTestOrder &&
                summary.businessState !== 'Cancelled' &&
                (summary.remainingDigitalQuantity > 0 ||
                    summary.lines.some(
                        line => line.fulfillmentType === 'digital' && line.status === 'EXCEPTION',
                    ))
            );
        case 'PHYSICAL':
            return (
                !summary.isTestOrder &&
                summary.businessState !== 'Cancelled' &&
                summary.remainingPhysicalQuantity > 0
            );
        case 'EXCEPTIONS':
            return summary.hasException;
        case 'AFTER_SALES':
            return (
                ['PENDING', 'APPROVED'].includes(summary.afterSalesStatus) ||
                summary.pendingRefundAmount > 0 ||
                summary.paymentStatus === 'REFUND_FAILED' ||
                (summary.businessState === 'Cancelled' &&
                    (summary.refundableAmount > 0 || summary.paymentStatus === 'AUTHORIZED'))
            );
        case 'DRAFT':
            return summary.businessState === 'Draft';
        case 'IN_TRANSIT':
            return summary.fulfillmentStatus === 'IN_TRANSIT';
        case 'DELIVERED':
            return summary.fulfillmentStatus === 'COMPLETE' && !summary.needsProcessing;
        case 'CANCELLED':
            return summary.businessState === 'Cancelled';
        case 'TO_SETTLE':
            return ['AUTHORIZED', 'ADDITIONAL_PAYMENT'].includes(summary.paymentStatus);
        default:
            return !active || summary.businessState === 'Draft';
    }
}
