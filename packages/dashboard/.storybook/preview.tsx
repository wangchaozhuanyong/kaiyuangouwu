import '../src/app/styles.css';

import { registerDefaults } from '@/vdb/framework/defaults.js';
import { defaultLocale, dynamicActivate } from '@/vdb/providers/i18n-provider.js';
import type { Preview } from '@storybook/react-vite';
import { useEffect } from 'react';
import { CommonProviders } from './providers.js';
import { transformDocumentNodeInSource } from './transform-document-node.js';

/**
 * Clean JSDoc tags from component descriptions
 * Removes @description, @example, @docsCategory, @docsPage tags while keeping content
 */
function cleanJSDocDescription(description: string): string {
    if (!description) return description;

    return (
        description
            // Remove @description tag but keep the text
            .replace(/@description\s*/gi, '')
            // Replace @example with Example: label
            .replace(/@example\s*/gi, 'Example:\n')
            // Remove @docsCategory and @docsPage lines entirely
            .replace(/@docsCategory\s+[\w-]+/gi, '')
            .replace(/@docsPage\s+[\w-]+/gi, '')
            // Clean up extra whitespace
            .replace(/\n\n\n+/g, '\n\n')
            .trim()
    );
}

const preview: Preview = {
    globalTypes: {
        theme: {
            description: 'Dashboard color theme',
            defaultValue: 'light',
            toolbar: {
                icon: 'mirror',
                items: [
                    { value: 'light', title: 'Light' },
                    { value: 'dark', title: 'Dark' },
                ],
            },
        },
        direction: {
            description: 'Document text direction',
            defaultValue: 'ltr',
            toolbar: {
                icon: 'transfer',
                items: [
                    { value: 'ltr', title: 'LTR' },
                    { value: 'rtl', title: 'RTL' },
                ],
            },
        },
    },
    parameters: {
        controls: {
            matchers: {
                color: /(background|color)$/i,
                date: /Date$/i,
            },
        },
        options: {
            storySort: {
                order: ['Introduction', 'Layout', 'Framework', 'Form Inputs', 'UI'],
            },
        },
        a11y: {
            test: 'error',
        },
        docs: {
            source: {
                transform: async (source: string, storyContext: any) => {
                    return transformDocumentNodeInSource(source, storyContext);
                },
            },
            // Transform component descriptions to remove JSDoc tags
            extractComponentDescription: (_component: any, { component }: any) => {
                // Try to get description from docgen first
                const docgenInfo = component?.__docgenInfo;

                // If docgen has a description, clean it
                if (docgenInfo?.description) {
                    const cleaned = cleanJSDocDescription(docgenInfo.description);
                    if (cleaned) {
                        return cleaned;
                    }
                }

                // If no description in docgen, try to extract from component's toString()
                // This is a fallback for when docgen doesn't extract @description properly
                const componentStr = component?.toString() || '';
                const jsdocMatch = componentStr.match(/\/\*\*([\s\S]*?)\*\//);

                if (jsdocMatch) {
                    const jsdoc = jsdocMatch[0];
                    // Extract text after @description tag
                    const descMatch = jsdoc.match(/@description\s*\n\s*\*\s*(.*?)(?=\n\s*\*\s*@|\n\s*\*\/)/s);
                    if (descMatch) {
                        return descMatch[1].trim();
                    }
                }

                return null;
            },
        },
    },
    decorators: [
        (Story, context) => {
            const direction = context.globals.direction === 'rtl' ? 'rtl' : 'ltr';
            const theme = context.globals.theme === 'dark' ? 'dark' : 'light';

            useEffect(() => {
                // With this method we dynamically load the catalogs
                void dynamicActivate(defaultLocale);
                registerDefaults();
            }, []);

            useEffect(() => {
                document.documentElement.dir = direction;
                return () => {
                    document.documentElement.removeAttribute('dir');
                };
            }, [direction]);

            return (
                <div dir={direction}>
                    <CommonProviders defaultTheme={theme}>
                        <Story />
                    </CommonProviders>
                </div>
            );
        },
    ],
};

export default preview;
