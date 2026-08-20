import { graphql } from '@vendure/dashboard';

export const operationsTodoQuery = graphql(`
    query OperationsTodoCounts {
        pendingPayment: orders(options: { filter: { state: { eq: "ArrangingPayment" } } }) {
            totalItems
        }
        pendingShipment: physicalFulfillmentTodoCount
        modifying: orders(options: { filter: { active: { eq: false }, state: { eq: "Modifying" } } }) {
            totalItems
        }
    }
`);
