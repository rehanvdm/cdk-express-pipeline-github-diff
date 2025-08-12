import * as core from '@actions/core';
import * as github from '@actions/github';
//@ts-expect-error TS/JS import issue but works
import { PullRequestEvent } from '@octokit/webhooks-definitions/schema';
import { generateDiffs, generateMarkdown, getDiffsDir, getSavedDiffs, saveDiffs } from './diff.js';
import { DiffMethod, ExpandStackSelection, IoMessage, StackSelectionStrategy, Toolkit } from '@aws-cdk/toolkit-lib';
import path from 'node:path';
import fs from 'node:fs';
import { getNowFormated, updateGithubPrDescription } from './output.js';
import { CdkExpressPipelineAssembly } from 'cdk-express-pipeline';
import * as cache from '@actions/cache';
import { createHash } from 'crypto';

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

    const cloudAssemblyDirectory = core.getInput('cloud-assembly-directory', { required: true });

    if (mode === 'generate') await generate(cloudAssemblyDirectory, isDebug);
    else if (mode === 'print') await print(cloudAssemblyDirectory);

    core.info('Successfully updated PR description with CDK Express Pipeline diff');
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

function getCacheKey(stackSelector?: string): string {
  let ret = `cdk-diff-pipeline-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-`;
  if (stackSelector) {
    ret += createHash('md5').update(stackSelector).digest('hex');
  }
  return ret;
}
function printCdkIoToGitHub(msg: IoMessage<unknown>): void {
  switch (msg.level) {
    case 'info':
    case 'result':
      core.info(msg.message);
      break;
    case 'warn':
      core.warning(msg.message);
      break;
    case 'error':
      core.error(msg.message);
      break;
    case 'debug':
    case 'trace':
      core.debug(msg.message);
      break;
  }
}
async function generate(cloudAssemblyDirectory: string, isDebug: boolean = false) {
  if (isDebug) {
    core.debug(`🔍 CDK Running in debug mode`);
  }

  const stackSelectors = core.getInput('stack-selectors', { required: false }) || '**';
  let gitHash = core.getInput('git-hash');
  if (github.context.eventName === 'pull_request') {
    const pushPayload = github.context.payload as PullRequestEvent;
    if (!gitHash) gitHash = pushPayload.pull_request.head.sha;
  }

  let cdkConsole = '';
  const cdkToolkit = new Toolkit({
    color: true,
    ioHost: {
      notify: async function (msg) {
        printCdkIoToGitHub(msg);
        cdkConsole += msg.message + '\n';
      },
      requestResponse: async function (msg) {
        printCdkIoToGitHub(msg);
        return msg.defaultResponse;
      }
    }
  });
  const cx = await cdkToolkit.fromAssemblyDirectory(cloudAssemblyDirectory);

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

  // Output summary on Actions page
  const now = getNowFormated();
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const summary = ` ${cdkConsole}
  
*Generated At: ${now} from commit: ${gitHash} in [action run](${runUrl})*`;
  await core.summary.addRaw(summary).write({ overwrite: true });

  const stackDiffs = generateDiffs(templateDiffs);
  if (!stackDiffs) {
    core.info('No changes detected in any stacks');
    return;
  }

  saveDiffs(stackDiffs, cloudAssemblyDirectory);
  core.info('Successfully generated CDK Express Pipeline diffs');

  const savedDir = getDiffsDir(cloudAssemblyDirectory);
  const cacheKey = getCacheKey(stackSelectors);
  const savedKey = await cache.saveCache([savedDir], cacheKey);
  core.info(`Successfully cached CDK Express Pipeline diffs with key: ${savedKey}`);
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

  const savedDir = getDiffsDir(cloudAssemblyDirectory);
  const cacheKey = getCacheKey();
  const restoredKey = await cache.restoreCache([savedDir], cacheKey);
  if (restoredKey) {
    core.info(`Successfully restored CDK Express Pipeline diffs from cache with key: ${restoredKey}`);
  } else {
    core.info(`No cached CDK Express Pipeline diffs found with key: + ${cacheKey}`);
  }

  const allStackDiffs = getSavedDiffs(cloudAssemblyDirectory);
  core.info(`Found ${Object.keys(allStackDiffs.stacks).length} stack diffs` + JSON.stringify(allStackDiffs));
  const shortHandOrder: CdkExpressPipelineAssembly = JSON.parse(
    fs.readFileSync(path.join(cloudAssemblyDirectory, 'cdk-express-pipeline.json'), 'utf-8')
  );
  const markdown = generateMarkdown(shortHandOrder, allStackDiffs);

  await updateGithubPrDescription(owner, repo, pullNumber, githubToken, markdown, gitHash);
  core.info(markdown);
}

// async function ghCahceSave() {
//
// }
