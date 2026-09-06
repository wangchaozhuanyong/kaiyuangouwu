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
    };
}

export const GET_CATALOG_CHANNEL_ASSIGNMENTS = gql`
    query GetCatalogChannelAssignments($options: ProductListOptions) {
        catalogProductChannelAssignments(options: $options) {
            totalItems
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
