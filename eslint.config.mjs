import tseslint from 'typescript-eslint';

/** Focused flat config: TypeScript is type-checked by `tsc --noEmit`; ESLint
 *  guards the handful of runtime hazards that a type checker cannot catch. */
export default [
  {
    ignores: ['node_modules/**', '.next/**', '.data/**', 'coverage/**', 'next-env.d.ts', '*.d.ts'],
  },
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-debugger': 'error',
      'no-var': 'error',
      'no-unsafe-finally': 'error',
    },
  },
];
