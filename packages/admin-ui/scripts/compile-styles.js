const path = require('node:path');
const fs = require('node:fs');
const sass = require('sass');

// Compiles the Admin UI styles into a css file for consumption by
// non-Angular ui extensions.
const outFile = path.join(__dirname, '../package/static/theme.min.css');
const result = sass.compile(path.join(__dirname, '../src/lib/static/styles/ui-extension-theme.scss'), {
    loadPaths: [
        path.join(__dirname, '../src/lib/static/styles'),
        path.join(__dirname, '../src/lib/static/fonts'),
        path.join(__dirname, '../node_modules'),
        path.join(__dirname, '../../../node_modules'),
    ],
    silenceDeprecations: ['color-functions', 'global-builtin', 'import'],
    style: 'compressed',
});

fs.writeFileSync(outFile, result.css, 'utf8');
