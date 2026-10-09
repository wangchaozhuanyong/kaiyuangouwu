import type { StorefrontSystemAnnouncement } from '../types';

import { BaseDomainApi } from './base-domain-api';

const fields = 'id createdAt title content linkUrl startsAt endsAt';
export interface AnnouncementList {
    items: StorefrontSystemAnnouncement[];
    totalItems: number;
}

export class AnnouncementsApi extends BaseDomainApi {
    async list(options: { skip: number; take: number }, signal?: AbortSignal): Promise<AnnouncementList> {
        const result = await this.request<{ storefrontAnnouncements: AnnouncementList }>(
            `query StorefrontAnnouncements($options: StorefrontAnnouncementPageOptions) {
                storefrontAnnouncements(options: $options) { items { ${fields} } totalItems }
            }`,
            { options },
            signal,
        );
        return result.storefrontAnnouncements;
    }

    async detail(id: string, signal?: AbortSignal): Promise<StorefrontSystemAnnouncement | null> {
        const result = await this.request<{ storefrontAnnouncement: StorefrontSystemAnnouncement | null }>(
            `query StorefrontAnnouncement($id: ID!) { storefrontAnnouncement(id: $id) { ${fields} } }`,
            { id },
            signal,
        );
        return result.storefrontAnnouncement;
    }
}
