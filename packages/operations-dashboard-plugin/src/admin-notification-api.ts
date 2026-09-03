import gql from 'graphql-tag';

export const adminNotificationApiExtensions = gql`
    type TelegramNotificationConfig {
        id: ID!
        enabled: Boolean!
        tokenConfigured: Boolean!
        chatId: String
        chatIdSource: String!
        adminBaseUrl: String
        timezone: String!
        minSeverity: String!
        sendResolved: Boolean!
        p2Silent: Boolean!
        p3Silent: Boolean!
        notifyOrderEvents: Boolean!
        notifyPaymentEvents: Boolean!
        notifyFulfillmentEvents: Boolean!
        notifyRefundEvents: Boolean!
        notifyInventoryEvents: Boolean!
        inventoryLowThreshold: Int!
        p1EscalationMinutes: Int!
        p0RepeatMinutes: Int!
        p1RepeatMinutes: Int!
        departmentMentions: JSON!
        routeOverrides: JSON!
        botUsername: String
        lastConnectionAt: DateTime
        lastConnectionError: String
    }

    input UpdateTelegramNotificationConfigInput {
        enabled: Boolean
        chatId: String
        adminBaseUrl: String
        timezone: String
        minSeverity: String
        sendResolved: Boolean
        p2Silent: Boolean
        p3Silent: Boolean
        notifyOrderEvents: Boolean
        notifyPaymentEvents: Boolean
        notifyFulfillmentEvents: Boolean
        notifyRefundEvents: Boolean
        notifyInventoryEvents: Boolean
        inventoryLowThreshold: Int
        p1EscalationMinutes: Int
        p0RepeatMinutes: Int
        p1RepeatMinutes: Int
        departmentMentions: JSON
        routeOverrides: JSON
    }

    type TelegramConnectionTestResult {
        ok: Boolean!
        message: String!
        botUsername: String
        testedAt: DateTime!
    }

    type TelegramNotificationConfigAudit {
        id: ID!
        createdAt: DateTime!
        action: String!
        actorUserId: String
        changes: JSON!
    }

    type AdminNotificationDelivery {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        eventType: String!
        category: String!
        ownerDepartmentCode: String!
        collaboratorDepartmentCodes: [String!]!
        escalationDepartmentCode: String
        actionRequired: Boolean!
        slaDueAt: DateTime
        actionHint: String!
        severity: String!
        mode: String!
        eventState: String!
        sourceType: String
        sourceId: String
        title: String!
        payload: JSON!
        occurrenceCount: Int!
        firstOccurredAt: DateTime!
        lastOccurredAt: DateTime!
        resolvedAt: DateTime
        escalatedAt: DateTime
        priority: Int!
        silent: Boolean!
        deliveryAction: String!
        deliveryStatus: String!
        availableAt: DateTime!
        attempts: Int!
        maxAttempts: Int!
        telegramMessageId: String
        lastErrorCode: String
        lastError: String
        sentAt: DateTime
    }

    type AdminNotificationDeliveryList {
        items: [AdminNotificationDelivery!]!
        totalItems: Int!
    }

    type TelegramNotificationStatus {
        running: Boolean!
        processed: Int!
        failures: Int!
        pending: Int!
        retrying: Int!
        dead: Int!
        oldestLagSeconds: Int!
        lastSuccessAt: DateTime
        lastErrorAt: DateTime
        lastError: String
    }

    type TelegramDepartment {
        code: String!
        nameZh: String!
        nameEn: String!
    }

    type TelegramDepartmentRoute {
        eventType: String!
        severity: String!
        owner: String!
        collaborators: [String!]!
        escalation: String
        actionRequired: Boolean!
        slaMinutes: Int
        actionHint: String!
        overridden: Boolean!
        defaultOwner: String!
        defaultCollaborators: [String!]!
        defaultEscalation: String
        defaultActionRequired: Boolean!
        defaultSlaMinutes: Int
    }

    type TelegramDepartmentRouting {
        departments: [TelegramDepartment!]!
        routes: [TelegramDepartmentRoute!]!
    }

    extend type Query {
        telegramNotificationConfig: TelegramNotificationConfig!
        telegramNotificationConfigAudits(take: Int): [TelegramNotificationConfigAudit!]!
        telegramNotificationStatus: TelegramNotificationStatus!
        telegramNotificationDeliveries(skip: Int, take: Int, status: String): AdminNotificationDeliveryList!
        telegramDepartmentRouting: TelegramDepartmentRouting!
    }

    extend type Mutation {
        updateTelegramNotificationConfig(
            input: UpdateTelegramNotificationConfigInput!
        ): TelegramNotificationConfig!
        testTelegramConnection: TelegramConnectionTestResult!
        sendTelegramNotificationTest(kind: String!): AdminNotificationDelivery!
        retryTelegramNotificationDelivery(id: ID!): AdminNotificationDelivery!
    }
`;
