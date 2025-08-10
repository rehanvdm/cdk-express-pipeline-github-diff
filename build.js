#!/usr/bin/env node

import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const buildOptions = {
  entryPoints: [join(__dirname, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(__dirname, 'dist/index.js'),
  sourcemap: true,
  minify: false,
  treeShaking: true,
  metafile: true,
  external: ['fsevents'],
  packages: 'external'
};

async function runBuild() {
  try {
    const result = await build(buildOptions);
    console.log('Build completed successfully');
    if (result.metafile) {
      console.log('Bundle analysis available in metafile');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

runBuild();
