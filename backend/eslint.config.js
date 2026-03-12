const globals = require('globals');

module.exports = [
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.es2022,
                fetch: 'readonly',
                AbortController: 'readonly',
                Buffer: 'readonly',
                setInterval: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': ['warn', {
                argsIgnorePattern: '^_|^next$|^req$|^res$|^err$|^error$',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_|^e$|Error$',
                destructuredArrayIgnorePattern: '^_',
                ignoreRestSiblings: true
            }],
            'no-undef': 'error',
            'no-const-assign': 'error',
            'no-dupe-keys': 'error',
            'no-duplicate-case': 'error',
            'eqeqeq': ['warn', 'smart'],
            'no-eval': 'error',
            'no-implied-eval': 'error'
        }
    }
];
