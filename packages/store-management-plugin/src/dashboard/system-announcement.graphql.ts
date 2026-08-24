import { gql } from 'graphql-tag';

export const systemAnnouncementsQuery = gql`
    query SystemAnnouncements {
        systemAnnouncements {
            id
            createdAt
            updatedAt
            enabled
            priority
            titleZh
            titleEn
            contentZh
            contentEn
            linkUrl
            startsAt
            endsAt
        }
    }
`;

export const createSystemAnnouncementMutation = gql`
    mutation CreateSystemAnnouncement($input: CreateSystemAnnouncementInput!) {
        createSystemAnnouncement(input: $input) {
            id
        }
    }
`;

export const updateSystemAnnouncementMutation = gql`
    mutation UpdateSystemAnnouncement($input: UpdateSystemAnnouncementInput!) {
        updateSystemAnnouncement(input: $input) {
            id
            enabled
        }
    }
`;

export const deleteSystemAnnouncementMutation = gql`
    mutation DeleteSystemAnnouncement($id: ID!) {
        deleteSystemAnnouncement(id: $id) {
            result
            message
        }
    }
`;

export interface SystemAnnouncementRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    enabled: boolean;
    priority: number;
    titleZh: string;
    titleEn: string;
    contentZh: string;
    contentEn: string;
    linkUrl: string | null;
    startsAt: string | null;
    endsAt: string | null;
}

export interface SystemAnnouncementsResult {
    systemAnnouncements: SystemAnnouncementRecord[];
}
