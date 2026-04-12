import * as core from '@actions/core';
import * as github from '@actions/github';
import { DiffMethod, ExpandStackSelection, IoMessage, StackSelectionStrategy, Toolkit } from '@aws-cdk/toolkit-lib';
import { getNowFormated, setGeneratingPrDescription } from '../utils/output.js';
import { DiffRule, generateDiffs, getDiffsDir, saveDiffs } from '../utils/diff.js';
import * as cache from '@actions/cache';
import { TemplateDiff } from '@aws-cdk/cloudformation-diff';
import { CDK_EXPRESS_PIPELINE_JSON_FILE, getCacheKey, parseDisplayTimezones } from '../utils/shared.js';
import * as jsYaml from 'js-yaml';
import { PrContext } from './index.js';

export async function generate(prContext: PrContext) {
  const cloudAssemblyDirectory = core.getInput('cloud-assembly-directory', { required: false }) || 'cdk.out';
  const stackSelectors = core.getInput('stack-selectors', { required: false }) || '**';

  const diffRulesProp = core.getInput('diff-rules', { required: false }) || '[]';
  const diffRulesParsed = jsYaml.load(diffRulesProp);
  if (!Array.isArray(diffRulesParsed)) {
    throw new Error('The "diff-rules" input must be a YAML array.');
  }

  const displayTimezones = parseDisplayTimezones(core.getInput('display-timezones', { required: false }));

  const diffRules: DiffRule[] = [];
  for (const rule of diffRulesParsed) {
    if (typeof rule !== 'object' || !rule.name || !rule.type || !rule.path) {
      throw new Error('Each item in "diff-rules" must have "name", "type" and "path" properties.');
    }
    diffRules.push({
      name: rule.name,
      type: rule.type,
      path: rule.path
    });
  }

  const { owner, repo, pullNumber, gitHash, githubToken } = prContext;
  const jobName = core.getInput('job-name', { required: false }) || github.context.job;
  await setGeneratingPrDescription(owner, repo, pullNumber, githubToken, gitHash, displayTimezones);
  const { cdkSummaryDiff, templateDiffs } = await diff(stackSelectors, cloudAssemblyDirectory);
  await outputSummary(githubToken, jobName, cdkSummaryDiff, gitHash, displayTimezones);
  await generateJsonDiffsAndCache(stackSelectors, templateDiffs, cloudAssemblyDirectory, cdkSummaryDiff, diffRules);
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
    color: false,
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
  cloudAssemblyDirectory: string,
  cdkSummaryDiff: string,
  diffRules: DiffRule[]
) {
  const stackDiffs = generateDiffs(templateDiffs, cdkSummaryDiff, diffRules);
  if (!stackDiffs) {
    core.info('No changes detected in any stacks');
    return;
  }

  saveDiffs(stackDiffs, cloudAssemblyDirectory);
  core.info('Successfully generated CDK Express Pipeline diffs');

  const savedDir = getDiffsDir(cloudAssemblyDirectory);
  const pipelineOrderFile = `${cloudAssemblyDirectory}/${CDK_EXPRESS_PIPELINE_JSON_FILE}`;
  const cacheKey = getCacheKey(cloudAssemblyDirectory, stackSelectors);
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
    core.info(
      `Job not found in the current workflow run, specify the 'job-name' input parameter to enhance the summary output`
    );
  }

  return currentJob?.id;
}

async function outputSummary(
  githubToken: string,
  jobName: string,
  cdkSummaryDiff: string,
  gitHash: string,
  timezones?: string[]
) {
  const now = getNowFormated(timezones);
  let jobText = '';
  const jobId = await getCurrentJobUrl(githubToken, jobName);
  if (jobId) {
    const jobRunUrl =
      `${github.context.serverUrl}/${github.context.repo.owner}/${github.context.repo.repo}/actions/runs/` +
      `${github.context.runId}/job/${jobId}`;
    jobText = ` , see [job log](${jobRunUrl})`;
  }

  const summary = '```\n' + cdkSummaryDiff + '\n```\n' + `*Generated At: ${now} from commit: ${gitHash}${jobText}*`;
  await core.summary.addRaw(summary).write({ overwrite: true });
}
