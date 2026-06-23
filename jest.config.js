/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
    }],
  },
  setupFiles: ['reflect-metadata'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['functions/**/*.ts', '!functions/index.ts', '!functions/**/index.ts'],
  passWithNoTests: true,
}
