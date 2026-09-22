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
        incidentStatus: String!
        acknowledgedAt: DateTime
        acknowledgedByUserId: String
        acknowledgementNote: String
        recoveryObservedAt: DateTime
        recoveryValidationDueAt: DateTime
        recoveryValidatedAt: DateTime
        recoveryValidatedByUserId: String
        recoveryValidationNote: String
        recoveryEscalatedAt: DateTime
        reviewDueAt: DateTime
        reviewSubmittedAt: DateTime
        reviewSubmittedByUserId: String
        rootCause: String
        impactSummary: String
        reviewEscalatedAt: DateTime
        closedAt: DateTime
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

    type AdminIncidentEvidence {
        id: ID!
        createdAt: DateTime!
        eventId: String!
        eventType: String!
        actorType: String!
        actorUserId: String
        summary: String!
        evidence: JSON!
        occurredAt: DateTime!
        evidenceHash: String!
        integrityValid: Boolean!
    }

    type AdminIncidentAction {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        title: String!
        ownerDepartmentCode: String!
        dueAt: DateTime!
        status: String!
        completedAt: DateTime
        completedByUserId: String
        completionNote: String
        escalatedAt: DateTime
    }

    type AdminIncidentDetail {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        eventType: String!
        category: String!
        ownerDepartmentCode: String!
        collaboratorDepartmentCodes: [String!]!
        escalationDepartmentCode: String
        severity: String!
        eventState: String!
        title: String!
        payload: JSON!
        occurrenceCount: Int!
        firstOccurredAt: DateTime!
        lastOccurredAt: DateTime!
        resolvedAt: DateTime
        incidentStatus: String!
        acknowledgedAt: DateTime
        acknowledgedByUserId: String
        acknowledgementNote: String
        recoveryObservedAt: DateTime
        recoveryValidationDueAt: DateTime
        recoveryValidatedAt: DateTime
        recoveryValidatedByUserId: String
        recoveryValidationNote: String
        recoveryEscalatedAt: DateTime
        reviewDueAt: DateTime
        reviewSubmittedAt: DateTime
        reviewSubmittedByUserId: String
        rootCause: String
        impactSummary: String
        reviewEscalatedAt: DateTime
        closedAt: DateTime
        evidence: [AdminIncidentEvidence!]!
        actions: [AdminIncidentAction!]!
    }

    type AdminIncidentList {
        items: [AdminIncidentDetail!]!
        totalItems: Int!
    }

    input AdminIncidentCorrectiveActionInput {
        title: String!
        ownerDepartmentCode: String!
        dueAt: DateTime!
    }

    input SubmitAdminIncidentReviewInput {
        rootCause: String!
        impactSummary: String!
        correctiveActions: [AdminIncidentCorrectiveActionInput!]!
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
        adminIncidents(skip: Int, take: Int, status: String, severity: String): AdminIncidentList!
        adminIncident(id: ID!): AdminIncidentDetail!
    }

    extend type Mutation {
        updateTelegramNotificationConfig(
            input: UpdateTelegramNotificationConfigInput!
        ): TelegramNotificationConfig!
        testTelegramConnection: TelegramConnectionTestResult!
        sendTelegramNotificationTest(kind: String!): AdminNotificationDelivery!
        retryTelegramNotificationDelivery(id: ID!): AdminNotificationDelivery!
        acknowledgeAdminIncident(id: ID!, note: String!, evidence: JSON): AdminIncidentDetail!
        validateAdminIncidentRecovery(id: ID!, note: String!, evidence: JSON): AdminIncidentDetail!
        submitAdminIncidentReview(id: ID!, input: SubmitAdminIncidentReviewInput!): AdminIncidentDetail!
        completeAdminIncidentAction(actionId: ID!, note: String!): AdminIncidentDetail!
    }
`;
