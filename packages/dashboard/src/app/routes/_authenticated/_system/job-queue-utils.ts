import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

interface TranslationRuntime {
    readonly locale: string;
    readonly messages: Record<string, unknown>;
    _(descriptor: MessageDescriptor): string;
    _(id: string): string;
}

interface JobQueueLabel {
    name: MessageDescriptor;
    description: MessageDescriptor;
}

const builtInJobQueueLabels: Record<string, JobQueueLabel> = {
    'apply-collection-filters': {
        name: msg({ id: 'jobQueue.applyCollectionFilters', message: 'Update product group matches' }),
        description: msg({
            id: 'jobQueue.applyCollectionFilters.description',
            message: 'Recalculates product group contents from their filter rules',
        }),
    },
    'clean-sessions': {
        name: msg({ id: 'jobQueue.cleanSessions', message: 'Clean expired sign-in sessions' }),
        description: msg({
            id: 'jobQueue.cleanSessions.description',
            message: 'Removes expired administrator and customer sign-in sessions',
        }),
    },
    'send-email': {
        name: msg({ id: 'jobQueue.sendEmail', message: 'Send system email' }),
        description: msg({
            id: 'jobQueue.sendEmail.description',
            message: 'Sends order, account, and other notification emails',
        }),
    },
    'update-search-index': {
        name: msg({ id: 'jobQueue.updateSearchIndex', message: 'Update product search index' }),
        description: msg({
            id: 'jobQueue.updateSearchIndex.description',
            message: 'Synchronizes product search and filtering data',
        }),
    },
};

const customJobQueueLabel: JobQueueLabel = {
    name: msg({ id: 'jobQueue.custom', message: 'Custom background task' }),
    description: msg({
        id: 'jobQueue.custom.description',
        message: 'A background task registered by a plugin or business extension',
    }),
};

function humanizeJobQueueName(queueName: string): string {
    const words = queueName.replace(/[-_]+/gu, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : queueName;
}

export interface JobQueueDisplayInfo {
    name: string;
    description: string;
}

export function getJobQueueDisplayInfo(i18n: TranslationRuntime, queueName: string): JobQueueDisplayInfo {
    const builtInLabel = builtInJobQueueLabels[queueName];
    if (builtInLabel) {
        return {
            name: i18n._(builtInLabel.name),
            description: i18n._(builtInLabel.description),
        };
    }

    const pluginMessageId = `jobQueue.${queueName}`;
    if (Object.prototype.hasOwnProperty.call(i18n.messages, pluginMessageId)) {
        return {
            name: i18n._(pluginMessageId),
            description: i18n._(customJobQueueLabel.description),
        };
    }

    return {
        name: i18n.locale.startsWith('zh')
            ? i18n._(customJobQueueLabel.name)
            : humanizeJobQueueName(queueName),
        description: i18n._(customJobQueueLabel.description),
    };
}

export function getJobQueueDisplayName(i18n: TranslationRuntime, queueName: string): string {
    return getJobQueueDisplayInfo(i18n, queueName).name;
}

export function formatJobDuration(ms: number, locale: string): string {
    const formatUnit = (value: number, unit: Intl.NumberFormatOptions['unit']) =>
        new Intl.NumberFormat(locale.replace(/_/gu, '-'), {
            style: 'unit',
            unit,
            unitDisplay: 'short',
        }).format(value);

    if (ms < 1000) {
        return formatUnit(ms, 'millisecond');
    }

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const parts: string[] = [];

    if (days > 0) parts.push(formatUnit(days, 'day'));
    if (hours % 24 > 0) parts.push(formatUnit(hours % 24, 'hour'));
    if (minutes % 60 > 0) parts.push(formatUnit(minutes % 60, 'minute'));
    if (seconds % 60 > 0) parts.push(formatUnit(seconds % 60, 'second'));

    return parts.join(' ');
}
