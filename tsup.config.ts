import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  target: 'node22',
  platform: 'node',
  external: ['node:sqlite'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
});
