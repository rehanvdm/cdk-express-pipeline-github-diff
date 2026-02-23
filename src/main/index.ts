import * as core from '@actions/core';
import * as github from '@actions/github';
import { PullRequestEvent } from '@octokit/webhooks-definitions/schema.js';
import { generate } from './generate.js';
import { print } from './print.js';

export type PrContext = {
  owner: string;
  repo: string;
  pullNumber: number;
  gitHash: string;
  githubToken: string;
};

function getPrContext(): PrContext {
  if (github.context.eventName !== 'pull_request') {
    throw new Error('This action can only be used in a pull request context.');
  }
  const payload = github.context.payload as PullRequestEvent;
  return {
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    pullNumber: payload.pull_request.number,
    gitHash: payload.pull_request.head.sha,
    githubToken: core.getInput('github-token', { required: true })
  };
}

export async function run(): Promise<void> {
  let prContext: PrContext | null = null;
  try {
    const isDebug = core.isDebug();
    if (isDebug) {
      core.info('🐛 Debug mode enabled');
    }

    const mode = core.getInput('mode', { required: true });
    if (mode !== 'generate' && mode !== 'print') {
      throw new Error(`Invalid mode '${mode}' specified. Valid modes are 'generate' or 'print'.`);
    }

    prContext = getPrContext();

    if (mode === 'generate') await generate(prContext);
    else if (mode === 'print') await print(prContext);
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}
