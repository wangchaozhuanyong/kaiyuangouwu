import type { AdminNotificationDelivery } from './entities/admin-notification-delivery.entity';

const departmentNames: Record<string, { zh: string; en: string }> = {
    EXEC: { zh: '总经办与运营调度中心', en: 'Executive Operations' },
    INTEL: { zh: '市场情报与商业策划部', en: 'Market Intelligence' },
    PRODUCT: { zh: '商品与定价部', en: 'Product and Pricing' },
    SUPPLY: { zh: '供应链与库存部', en: 'Supply and Inventory' },
    DESIGN: { zh: '品牌设计与视觉创意部', en: 'Brand Design' },
    CONTENT: { zh: '内容与文案部', en: 'Content' },
    GROWTH: { zh: '全渠道增长运营部', en: 'Growth Operations' },
    SALES: { zh: '真人销售客服部', en: 'Sales and Support' },
    FULFILLMENT: { zh: '订单交付与客户成功部', en: 'Fulfillment and Customer Success' },
    TECH: { zh: '网站技术与自动化部', en: 'Technology and Automation' },
    DATA_FINANCE: { zh: '数据财务与经营分析部', en: 'Data and Finance' },
    GOVERNANCE: { zh: '质量合规安全与智能治理部', en: 'Governance and Security' },
};

export interface FormattedTelegramNotification {
    text: string;
    button?: { label: string; url: string };
}

export function formatTelegramNotification(
    delivery: AdminNotificationDelivery,
    options: { timezone: string; adminBaseUrl: string | null; departmentMentions?: Record<string, string> },
): FormattedTelegramNotification {
    const resolved = delivery.eventState === 'RESOLVED';
    const closed = delivery.incidentStatus === 'CLOSED';
    const oneOffResolved = delivery.mode === 'ONE_OFF' && resolved;
    const icon = closed || oneOffResolved ? '✅' : resolved ? '🧪' : severityIcon(delivery.severity);
    const stateLabel = closed
        ? '[已闭环]'
        : oneOffResolved
          ? '[已恢复]'
          : resolved
            ? '[待恢复验证]'
            : `[${severityName(delivery.severity)}]`;
    const lines = [
        `<b>${icon} ${stateLabel} ${escapeHtml(delivery.title)}</b>`,
        '',
        `状态：${incidentStatusLabel(delivery)}`,
        `责任部门：${departmentDisplay(delivery.ownerDepartmentCode, options.departmentMentions)}`,
    ];
    if (delivery.collaboratorDepartmentCodes.length) {
        lines.push(
            `协作部门：${delivery.collaboratorDepartmentCodes
                .map(code => departmentDisplay(code, options.departmentMentions))
                .join('、')}`,
        );
    }
    if (delivery.escalationDepartmentCode) {
        lines.push(
            `升级部门：${departmentDisplay(delivery.escalationDepartmentCode, options.departmentMentions)}`,
        );
    }
    if (delivery.actionRequired) lines.push(`处理要求：${escapeHtml(delivery.actionHint)}`);
    if (delivery.slaDueAt && !resolved) {
        lines.push(`建议时限：${formatDate(delivery.slaDueAt, options.timezone)}`);
    }
    if (delivery.acknowledgedAt) {
        lines.push(`负责人确认：${formatDate(delivery.acknowledgedAt, options.timezone)}`);
    }
    if (delivery.recoveryValidationDueAt && delivery.incidentStatus === 'RECOVERY_PENDING') {
        lines.push(`恢复验证时限：${formatDate(delivery.recoveryValidationDueAt, options.timezone)}`);
    }
    if (delivery.reviewDueAt && delivery.incidentStatus === 'REVIEW_PENDING') {
        lines.push(`复盘时限：${formatDate(delivery.reviewDueAt, options.timezone)}`);
    }
    lines.push('');
    for (const [key, value] of Object.entries(delivery.payload)) {
        if (key === 'adminPath' || !payloadLabel(key)) continue;
        if (value == null || value === '') continue;
        lines.push(`${escapeHtml(payloadLabel(key))}：${escapeHtml(formatPayloadValue(value, key))}`);
    }
    if (delivery.mode === 'INCIDENT') {
        lines.push(`发生次数：${delivery.occurrenceCount}`);
        lines.push(`首次发生：${formatDate(delivery.firstOccurredAt, options.timezone)}`);
    }
    lines.push(
        `${resolved ? '系统恢复时间' : '发生时间'}：${formatDate(delivery.lastOccurredAt, options.timezone)}`,
    );
    const text = truncateTelegramText(lines.join('\n'));
    const adminUrl = adminLink(options.adminBaseUrl, delivery.payload.adminPath);
    return {
        text,
        ...(adminUrl ? { button: { label: '打开管理后台', url: adminUrl } } : {}),
    };
}

function incidentStatusLabel(delivery: AdminNotificationDelivery): string {
    if (delivery.mode !== 'INCIDENT') return delivery.eventState === 'RESOLVED' ? '已完成' : '新事件';
    const labels: Record<string, string> = {
        OPEN: '待负责人确认',
        ACKNOWLEDGED: '已确认处理中',
        RECOVERY_PENDING: '系统已恢复，待人工验证',
        REVIEW_PENDING: '恢复已验证，待复盘',
        ACTION_PENDING: '整改中',
        CLOSED: '已闭环',
    };
    return labels[delivery.incidentStatus] ?? (delivery.eventState === 'RESOLVED' ? '已恢复' : '持续中');
}

