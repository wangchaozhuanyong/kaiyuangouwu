module.exports = {
    overrides: [
        {
            files: ['**/*.mjs'],
            parserOptions: {
                ecmaVersion: 'latest',
                project: null,
                sourceType: 'module',
            },
        },
    ],
    parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.node.json'],
        tsconfigRootDir: __dirname,
    },
};
