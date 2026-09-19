import { gql } from '@apollo/client';

export interface AssignmentChannel {
    id: string;
    code: string;
    isDefault: boolean;
}

export interface ProductChannelAssignment {
    id: string;
    name: string;
    enabled: boolean;
    channels: AssignmentChannel[];
}

export interface CatalogChannelAssignmentsData {
    catalogProductChannelAssignments: {
        items: ProductChannelAssignment[];
        totalItems: number;
        channels: AssignmentChannel[];
        scopeChannel: AssignmentChannel;
        summary: {
            totalItems: number;
            unassignedItems: number;
            multiChannelItems: number;
            channelCounts: Array<{ channelId: string; count: number }>;
        };
    };
}

export const GET_CATALOG_CHANNEL_ASSIGNMENTS = gql`
    query GetCatalogChannelAssignments(
        $options: ProductListOptions
        $assignmentFilter: CatalogChannelAssignmentFilterInput
    ) {
        catalogProductChannelAssignments(options: $options, assignmentFilter: $assignmentFilter) {
            totalItems
            scopeChannel {
                id
                code
                isDefault
            }
            summary {
                totalItems
                unassignedItems
                multiChannelItems
                channelCounts {
                    channelId
                    count
                }
            }
            channels {
                id
                code
                isDefault
            }
            items {
                id
                name
                enabled
                channels {
                    id
                    code
                    isDefault
                }
            }
        }
    }
`;
