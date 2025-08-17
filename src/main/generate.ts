import * as core from '@actions/core';
import * as github from '@actions/github';
import { PullRequestEvent } from '@octokit/webhooks-definitions/schema.js';
import { DiffMethod, ExpandStackSelection, IoMessage, StackSelectionStrategy, Toolkit } from '@aws-cdk/toolkit-lib';
import { getNowFormated } from '../utils/output.js';
import { generateDiffs, getDiffsDir, saveDiffs } from '../utils/diff.js';
import * as cache from '@actions/cache';
import { TemplateDiff } from '@aws-cdk/cloudformation-diff';
import { getCacheKey } from './index.js';

export async function generate() {
  const cloudAssemblyDirectory = core.getInput('cloud-assembly-directory', { required: false }) || 'cdk.out';
  const githubToken = core.getInput('github-token', { required: true });
  const stackSelectors = core.getInput('stack-selectors', { required: false }) || '**';
  let gitHash: string;
  if (github.context.eventName === 'pull_request') {
    const pushPayload = github.context.payload as PullRequestEvent;
    gitHash = pushPayload.pull_request.head.sha;
  } else {
    core.setFailed('This action can only be used in a pull request context.');
    return;
  }
  const jobName = core.getInput('job-name', { required: false }) || github.context.job;
  core.info(`Using job name: ${jobName}`);
  const { cdkSummaryDiff, templateDiffs } = await diff(stackSelectors, cloudAssemblyDirectory);
  await outputSummary(githubToken, jobName, cdkSummaryDiff, gitHash);
  await generateJsonDiffsAndCache(stackSelectors, templateDiffs, cloudAssemblyDirectory);
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
async function diff(stackSelectors: string, cloudAssemblyDirectory: string) {
  let cdkSummaryDiff = '';
  const cdkToolkit = new Toolkit({
    color: true,
    ioHost: {
      notify: async function (msg) {
        printCdkIoToGitHub(msg);
        if (msg.level === 'result') {
          cdkSummaryDiff += msg.message + '\n';
        }
      },
      requestResponse: async function (msg) {
        printCdkIoToGitHub(msg);
        if (msg.level === 'result') {
          cdkSummaryDiff += msg.message + '\n';
        }
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
    throw new Error('No stack selectors provided. Please specify at least one stack selector pattern.');
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

  return {
    cdkSummaryDiff,
    templateDiffs
  };
}

async function generateJsonDiffsAndCache(
  stackSelectors: string,
  templateDiffs: { [p: string]: TemplateDiff },
  cloudAssemblyDirectory: string
) {
  const stackDiffs = generateDiffs(templateDiffs);
  if (!stackDiffs) {
    core.info('No changes detected in any stacks');
    return;
  }

  saveDiffs(stackDiffs, cloudAssemblyDirectory);
  core.info('Successfully generated CDK Express Pipeline diffs');

  const savedDir = getDiffsDir(cloudAssemblyDirectory);
  const pipelineOrderFile = `${cloudAssemblyDirectory}/cdk-express-pipeline.json`;
  const cacheKey = getCacheKey(stackSelectors);
  const savedKey = await cache.saveCache([savedDir, pipelineOrderFile], cacheKey);
  core.info(`Successfully cached CDK Express Pipeline diffs with key: ${cacheKey} and id: ${savedKey}`);
}

async function getCurrentJobUrl(token: string, jobName: string) {
  const octokit = github.getOctokit(token);

  const jobsResponse = await octokit.rest.actions.listJobsForWorkflowRun({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    run_id: github.context.runId
  });

  const currentJob = jobsResponse.data.jobs.find((job) => job.name === jobName);

  if (!currentJob) {
    throw new Error(`Could not find job with name "${github.context.job}"`);
  }

  return currentJob.id;
}

async function outputSummary(githubToken: string, jobName: string, cdkSummaryDiff: string, gitHash: string) {
  const now = getNowFormated();
  const jobId = await getCurrentJobUrl(githubToken, jobName);
  const jobRunUrl =
    `${github.context.serverUrl}/${github.context.repo.owner}/${github.context.repo.repo}/actions/runs/` +
    `${github.context.runId}/job/${jobId}`;
  const summary = ` \`\`\`${cdkSummaryDiff}\`\`\`
  
*Generated At: ${now} from commit: ${gitHash} in [action run](${jobRunUrl})*`;
  await core.summary.addRaw(summary).write({ overwrite: true });
}