export function escapeHtml(value: unknown): string {
    return String(value)
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&#39;');
}

export function departmentName(code: string, language: 'zh' | 'en' = 'zh'): string {
    return departmentNames[code]?.[language] ?? code;
}

function departmentDisplay(code: string, mentions: Record<string, string> | undefined): string {
    const mention = mentions?.[code]?.trim();
    return `${escapeHtml(departmentName(code))}${mention ? `（${escapeHtml(mention)}）` : ''}`;
}

function severityIcon(severity: string): string {
    if (severity === 'P0') return '🚨';
    if (severity === 'P1') return '⚠️';
    if (severity === 'P2') return '✅';
    return 'ℹ️';
}

function payloadLabel(key: string): string {
    const labels: Record<string, string> = {
        storeName: '店铺',
        products: '商品摘要',
        orderState: '订单状态',
        rating: '服务评分',
        serviceTags: '服务标签',
        feedback: '评价反馈',
        promotionName: '活动名称',
        promotionKind: '活动类型',
        endsAt: '结束时间',
        remaining: '剩余时间',
        accessId: '调用凭证编号',
        purpose: '用途',
        reason: '原因',
        fallback: '备用通道',
        affectedStores: '影响店铺',
        actorId: '操作者编号',
        targetId: '对象编号',
        action: '操作',
        failureCount: '失败次数',
        monitoredState: '监测状态',
        total: '平台合计人次',
        shops: '各店在线情况',
        countRule: '统计口径',
        orderId: '订单编号标识',
        orderCode: '订单编号',
        paymentId: '支付记录编号',
        fulfillmentId: '履约记录编号',
        refundId: '退款记录编号',
        channelId: '店铺渠道编号',
        channelCode: '渠道',
        currencyCode: '币种',
        amount: '金额',
        paymentMethod: '支付方式',
        fromState: '原状态',
        toState: '当前状态',
        customerEmail: '客户邮箱',
        variantId: '规格编号',
        sku: '商品编码',
        variantName: '商品规格',
        saleableStock: '可售库存',
        threshold: '告警阈值',
        error: '错误摘要',
    };
    return labels[key] ?? '';
}

export function severityName(value: string): string {
    return ({ P0: '危急', P1: '重要', P2: '提醒', P3: '信息' } as Record<string, string>)[value] ?? '提醒';
}

const states: Record<string, string> = {
    AddingItems: '购物车',
    Draft: '草稿',
    ArrangingPayment: '待支付',
    PaymentAuthorized: '支付已授权',
    PaymentSettled: '已付款',
    PartiallyShipped: '部分发货',
    Shipped: '已发货',
    PartiallyDelivered: '部分送达',
    Delivered: '已送达',
    Cancelled: '已取消',
    Created: '已创建',
    Pending: '待处理',
    Authorized: '已授权',
    Settled: '已完成',
    Declined: '已拒绝',
    Error: '失败',
    Failed: '失败',
    Sent: '已发送',
    Idle: '待处理',
};
function formatPayloadValue(value: unknown, key = ''): string {
    if (key === 'shops' && Array.isArray(value))
        return (
            '\n' +
            value
                .map(shop => {
                    const row = shop as {
                        name: string;
                        total: number | null;
                        guests: number | null;
                        customers: number | null;
                    };
                    return row.total == null
                        ? `${row.name}：统计暂不可用`
                        : `${row.name}：${row.total} 人（游客 ${row.guests}，登录客户 ${row.customers}）`;
                })
                .join('\n')
        );
    if (['fromState', 'toState', 'orderState'].includes(key))
        return states[String(value)] ?? '其他状态（请在后台查看）';
    if (key === 'error' && typeof value === 'string' && !/\p{Script=Han}/u.test(value))
        return '发生异常，请在后台查看处理详情';
    if (key === 'paymentMethod')
        return (
            (
                {
                    'usdt-trc20': '泰达币支付',
                    'referral-balance': '账户余额',
                    'standard-payment': '在线支付',
                } as Record<string, string>
            )[String(value)] ?? (/\p{Script=Han}/u.test(String(value)) ? String(value) : '在线支付')
        );
    if (Array.isArray(value)) return value.map(item => formatPayloadValue(item)).join('、');
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (value != null && typeof value === 'object') return '详细记录请在后台查看';
    return value == null
        ? ''
        : typeof value === 'string' || typeof value === 'number'
          ? String(value)
          : '详细记录请在后台查看';
}

function formatDate(date: Date, timezone: string): string {
    try {
        return new Intl.DateTimeFormat('zh-CN', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(date);
    } catch {
        return date.toISOString();
    }
}

function truncateTelegramText(value: string): string {
    const limit = 3900;
    if (value.length <= limit) return value;
    const suffix = '\n…详细内容请到后台查看';
    let prefix = value.slice(0, limit - suffix.length);
    // The payload is escaped HTML. Keep complete entities and Unicode characters at the boundary.
    const ampersand = prefix.lastIndexOf('&');
    if (ampersand > prefix.lastIndexOf(';')) prefix = prefix.slice(0, ampersand);
    if (/[\uD800-\uDBFF]$/u.test(prefix)) prefix = prefix.slice(0, -1);
    return prefix + suffix;
}

function adminLink(baseUrl: string | null, path: unknown): string | null {
    if (!baseUrl || typeof path !== 'string' || !path.startsWith('/')) return null;
    try {
        return new URL(baseUrl.replace(/\/$/u, '') + path).toString();
    } catch {
        return null;
    }
}
