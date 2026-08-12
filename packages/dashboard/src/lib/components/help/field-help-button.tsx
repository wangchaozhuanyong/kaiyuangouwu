import { Button } from '@/vdb/components/ui/button.js';
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from '@/vdb/components/ui/popover.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { CircleHelp } from 'lucide-react';

import { getFieldHelpTopic, localizeHelpText } from './help-content.js';

export interface FieldHelpButtonProps {
    fieldName: string;
    title?: string;
    description?: string;
}

export function FieldHelpButton({ fieldName, title, description }: Readonly<FieldHelpButtonProps>) {
    const { displayLanguage } = useUserSettings().settings;
    const topic = getFieldHelpTopic(fieldName);

    if (!topic && !description) return null;

    const isChinese = displayLanguage.startsWith('zh');
    const label = isChinese ? '查看字段说明' : 'View field guidance';
    const resolvedTitle = topic
        ? localizeHelpText(topic.title, displayLanguage)
        : (title ?? (isChinese ? '字段说明' : 'Field guidance'));
    const resolvedDescription = topic ? localizeHelpText(topic.description, displayLanguage) : description;

    return (
        <Popover>
            <PopoverTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={label}
                        title={label}
                    />
                }
            >
                <CircleHelp className="size-3.5" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
                <PopoverHeader>
                    <PopoverTitle>{resolvedTitle}</PopoverTitle>
                    <PopoverDescription className="leading-6 text-foreground/80">
                        {resolvedDescription}
                    </PopoverDescription>
                </PopoverHeader>
                {topic?.note ? (
                    <p className="mt-3 border-s-2 border-amber-500/70 ps-3 text-sm leading-6 text-muted-foreground">
                        {localizeHelpText(topic.note, displayLanguage)}
                    </p>
                ) : null}
            </PopoverContent>
        </Popover>
    );
}
