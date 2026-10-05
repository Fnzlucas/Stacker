// ESLint (flat config) : zéro avertissement toléré (`eslint --max-warnings=0`).
import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ROOT = import.meta.dirname;

export default tseslint.config(
  {
    ignores: ['dist/**', '.ssr/**', '.e2e/**', 'coverage/**', 'node_modules/**', 'design/**', 'test-results/**', 'playwright-report/**', '*.html'],
  },
  js.configs.recommended,
  {
    // Espaces insécables volontaires dans les textes (typographie française : « 15 % », « 6,99 € »).
    rules: { 'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipJSXText: true }] },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: ROOT,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: false }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    languageOptions: { globals: globals.browser },
    settings: { react: { version: '19' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.strict.rules,
      // Sécurité (DoD §6 critère 6) : aucun HTML brut injecté.
      'react/no-danger': 'error',
      'react/no-danger-with-children': 'error',
      'react/jsx-no-target-blank': 'error',
      'react/prop-types': 'off',
      // Une zone qui défile (tableau large) doit être atteignable au clavier (axe : scrollable-region-focusable).
      'jsx-a11y/no-noninteractive-tabindex': ['error', { roles: ['tabpanel', 'region'] }],
      'no-restricted-syntax': [
        'error',
        { selector: "MemberExpression[property.name='innerHTML']", message: 'innerHTML interdit : utiliser React.' },
        { selector: "MemberExpression[property.name='outerHTML']", message: 'outerHTML interdit.' },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'insertAdjacentHTML interdit.' },
      ],
    },
  },
  {
    // Aucune donnée fabriquée ni date figée dans le code livré (DoD §6 critère 10).
    files: ['src/**/*.{ts,tsx}', 'supabase/functions/**/*.ts'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Math.random interdit : aucune donnée fabriquée (crypto.getRandomValues pour l’aléa).' }],
      'no-restricted-globals': ['error', { name: 'localStorage', message: 'Aucune donnée métier dans localStorage.' }],
    },
  },
  {
    files: ['supabase/functions/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, Deno: 'readonly' } },
  },
  {
    // Point d'entrée Deno : typé par `deno check` (script typecheck), hors projet TypeScript Node.
    files: ['supabase/functions/*/index.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.test.{ts,tsx}', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
);
