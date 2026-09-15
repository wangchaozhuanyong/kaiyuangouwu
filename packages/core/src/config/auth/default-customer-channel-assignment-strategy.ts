import { CustomerChannelAssignmentStrategy } from './customer-channel-assignment-strategy';

/**
 * @description
 * The default {@link CustomerChannelAssignmentStrategy}: authenticated Customer identities are
 * shared. Store business data is scoped independently from this membership relationship.
 *
 * @docsCategory auth
 * @docsPage CustomerChannelAssignmentStrategy
 * @since 3.7.0
 */
export class DefaultCustomerChannelAssignmentStrategy implements CustomerChannelAssignmentStrategy {
    canAssignCustomerToChannel(): boolean {
        return true;
    }
}
