import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import storybook from 'eslint-plugin-storybook';

const sharedLanguageOptions = {
    ecmaVersion: 'latest',
    globals: {
        ...globals.browser,
        ...globals.node,
    },
    parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
    },
};

const reactRules = {
    ...react.configs['jsx-runtime'].rules,
    'react/jsx-no-target-blank': 'off',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'off',
    'react-refresh/only-export-components': 'off',
};

export default [
    {
        ignores: [
            '**/dist/**',
            '**/storybook-static/**',
            '**/.temp/**',
            '**/vite/tests/__temp/**',
            '**/vite/tests/fixtures-*/**',
            '**/e2e/fixtures/.compiled/**',
        ],
    },
    {
        linterOptions: {
            reportUnusedDisableDirectives: false,
        },
    },
    {
        files: ['**/*.{js,jsx,mjs,cjs}'],
        languageOptions: sharedLanguageOptions,
        settings: { react: { version: 'detect' } },
        plugins: {
            react,
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            ...js.configs.recommended.rules,
            ...reactRules,
            'no-case-declarations': 'off',
            'no-redeclare': 'off',
            'no-unused-vars': 'off',
        },
    },
    {
        files: ['**/*.{ts,tsx,mts,cts}'],
        languageOptions: {
            ...sharedLanguageOptions,
            parser: tsParser,
        },
        settings: { react: { version: 'detect' } },
        plugins: {
            '@typescript-eslint': tsPlugin,
            react,
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            ...reactRules,
            'no-undef': 'off',
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
        },
    },
    ...storybook.configs['flat/recommended'],
];
