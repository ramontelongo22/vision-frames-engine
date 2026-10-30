module.exports = {
  testEnvironment: 'node',
  transform: {
    // ts-jest type-checks each test and compiles it as CommonJS whatever tsconfig's module
    // is. 151002 only warns that the node20 module setting is not used for that; the
    // compiled package keeps it, and smoke:mock runs the HEIC path from dist.
    '^.+\\.ts$': ['ts-jest', { diagnostics: { ignoreCodes: [151002] } }],
  },
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
