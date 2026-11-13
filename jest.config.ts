export default {
  testEnvironment: 'node',
  transform: { '^.+\\.(t|j)sx?$': ['ts-jest', { diagnostics: false, isolatedModules: true }] },
  moduleNameMapper: {
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
  },
  roots: ['<rootDir>/libraries/helpers/src'],
  testMatch: ['**/*.spec.ts'],
  passWithNoTests: true,
};
