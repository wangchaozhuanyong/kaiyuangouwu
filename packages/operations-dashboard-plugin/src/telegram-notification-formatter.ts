import type { AdminNotificationDelivery } from './entities/admin-notification-delivery.entity';

const departmentNames: Record<string, { zh: string; en: string }> = {
    EXEC: { zh: 'AI 总经办与运营调度中心', en: 'Executive Operations' },
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
    GOVERNANCE: { zh: '质量合规安全与 AI 治理部', en: 'Governance and Security' },
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
    const icon = resolved ? '✅' : severityIcon(delivery.severity);
    const stateLabel = resolved ? '[已恢复]' : `[${delivery.severity}][${delivery.ownerDepartmentCode}]`;
    const lines = [
        `<b>${icon} ${stateLabel} ${escapeHtml(delivery.title)}</b>`,
        '',
        `状态：${resolved ? '已恢复' : delivery.mode === 'INCIDENT' ? '持续中' : '新事件'}`,
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
    lines.push('');
    for (const [key, value] of Object.entries(delivery.payload)) {
        if (key === 'adminPath') continue;
        if (value == null || value === '') continue;
        lines.push(`${escapeHtml(payloadLabel(key))}：${escapeHtml(formatPayloadValue(value))}`);
    }
    if (delivery.mode === 'INCIDENT') {
        lines.push(`发生次数：${delivery.occurrenceCount}`);
        lines.push(`首次发生：${formatDate(delivery.firstOccurredAt, options.timezone)}`);
    }
    lines.push(
        `${resolved ? '恢复时间' : '发生时间'}：${formatDate(delivery.lastOccurredAt, options.timezone)}`,
    );
    const text = truncateTelegramText(lines.join('\n'));
    const adminUrl = adminLink(options.adminBaseUrl, delivery.payload.adminPath);
    return {
        text,
        ...(adminUrl ? { button: { label: '打开管理后台', url: adminUrl } } : {}),
    };
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
        orderId: '订单 ID',
        orderCode: '订单编号',
        paymentId: '支付 ID',
        fulfillmentId: '履约 ID',
        refundId: '退款 ID',
        channelId: '渠道 ID',
        channelCode: '渠道',
        currencyCode: '币种',
        amount: '金额',
        paymentMethod: '支付方式',
        fromState: '原状态',
        toState: '当前状态',
        customerEmail: '客户邮箱',
        variantId: '商品规格 ID',
        sku: 'SKU',
        variantName: '商品规格',
        saleableStock: '可售库存',
        threshold: '告警阈值',
        error: '错误摘要',
    };
    return labels[key] ?? key;
}

function formatPayloadValue(value: unknown): string {
    if (Array.isArray(value)) return value.map(item => formatPayloadValue(item)).join('、');
    if (typeof value === 'object') return JSON.stringify(value) ?? '';
    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint'
    ) {
        return String(value);
    }
    return '';
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
    return value.length <= limit ? value : `${value.slice(0, limit - 26)}\n…详细内容请到后台查看`;
}

function adminLink(baseUrl: string | null, path: unknown): string | null {
    if (!baseUrl || typeof path !== 'string' || !path.startsWith('/')) return null;
    try {
        return new URL(baseUrl.replace(/\/$/u, '') + path).toString();
    } catch {
        return null;
    }
}
