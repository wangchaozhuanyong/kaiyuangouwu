import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

interface TranslationRuntime {
    readonly locale: string;
    readonly messages: Record<string, unknown>;
    _(descriptor: MessageDescriptor | string): string;
}

interface ScheduledTaskLabel {
    name: MessageDescriptor;
    description: MessageDescriptor;
}

const builtInScheduledTaskLabels: Record<string, ScheduledTaskLabel> = {
    'clean-sessions': {
        name: msg({ id: 'scheduledTask.cleanSessions', message: 'Clean expired sign-in sessions' }),
        description: msg({
            id: 'scheduledTask.cleanSessions.description',
            message: 'Removes expired administrator and customer sign-in sessions from the database',
        }),
    },
    'clean-orphaned-settings-store': {
        name: msg({
            id: 'scheduledTask.cleanOrphanedSettingsStore',
            message: 'Clean invalid system configuration',
        }),
        description: msg({
            id: 'scheduledTask.cleanOrphanedSettingsStore.description',
            message: 'Removes system configuration records whose field definitions no longer exist',
        }),
    },
    'clean-jobs': {
        name: msg({ id: 'scheduledTask.cleanJobs', message: 'Clean background task records' }),
        description: msg({
            id: 'scheduledTask.cleanJobs.description',
            message: 'Removes completed, failed, and cancelled background task records from the database',
        }),
    },
    'clean-job-queue-index': {
        name: msg({ id: 'scheduledTask.cleanJobQueueIndex', message: 'Clean background task index' }),
        description: msg({
            id: 'scheduledTask.cleanJobQueueIndex.description',
            message: 'Cleans the index used to speed up background task list queries',
        }),
    },
};

const customScheduledTaskLabel: ScheduledTaskLabel = {
    name: msg({ id: 'scheduledTask.custom', message: 'Custom scheduled task' }),
    description: msg({
        id: 'scheduledTask.custom.description',
        message: 'A scheduled background task registered by a plugin or business extension',
    }),
};

function humanizeTaskId(taskId: string): string {
    const words = taskId.replace(/[-_]+/gu, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : taskId;
}

export interface ScheduledTaskDisplayInfo {
    name: string;
    description: string;
}

export function getScheduledTaskDisplayInfo(
    i18n: TranslationRuntime,
    task: { id: string; description?: string | null },
): ScheduledTaskDisplayInfo {
    const builtInLabel = builtInScheduledTaskLabels[task.id];
    if (builtInLabel) {
        return {
            name: i18n._(builtInLabel.name),
            description: i18n._(builtInLabel.description),
        };
    }

    const pluginNameId = `scheduledTask.${task.id}`;
    const pluginDescriptionId = `${pluginNameId}.description`;
    const hasPluginName = Object.prototype.hasOwnProperty.call(i18n.messages, pluginNameId);
    const hasPluginDescription = Object.prototype.hasOwnProperty.call(i18n.messages, pluginDescriptionId);

    if (i18n.locale.startsWith('zh')) {
        return {
            name: hasPluginName ? i18n._(pluginNameId) : i18n._(customScheduledTaskLabel.name),
            description: hasPluginDescription
                ? i18n._(pluginDescriptionId)
                : i18n._(customScheduledTaskLabel.description),
        };
    }

    return {
        name: hasPluginName ? i18n._(pluginNameId) : humanizeTaskId(task.id),
        description: hasPluginDescription
            ? i18n._(pluginDescriptionId)
            : task.description || i18n._(customScheduledTaskLabel.description),
    };
}
