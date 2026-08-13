import { graphql } from '@vendure/dashboard';

export const operationsTodoQuery = graphql(`
    query OperationsTodoCounts {
        pendingPayment: orders(
            options: { filter: { active: { eq: false }, state: { eq: "ArrangingPayment" } } }
        ) {
            totalItems
        }
        pendingShipment: orders(
            options: {
                filter: {
                    active: { eq: false }
                    state: { in: ["PaymentAuthorized", "PaymentSettled", "PartiallyShipped"] }
                }
            }
        ) {
            totalItems
        }
        modifying: orders(options: { filter: { active: { eq: false }, state: { eq: "Modifying" } } }) {
            totalItems
        }
    }
`);
