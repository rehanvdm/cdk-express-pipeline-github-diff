import * as core from '@actions/core';
import { DiffSummary, generateMarkdown, getDiffsDir, getSavedDiffs } from '../utils/diff.js';
import * as cache from '@actions/cache';
import { CdkExpressPipelineAssembly } from 'cdk-express-pipeline';
import fs from 'node:fs';
import path from 'node:path';
import { AssemblyDiff, updateGithubPrDescription } from '../utils/output.js';
import { CDK_EXPRESS_PIPELINE_JSON_FILE, getCacheKey, parseDisplayTimezones } from '../utils/shared.js';
import * as jsYaml from 'js-yaml';
import * as github from '@actions/github';
import { PrContext } from './index.js';

type PrintAssemblyDiff = {
  header: string;
  directory: string;
};

export async function print(prContext: PrContext) {
  const assemblyDiffs: PrintAssemblyDiff[] = [];
  const cloudAssemblyDirectory = core.getInput('cloud-assembly-directory', { required: false });
  const cloudAssemblies = core.getInput('cloud-assemblies', { required: false });
  const expandDiffInput = core.getInput('expand-diff', { required: false });
  const expandDetails = expandDiffInput === '' || expandDiffInput.toLowerCase() !== 'false';

  if (cloudAssemblyDirectory) {
    assemblyDiffs.push({
      header: 'CDK Diff',
      directory: cloudAssemblyDirectory
    });
  } else if (cloudAssemblies) {
    const cloudAssembliesParsed = jsYaml.load(cloudAssemblies);
    if (!Array.isArray(cloudAssembliesParsed)) {
      throw new Error('The "cloud-assemblies" input must be a YAML array.');
    }
    for (const assembly of cloudAssembliesParsed) {
      if (typeof assembly !== 'object' || !assembly.header || !assembly.directory) {
        throw new Error('Each item in "cloud-assemblies" must have "header" and "directory" properties.');
      }
      if (assemblyDiffs.find((a) => a.directory === assembly.directory)) {
        throw new Error(`The directory "${assembly.directory}" can only be specified once in "cloud-assemblies".`);
      }
      assemblyDiffs.push({
        header: assembly.header,
        directory: assembly.directory
      });
    }
  } else {
    assemblyDiffs.push({
      header: 'CDK Diff',
      directory: 'cdk.out'
    });
  }

  const { owner, repo, pullNumber, gitHash, githubToken } = prContext;

  const displayTimezones = parseDisplayTimezones(core.getInput('display-timezones', { required: false }));

  await restoreCaches(githubToken, assemblyDiffs, pullNumber);
  await commentOnPr(githubToken, assemblyDiffs, owner, repo, pullNumber, gitHash, displayTimezones, expandDetails);
}

async function listCachesWithPrefix(token: string, prefix: string, pullNumber: number) {
  const octokit = github.getOctokit(token);
  const ref = `refs/pull/${pullNumber}/merge`;
  const perPage = 100;
  let page = 1;
  const allCaches: Awaited<ReturnType<typeof octokit.rest.actions.getActionsCacheList>>['data']['actions_caches'] = [];

  // Fetch the current workflow run's start time, caches created before this run
  // cannot have been saved by the generate step, so stop paginating when we hit one.
  const runId = parseInt(process.env.GITHUB_RUN_ID ?? '0', 10);
  const { data: runData } = await octokit.rest.actions.getWorkflowRun({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    run_id: runId
  });
  const workflowStartedAt = new Date(runData.run_started_at ?? 0);
  core.debug(`Current workflow run started at: ${workflowStartedAt}.`);

  while (true) {
    const response = await octokit.rest.actions.getActionsCacheList({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      ref,
      per_page: perPage,
      page
    });

    const pageCaches = response.data.actions_caches;

    let reachedOldCache = false;
    for (const c of pageCaches) {
      if (c.created_at && new Date(c.created_at) < workflowStartedAt) {
        reachedOldCache = true;
        core.debug(
          `Reached cache created at ${c.created_at}, which is before the current workflow run started at ${workflowStartedAt}. Stopping pagination.`
        );
        break;
      }
      if (c.key!.startsWith(prefix)) allCaches.push(c);
    }

    if (reachedOldCache || pageCaches.length < perPage) break;
    page++;
  }

  return allCaches;
}

async function restoreCaches(githubToken: string, assemblyDiffs: PrintAssemblyDiff[], pullNumber: number) {
  for (const assemblyDiff of assemblyDiffs) {
    const savedDir = getDiffsDir(assemblyDiff.directory);
    const pipelineOrderFile = `${assemblyDiff.directory}/${CDK_EXPRESS_PIPELINE_JSON_FILE}`;
    const cacheKeyPrefix = getCacheKey(assemblyDiff.directory);
    const caches = await listCachesWithPrefix(githubToken, cacheKeyPrefix, pullNumber);
    core.info(
      `Found ${caches.length} caches with prefix: ${cacheKeyPrefix} for assembly directory: ${assemblyDiff.directory}`
    );
    if (caches.length === 0) {
      continue;
    }
    for (const c of caches) {
      const restoredKey = await cache.restoreCache([savedDir, pipelineOrderFile], c.key!);
      if (restoredKey) {
        core.info(
          `Successfully restored CDK Express Pipeline diffs from cache with key: ${c.key!} and id: ${restoredKey}`
        );
      } else {
        core.info(`No cached CDK Express Pipeline diffs found with key: ${c.key!}`);
      }
    }
  }
}

async function commentOnPr(
  githubToken: string,
  assemblyDiffs: PrintAssemblyDiff[],
  owner: string,
  repo: string,
  pullNumber: number,
  gitHash: string,
  timezones?: string[],
  expandDetails: boolean
) {
  const diffs: AssemblyDiff[] = [];
  for (const assemblyDiff of assemblyDiffs) {
    const allStackDiffs = getSavedDiffs(assemblyDiff.directory);
    core.debug(`Found ${Object.keys(allStackDiffs.stacks).length} stack diffs` + JSON.stringify(allStackDiffs));

    const shortHandOrder: CdkExpressPipelineAssembly = JSON.parse(
      fs.readFileSync(path.join(assemblyDiff.directory, CDK_EXPRESS_PIPELINE_JSON_FILE), 'utf-8')
    );
    const markdown = generateMarkdown(shortHandOrder, allStackDiffs);

    const summary: DiffSummary = {
      additions: 0,
      removals: 0,
      updates: 0
    };
    for (const stack of Object.values(allStackDiffs.stacks)) {
      summary.additions += stack.summary.additions;
      summary.removals += stack.summary.removals;
      summary.updates += stack.summary.updates;
    }

    diffs.push({
      header: assemblyDiff.header,
      markdown,
      summary
    });

    core.info(``);
    core.info(``);
    core.info(`Found diffs for ${assemblyDiff.directory} (${assemblyDiff.header})`);
    core.info(`Summary:`);
    core.info(`  Additions: ${summary.additions}`);
    core.info(`  Removals: ${summary.removals}`);
    core.info(`  Updates: ${summary.updates}`);
    core.info(``);
    core.info(markdown);
  }

  await updateGithubPrDescription(owner, repo, pullNumber, githubToken, diffs, gitHash, timezones, expandDetails);
}
