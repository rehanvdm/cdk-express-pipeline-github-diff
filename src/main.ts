import * as core from '@actions/core';
import * as github from '@actions/github';
//@ts-expect-error TS/JS import issue but works
import { PullRequestEvent } from '@octokit/webhooks-definitions/schema';
import { generateDiffs, generateMarkdown, getSavedDiffs, saveDiffs } from './diff.js';
import { DiffMethod, ExpandStackSelection, StackSelectionStrategy, Toolkit } from '@aws-cdk/toolkit-lib';
import path from 'node:path';
import fs from 'node:fs';
import { updateGithubPrDescription } from './output.js';
import { CdkExpressPipelineAssembly } from 'cdk-express-pipeline';

export async function run(): Promise<void> {
  try {
    const actionsStepDebug = process.env.ACTIONS_STEP_DEBUG === 'true';
    const runnerDebug = process.env.RUNNER_DEBUG === '1';
    const isDebug = actionsStepDebug || runnerDebug;

    if (isDebug) {
      core.info('🐛 Debug mode enabled');
      core.info(`Debug sources - ACTIONS_STEP_DEBUG: ${actionsStepDebug}, RUNNER_DEBUG: ${runnerDebug}`);
    }

    const mode = core.getInput('mode', { required: true });
    if (mode !== 'generate' && mode !== 'print') {
      core.setFailed(`Invalid mode '${mode}' specified. Valid modes are 'generate' or 'print'.`);
      return;
    }

    const cloudAssemblyDirectory = core.getInput('cloud-assembly-directory', { required: true });

    if (mode === 'generate') await generate(cloudAssemblyDirectory, isDebug);
    else if (mode === 'print') await print(cloudAssemblyDirectory);

    core.info('Successfully updated PR description with CDK Express Pipeline diff');
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

async function generate(cloudAssemblyDirectory: string, isDebug: boolean = false) {
  if (isDebug) {
    core.debug(`🔍 CDK Running in debug mode`);
    process.env.CDK_VERBOSE = 'true';
    process.env.CDK_DEBUG = 'true';
    core.debug('📝 CDK_VERBOSE and CDK_DEBUG environment variables to true');
  }

  const cdkToolkit = new Toolkit();
  const cx = await cdkToolkit.fromAssemblyDirectory(cloudAssemblyDirectory);

  const stackSelectors = core.getInput('stack-selectors', { required: false }) || '**';
  const patterns = stackSelectors
    .split(',')
    .map((s) => s.trim().replaceAll('`', ''))
    .filter((s) => s.length > 0);

  if (patterns.length === 0) {
    core.setFailed('No stack selectors provided. Please specify at least one stack selector pattern.');
    return;
  }

  core.debug(`Stack selectors: ${patterns.join(', ')}`);

  const templateDiffs = await cdkToolkit.diff(cx, {
    method: DiffMethod.ChangeSet(),
    stacks: {
      ...(patterns[0] === '**'
        ? {
            strategy: StackSelectionStrategy.ALL_STACKS
          }
        : {
            strategy: StackSelectionStrategy.PATTERN_MUST_MATCH,
            patterns: patterns
          }),
      expand: ExpandStackSelection.NONE,
      failOnEmpty: false
    }
  });

  const stackDiffs = generateDiffs(templateDiffs);
  if (!stackDiffs) {
    core.info('No changes detected in any stacks');
    return;
  }

  saveDiffs(stackDiffs, cloudAssemblyDirectory);
  core.info('Successfully generated CDK Express Pipeline diffs');
}

async function print(cloudAssemblyDirectory: string) {
  const githubToken = core.getInput('github-token', { required: true });
  let owner = core.getInput('owner');
  let repo = core.getInput('repo');
  let pullNumber = parseInt(core.getInput('pull-number'));
  let gitHash = core.getInput('git-hash');

  if (github.context.eventName === 'pull_request') {
    const pushPayload = github.context.payload as PullRequestEvent;
    if (!owner) owner = pushPayload.repository.owner.login;
    if (!repo) repo = pushPayload.repository.name;
    if (!pullNumber) pullNumber = pushPayload.pull_request.number;
    if (!gitHash) gitHash = pushPayload.pull_request.head.sha;
  }

  const allStackDiffs = getSavedDiffs(cloudAssemblyDirectory);
  core.info(`Found ${Object.keys(allStackDiffs.stacks).length} stack diffs` + JSON.stringify(allStackDiffs));
  const shortHandOrder: CdkExpressPipelineAssembly = JSON.parse(
    fs.readFileSync(path.join(cloudAssemblyDirectory, 'cdk-express-pipeline.json'), 'utf-8')
  );
  const markdown = generateMarkdown(shortHandOrder, allStackDiffs);

  await updateGithubPrDescription(owner, repo, pullNumber, githubToken, markdown, gitHash);
  core.info(markdown);
  await core.summary.addRaw(markdown).write({ overwrite: true });
}
