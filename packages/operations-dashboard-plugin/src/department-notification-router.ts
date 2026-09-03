export const departmentCodes = [
    'EXEC',
    'INTEL',
    'PRODUCT',
    'SUPPLY',
    'DESIGN',
    'CONTENT',
    'GROWTH',
    'SALES',
    'FULFILLMENT',
    'TECH',
    'DATA_FINANCE',
    'GOVERNANCE',
] as const;

export type DepartmentCode = (typeof departmentCodes)[number];
export type NotificationSeverity = 'P0' | 'P1' | 'P2' | 'P3';

export interface DepartmentRoute {
    owner: DepartmentCode;
    collaborators: DepartmentCode[];
    escalation: DepartmentCode | null;
    actionRequired: boolean;
    slaMinutes: number | null;
    actionHint: string;
    fallback: boolean;
}

export interface DepartmentRouteOverride {
    eventType: string;
    owner?: DepartmentCode;
    collaborators?: DepartmentCode[];
    escalation?: DepartmentCode | null;
    actionRequired?: boolean;
    slaMinutes?: number | null;
}

export interface DepartmentRouteDefinition extends DepartmentRoute {
    eventType: string;
    severity: NotificationSeverity;
}

const routeDefinitions: readonly DepartmentRouteDefinition[] = [
    route('commerce.order.placed', 'P3', 'SALES', ['FULFILLMENT', 'DATA_FINANCE'], false, null),
    route('commerce.payment.authorized', 'P2', 'DATA_FINANCE', ['FULFILLMENT'], false, null),
    route('commerce.payment.settled', 'P2', 'FULFILLMENT', ['DATA_FINANCE'], true, null),
    route('commerce.payment.failed', 'P1', 'TECH', ['SALES', 'DATA_FINANCE'], true, 60),
    route('commerce.payment.declined', 'P1', 'DATA_FINANCE', ['TECH', 'SALES'], true, 60),
    route('commerce.payment.proof_mismatch', 'P0', 'DATA_FINANCE', ['GOVERNANCE', 'TECH'], true, 0),
    route('commerce.payment.amount_mismatch', 'P0', 'DATA_FINANCE', ['GOVERNANCE', 'TECH'], true, 0),
    route('commerce.payment.manual_review', 'P0', 'DATA_FINANCE', ['GOVERNANCE', 'TECH'], true, 0),
    route('commerce.payment.cancelled', 'P2', 'DATA_FINANCE', ['SALES'], false, null),
    route('commerce.fulfillment.created', 'P2', 'FULFILLMENT', ['SALES'], false, null),
    route('commerce.fulfillment.shipped', 'P2', 'FULFILLMENT', ['SALES'], false, null),
    route('commerce.fulfillment.delivered', 'P2', 'FULFILLMENT', ['SALES'], false, null),
    route('commerce.fulfillment.cancelled', 'P1', 'FULFILLMENT', ['TECH', 'SALES'], true, 60),
    route('commerce.fulfillment.auto_card_failed', 'P1', 'FULFILLMENT', ['TECH', 'SALES'], true, 60),
    route('commerce.fulfillment.manual_delivery_failed', 'P1', 'FULFILLMENT', ['TECH', 'SALES'], true, 60),
    route('commerce.fulfillment.manual_delivery_overdue', 'P1', 'FULFILLMENT', ['SALES'], true, 60),
    route('commerce.refund.pending', 'P1', 'FULFILLMENT', ['DATA_FINANCE'], true, 60),
    route('commerce.refund.settled', 'P2', 'FULFILLMENT', ['DATA_FINANCE'], false, null),
    route('commerce.refund.failed', 'P1', 'FULFILLMENT', ['DATA_FINANCE', 'TECH'], true, 60),
    route('inventory.variant.low', 'P1', 'SUPPLY', ['PRODUCT', 'GROWTH', 'TECH'], true, 60),
    route('inventory.variant.recovered', 'P2', 'SUPPLY', ['PRODUCT', 'GROWTH'], false, null),
    route('inventory.auto_card.empty', 'P0', 'SUPPLY', ['FULFILLMENT', 'SALES', 'TECH'], true, 0),
    route('system.notification.queue_lag', 'P1', 'TECH', ['EXEC'], true, 60),
    route('system.notification.dead_letter', 'P1', 'TECH', ['EXEC'], true, 60),
    route('system.notification.test', 'P2', 'TECH', [], false, null),
    route('system.database.down', 'P0', 'TECH', ['DATA_FINANCE', 'GOVERNANCE'], true, 0),
    route('system.database.recovered', 'P2', 'TECH', ['DATA_FINANCE', 'GOVERNANCE'], false, null),
];

const defaultRouteByEvent = new Map(routeDefinitions.map(item => [item.eventType, item]));

