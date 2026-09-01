import { gql } from 'graphql-tag';

export const systemAnnouncementsQuery = gql`
    query SystemAnnouncements {
        systemAnnouncements {
            id
            createdAt
            updatedAt
            enabled
            priority
            targetMode
            channels {
                id
                code
            }
            titleZh
            titleEn
            titleEnLocked
            contentZh
            contentEn
            contentEnLocked
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
    targetMode: 'ALL' | 'SINGLE' | 'MULTIPLE';
    channels: Array<{ id: string; code: string }>;
    titleZh: string;
    titleEn: string;
    titleEnLocked: boolean;
    contentZh: string;
    contentEn: string;
    contentEnLocked: boolean;
    linkUrl: string | null;
    startsAt: string | null;
    endsAt: string | null;
}

export interface SystemAnnouncementsResult {
    systemAnnouncements: SystemAnnouncementRecord[];
}
