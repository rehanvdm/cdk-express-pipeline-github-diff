#!/usr/bin/env node

import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { copyFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const buildOptions = {
  entryPoints: [join(__dirname, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(__dirname, 'dist/index.cjs'),
  sourcemap: true,
  minify: false,
  treeShaking: true,
  metafile: true,
  external: ['fsevents']
};

function copyRequiredFiles() {
  const sourceFile = join(__dirname, 'node_modules/@aws-cdk/aws-service-spec/db.json.gz');
  const destFile = join(__dirname, 'db.json.gz');

  if (existsSync(sourceFile)) {
    copyFileSync(sourceFile, destFile);
    console.log('Copied db.json.gz to project root');
  } else {
    console.warn('Warning: db.json.gz not found in node_modules/@aws-cdk/aws-service-spec/');
  }
}

async function runBuild() {
  try {
    // Copy required files before building fixes edge case
    //https://github.com/aws/aws-cdk/pull/28199/files#diff-b3e2f62a84215a30dabfbc695018fd0442e071282aae842a42816e7b7e2daed0R68
    copyRequiredFiles();

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
