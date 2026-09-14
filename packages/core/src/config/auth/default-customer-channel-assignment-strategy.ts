import { CustomerChannelAssignmentStrategy } from './customer-channel-assignment-strategy';

/**
 * @description
 * The default {@link CustomerChannelAssignmentStrategy}: Customers remain isolated to their
 * assigned Channels. Cross-Channel assignment must be explicitly enabled with a custom strategy.
 *
 * @docsCategory auth
 * @docsPage CustomerChannelAssignmentStrategy
 * @since 3.7.0
 */
export class DefaultCustomerChannelAssignmentStrategy implements CustomerChannelAssignmentStrategy {
    canAssignCustomerToChannel(): boolean {
        return false;
    }
}
