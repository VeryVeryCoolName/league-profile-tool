const js = require('@eslint/js');
const angular = require('@angular-eslint/eslint-plugin');
const angularTemplate = require('@angular-eslint/eslint-plugin-template');
const angularTemplateParser = require('@angular-eslint/template-parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

const tsTypeChecked = tsPlugin.configs['flat/recommended-type-checked'];

module.exports = [
  {
    ignores: [
      'dist/**',
      'release/**',
      'node_modules/**'
    ]
  },
  {
    ...js.configs.recommended,
    files: ['**/*.js']
  },
  ...tsTypeChecked.map(config => ({
    ...config,
    files: ['**/*.ts']
  })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        project: [
          './tsconfig.serve.json',
          './src/tsconfig.app.json',
          './src/tsconfig.spec.json'
        ],
        sourceType: 'module',
        tsconfigRootDir: __dirname
      },
      globals: {
        Buffer: 'readonly',
        NodeJS: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        document: 'readonly',
        global: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly'
      }
    },
    plugins: {
      '@angular-eslint': angular
    },
    rules: {
      '@typescript-eslint/indent': 0,
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrors: 'none'
      }],
      '@typescript-eslint/no-empty-function': 0,
      '@typescript-eslint/no-explicit-any': 0,
      '@typescript-eslint/no-var-requires': 0,
      '@typescript-eslint/no-unsafe-call': 0,
      '@typescript-eslint/no-unsafe-member-access': 0,
      '@typescript-eslint/no-unsafe-assignment': 0,
      '@typescript-eslint/no-unsafe-argument': 0,
      '@typescript-eslint/no-unsafe-return': 0,
      '@typescript-eslint/no-floating-promises': 0,
      '@typescript-eslint/no-require-imports': 0,
      '@typescript-eslint/no-base-to-string': 0,
      '@typescript-eslint/prefer-promise-reject-errors': 0,
      semi: 'error',
      '@angular-eslint/use-injectable-provided-in': 'error',
      '@angular-eslint/no-attribute-decorator': 'error'
    }
  },
  {
    files: ['**/*.component.html'],
    languageOptions: {
      parser: angularTemplateParser
    },
    plugins: {
      '@angular-eslint/template': angularTemplate
    },
    rules: {
      '@angular-eslint/template/banana-in-box': 'error',
      '@angular-eslint/template/no-negated-async': 'error'
    }
  }
];
