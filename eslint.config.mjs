import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    files: ['src/remote_types.ts'],
    rules: {
      'no-case-declarations': 'off',
      'no-var': 'off',
      '@typescript-eslint/no-array-constructor': 'off',
      '@typescript-eslint/prefer-namespace-keyword': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    ignores: ['dist/**/*'],
  },
)
