import { defineConfig } from 'vitest/config';

// One command runs every package's tests. The web app has its own jsdom project.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'core', root: 'packages/core', environment: 'node' } },
      { test: { name: 'vision', root: 'packages/vision', environment: 'node' } },
      { test: { name: 'api', root: 'apps/api', environment: 'node', fileParallelism: false } },
      { test: { name: 'mcp', root: 'apps/mcp', environment: 'node' } },
      { test: { name: 'evals', root: 'evals', environment: 'node' } },
      'apps/web',
    ],
  },
});