export class DepartmentNotificationRouter {
    route(
        eventType: string,
        severity: NotificationSeverity,
        overrides: DepartmentRouteOverride[] = [],
    ): DepartmentRoute {
        const definition = defaultRouteByEvent.get(eventType);
        const base: DepartmentRoute = definition
            ? copyRoute(definition)
            : {
                  owner: 'EXEC',
                  collaborators: ['TECH'],
                  escalation: severity === 'P0' ? 'EXEC' : null,
                  actionRequired: severity === 'P0' || severity === 'P1',
                  slaMinutes: severity === 'P0' ? 0 : severity === 'P1' ? 60 : null,
                  actionHint: '核对未注册事件并补充明确的责任路由',
                  fallback: true,
              };
        const override = overrides.find(item => item.eventType === eventType);
        if (override) {
            if (override.owner) base.owner = override.owner;
            if (override.collaborators) base.collaborators = uniqueDepartments(override.collaborators);
            if (override.escalation !== undefined) base.escalation = override.escalation;
            if (override.actionRequired !== undefined) base.actionRequired = override.actionRequired;
            if (override.slaMinutes !== undefined) base.slaMinutes = override.slaMinutes;
        }
        if (severity === 'P0') {
            base.escalation = 'EXEC';
            base.actionRequired = true;
            base.slaMinutes = 0;
        } else if (severity === 'P1') {
            base.escalation ??= 'EXEC';
            base.actionRequired = true;
            base.slaMinutes ??= 60;
        }
        base.collaborators = uniqueDepartments(base.collaborators).filter(code => code !== base.owner);
        return base;
    }

    definitions(): DepartmentRouteDefinition[] {
        return routeDefinitions.map(item => ({ ...item, collaborators: [...item.collaborators] }));
    }
}

export function isDepartmentCode(value: unknown): value is DepartmentCode {
    return typeof value === 'string' && departmentCodes.includes(value as DepartmentCode);
}

export function validateRouteOverrides(value: unknown): DepartmentRouteOverride[] {
    if (!Array.isArray(value)) throw new Error('部门路由覆盖必须是数组');
    const eventTypes = new Set<string>();
    return value.map((candidate, index) => {
        if (!candidate || typeof candidate !== 'object') throw new Error(`第 ${index + 1} 条部门路由无效`);
        const input = candidate as Record<string, unknown>;
        const eventType = typeof input.eventType === 'string' ? input.eventType.trim() : '';
        if (!eventType || eventType.length > 100) throw new Error(`第 ${index + 1} 条事件类型无效`);
        if (eventTypes.has(eventType)) throw new Error(`事件路由重复：${eventType}`);
        eventTypes.add(eventType);
        if (input.owner !== undefined && !isDepartmentCode(input.owner)) {
            throw new Error(`第 ${index + 1} 条主责部门无效`);
        }
        if (
            input.collaborators !== undefined &&
            (!Array.isArray(input.collaborators) || !input.collaborators.every(isDepartmentCode))
        ) {
            throw new Error(`第 ${index + 1} 条协作部门无效`);
        }
        if (
            input.escalation !== undefined &&
            input.escalation !== null &&
            !isDepartmentCode(input.escalation)
        ) {
            throw new Error(`第 ${index + 1} 条升级部门无效`);
        }
        if (input.actionRequired !== undefined && typeof input.actionRequired !== 'boolean') {
            throw new Error(`第 ${index + 1} 条处理要求标记无效`);
        }
        const slaMinutes = input.slaMinutes;
        if (
            slaMinutes !== undefined &&
            slaMinutes !== null &&
            (!Number.isInteger(slaMinutes) || Number(slaMinutes) < 0 || Number(slaMinutes) > 10080)
        ) {
            throw new Error(`第 ${index + 1} 条 SLA 分钟数无效`);
        }
        return {
            eventType,
            ...(input.owner !== undefined ? { owner: input.owner } : {}),
            ...(input.collaborators !== undefined
                ? { collaborators: uniqueDepartments(input.collaborators) }
                : {}),
            ...(input.escalation !== undefined ? { escalation: input.escalation } : {}),
            ...(typeof input.actionRequired === 'boolean' ? { actionRequired: input.actionRequired } : {}),
            ...(slaMinutes !== undefined ? { slaMinutes: slaMinutes as number | null } : {}),
        };
    });
}

function route(
    eventType: string,
    severity: NotificationSeverity,
    owner: DepartmentCode,
    collaborators: DepartmentCode[],
    actionRequired: boolean,
    slaMinutes: number | null,
): DepartmentRouteDefinition {
    return {
        eventType,
        severity,
        owner,
        collaborators,
        escalation: severity === 'P0' || severity === 'P1' ? 'EXEC' : null,
        actionRequired,
        slaMinutes,
        actionHint: actionHint(eventType),
        fallback: false,
    };
}

function actionHint(eventType: string): string {
    if (eventType === 'commerce.order.placed') return '销售确认订单信息，履约部门准备交付';
    if (eventType.startsWith('commerce.payment.')) return '核对支付状态、金额、渠道记录及订单一致性';
    if (eventType.startsWith('commerce.fulfillment.')) return '检查订单交付进度并及时联系客户';
    if (eventType.startsWith('commerce.refund.')) return '核对退款状态、金额与资金流水';
    if (eventType.startsWith('inventory.')) return '检查可售库存，并评估是否暂停销售或推广';
    if (eventType.startsWith('system.database.')) return '检查数据库连接、容量与最近变更';
    return '进入管理后台核对事件并按责任路由处理';
}

function copyRoute(routeDefinition: DepartmentRoute): DepartmentRoute {
    return { ...routeDefinition, collaborators: [...routeDefinition.collaborators] };
}

function uniqueDepartments(values: DepartmentCode[]): DepartmentCode[] {
    return [...new Set(values.filter(isDepartmentCode))];
}
