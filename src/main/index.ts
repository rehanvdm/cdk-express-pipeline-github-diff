import * as core from '@actions/core';
import { createHash } from 'crypto';
import { generate } from './generate.js';
import { print } from './print.js';

export async function run(): Promise<void> {
  process.env.FORCE_COLOR = '1';
  try {
    const isDebug = core.isDebug();
    if (isDebug) {
      core.info('🐛 Debug mode enabled');
    }

    const mode = core.getInput('mode', { required: true });
    if (mode !== 'generate' && mode !== 'print') {
      core.setFailed(`Invalid mode '${mode}' specified. Valid modes are 'generate' or 'print'.`);
      return;
    }

    if (mode === 'generate') await generate();
    else if (mode === 'print') await print();

    core.info('Successfully updated PR description with CDK Express Pipeline diff');
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

export function getCacheKey(stackSelector?: string): string {
  let ret = `cdk-diff-pipeline-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-`;
  if (stackSelector) {
    ret += createHash('md5').update(stackSelector).digest('hex');
  }
  return ret;
}
