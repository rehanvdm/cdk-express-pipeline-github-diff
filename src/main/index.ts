import * as core from '@actions/core';
import { generate } from './generate.js';
import { print } from './print.js';

export async function run(): Promise<void> {
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
