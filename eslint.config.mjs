// @ts-check

import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: ['**/__tests__/', 'build/'],
    rules: {
      'no-undef': 0,
      '@typescript-eslint/interface-name': 0,
      '@typescript-eslint/object-literal-sort-keys': 0,
      '@typescript-eslint/no-var-requires': 0,
      '@typescript-eslint/member-access': 0,
      '@typescript-eslint/require-await': 0,
      '@typescript-eslint/no-non-null-assertion': 0,
      '@typescript-eslint/member-delimiter-style': 0,
      '@typescript-eslint/no-explicit-any': 0,
      '@typescript-eslint/explicit-function-return-type': 0,
      '@typescript-eslint/no-use-before-define': 0,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      '@typescript-eslint/ban-ts-comment': 0,
    },
  }
)
