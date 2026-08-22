// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from 'rollup-plugin-typescript2';

export default commandLineArgs => {
    const isProd = commandLineArgs.configProduction === true;
    return {
        input: 'src/client/index.ts',
        output: {
            dir: 'client',
            format: 'umd',
            name: 'VendureUiClient',
        },
        plugins: [
            resolve({ extensions: ['.mjs', '.js', '.json', '.node', '.ts'] }),
            typescript({ include: ['**/*.ts'] }),
            ...(isProd
                ? [
                      terser({
                          output: {
                              comments: false,
                          },
                      }),
                  ]
                : []),
        ],
    };
};
