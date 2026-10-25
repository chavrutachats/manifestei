import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // testes de integração compartilham um banco: sem paralelismo entre arquivos
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
