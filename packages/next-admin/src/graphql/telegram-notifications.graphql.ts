import { gql } from '@apollo/client';

export const TELEGRAM_NOTIFICATIONS_QUERY = gql`
    query NextAdminTelegramNotifications($skip: Int, $take: Int, $status: String) {
        telegramNotificationConfig {
            id
            enabled
            tokenConfigured
            chatId
            chatIdSource
            adminBaseUrl
            timezone
            minSeverity
            sendResolved
            p2Silent
            p3Silent
            notifyOrderEvents
            notifyPaymentEvents
            notifyFulfillmentEvents
            notifyRefundEvents
            notifyInventoryEvents
            inventoryLowThreshold
            p1EscalationMinutes
            p0RepeatMinutes
            p1RepeatMinutes
            departmentMentions
            routeOverrides
            botUsername
            lastConnectionAt
            lastConnectionError
        }
        telegramNotificationConfigAudits(take: 10) {
            id
            createdAt
            action
            actorUserId
            changes
        }
        telegramNotificationStatus {
            running
            processed
            failures
            pending
            retrying
            dead
            oldestLagSeconds
            lastSuccessAt
            lastErrorAt
            lastError
        }
        telegramNotificationDeliveries(skip: $skip, take: $take, status: $status) {
            totalItems
            items {
                id
                createdAt
                eventType
                category
                ownerDepartmentCode
                collaboratorDepartmentCodes
                escalationDepartmentCode
                actionRequired
                slaDueAt
                severity
                eventState
                title
                occurrenceCount
                deliveryStatus
                attempts
                maxAttempts
                telegramMessageId
                lastErrorCode
                lastError
                sentAt
            }
        }
        telegramDepartmentRouting {
            departments {
                code
                nameZh
                nameEn
            }
            routes {
                eventType
                severity
                owner
                collaborators
                escalation
                actionRequired
                slaMinutes
                actionHint
                overridden
                defaultOwner
                defaultCollaborators
                defaultEscalation
                defaultActionRequired
                defaultSlaMinutes
            }
        }
    }
`;

export const UPDATE_TELEGRAM_NOTIFICATION_CONFIG = gql`
    mutation NextAdminUpdateTelegramNotificationConfig($input: UpdateTelegramNotificationConfigInput!) {
        updateTelegramNotificationConfig(input: $input) {
            id
            enabled
            tokenConfigured
            chatId
            chatIdSource
            adminBaseUrl
            timezone
            minSeverity
            sendResolved
            p2Silent
            p3Silent
            notifyOrderEvents
            notifyPaymentEvents
            notifyFulfillmentEvents
            notifyRefundEvents
            notifyInventoryEvents
            inventoryLowThreshold
            p1EscalationMinutes
            p0RepeatMinutes
            p1RepeatMinutes
            departmentMentions
            routeOverrides
            botUsername
            lastConnectionAt
            lastConnectionError
        }
    }
`;

export const TEST_TELEGRAM_CONNECTION = gql`
    mutation NextAdminTestTelegramConnection {
        testTelegramConnection {
            ok
            message
            botUsername
            testedAt
        }
    }
`;

export const SEND_TELEGRAM_NOTIFICATION_TEST = gql`
    mutation NextAdminSendTelegramNotificationTest($kind: String!) {
        sendTelegramNotificationTest(kind: $kind) {
            id
            deliveryStatus
        }
    }
`;

export const RETRY_TELEGRAM_NOTIFICATION = gql`
    mutation NextAdminRetryTelegramNotification($id: ID!) {
        retryTelegramNotificationDelivery(id: $id) {
            id
            deliveryStatus
        }
    }
`;

export interface TelegramNotificationConfigRecord {
    id: string;
    enabled: boolean;
    tokenConfigured: boolean;
    chatId: string | null;
    chatIdSource: 'ENVIRONMENT' | 'DATABASE' | 'NONE';
    adminBaseUrl: string | null;
    timezone: string;
    minSeverity: string;
    sendResolved: boolean;
    p2Silent: boolean;
    p3Silent: boolean;
    notifyOrderEvents: boolean;
    notifyPaymentEvents: boolean;
    notifyFulfillmentEvents: boolean;
    notifyRefundEvents: boolean;
    notifyInventoryEvents: boolean;
    inventoryLowThreshold: number;
    p1EscalationMinutes: number;
    p0RepeatMinutes: number;
    p1RepeatMinutes: number;
    departmentMentions: Record<string, string>;
    routeOverrides: TelegramDepartmentRouteOverrideRecord[];
    botUsername: string | null;
    lastConnectionAt: string | null;
    lastConnectionError: string | null;
}

export interface TelegramDepartmentRouteOverrideRecord {
    eventType: string;
    owner?: string;
    collaborators?: string[];
    escalation?: string | null;
    actionRequired?: boolean;
    slaMinutes?: number | null;
}

export interface TelegramNotificationStatusRecord {
    running: boolean;
    processed: number;
    failures: number;
    pending: number;
    retrying: number;
    dead: number;
    oldestLagSeconds: number;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
}

export interface TelegramNotificationConfigAuditRecord {
    id: string;
    createdAt: string;
    action: string;
    actorUserId: string | null;
    changes: Record<string, { before: unknown; after: unknown }>;
}

export interface TelegramNotificationDeliveryRecord {
    id: string;
    createdAt: string;
    eventType: string;
    category: string;
    ownerDepartmentCode: string;
    collaboratorDepartmentCodes: string[];
    escalationDepartmentCode: string | null;
    actionRequired: boolean;
    slaDueAt: string | null;
    severity: string;
    eventState: string;
    title: string;
    occurrenceCount: number;
    deliveryStatus: string;
    attempts: number;
    maxAttempts: number;
    telegramMessageId: string | null;
    lastErrorCode: string | null;
    lastError: string | null;
    sentAt: string | null;
}

export interface TelegramDepartmentRecord {
    code: string;
    nameZh: string;
    nameEn: string;
}

export interface TelegramDepartmentRouteRecord {
    eventType: string;
    severity: string;
    owner: string;
    collaborators: string[];
    escalation: string | null;
    actionRequired: boolean;
    slaMinutes: number | null;
    actionHint: string;
    overridden: boolean;
    defaultOwner: string;
    defaultCollaborators: string[];
    defaultEscalation: string | null;
    defaultActionRequired: boolean;
    defaultSlaMinutes: number | null;
}

export interface TelegramNotificationsResult {
    telegramNotificationConfig: TelegramNotificationConfigRecord;
    telegramNotificationConfigAudits: TelegramNotificationConfigAuditRecord[];
    telegramNotificationStatus: TelegramNotificationStatusRecord;
    telegramNotificationDeliveries: {
        totalItems: number;
        items: TelegramNotificationDeliveryRecord[];
    };
    telegramDepartmentRouting: {
        departments: TelegramDepartmentRecord[];
        routes: TelegramDepartmentRouteRecord[];
    };
}
