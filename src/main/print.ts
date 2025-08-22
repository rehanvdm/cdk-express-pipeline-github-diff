import * as core from '@actions/core';
import * as github from '@actions/github';
import { PullRequestEvent } from '@octokit/webhooks-definitions/schema.js';
import { DiffSummary, generateMarkdown, getDiffsDir, getSavedDiffs } from '../utils/diff.js';
import * as cache from '@actions/cache';
import { CdkExpressPipelineAssembly } from 'cdk-express-pipeline';
import fs from 'node:fs';
import path from 'node:path';
import { AssemblyDiff, updateGithubPrDescription } from '../utils/output.js';
import { CDK_EXPRESS_PIPELINE_JSON_FILE, getCacheKey } from '../utils/shared.js';
import * as jsYaml from 'js-yaml';

type PrintAssemblyDiff = {
  header: string;
  directory: string;
};

export async function print() {
  const assemblyDiffs: PrintAssemblyDiff[] = [];
  const cloudAssemblyDirectory = core.getInput('cloud-assembly-directory', { required: false });
  const cloudAssemblies = core.getInput('cloud-assemblies', { required: false });

  if (cloudAssemblyDirectory) {
    assemblyDiffs.push({
      header: 'CDK Diff',
      directory: cloudAssemblyDirectory
    });
  } else if (cloudAssemblies) {
    const cloudAssembliesParsed = jsYaml.load(cloudAssemblies);
    if (!Array.isArray(cloudAssembliesParsed)) {
      core.setFailed('The "cloud-assemblies" input must be a YAML array.');
      return;
    }
    for (const assembly of cloudAssembliesParsed) {
      if (typeof assembly !== 'object' || !assembly.header || !assembly.directory) {
        core.setFailed('Each item in "cloud-assemblies" must have "header" and "directory" properties.');
        return;
      }
      if (assemblyDiffs.find((a) => a.directory === assembly.directory)) {
        core.setFailed(`The directory "${assembly.directory}" can only be specified once in "cloud-assemblies".`);
        continue;
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

  const githubToken = core.getInput('github-token', { required: true });
  let owner: string;
  let repo: string;
  let pullNumber: number;
  let gitHash: string;
  if (github.context.eventName === 'pull_request') {
    const pushPayload = github.context.payload as PullRequestEvent;
    owner = pushPayload.repository.owner.login;
    repo = pushPayload.repository.name;
    pullNumber = pushPayload.pull_request.number;
    gitHash = pushPayload.pull_request.head.sha;
  } else {
    core.setFailed('This action can only be used in a pull request context.');
    return;
  }

  await restoreCaches(githubToken, assemblyDiffs);
  await commentOnPr(githubToken, assemblyDiffs, owner, repo, pullNumber, gitHash);
}

async function listCachesWithPrefix(token: string, prefix: string) {
  const octokit = github.getOctokit(token);

  const caches = await octokit.rest.actions.getActionsCacheList({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo
  });

  return caches.data.actions_caches.filter((cache) => cache.key!.startsWith(prefix));
}

async function restoreCaches(githubToken: string, assemblyDiffs: PrintAssemblyDiff[]) {
  for (const assemblyDiff of assemblyDiffs) {
    const savedDir = getDiffsDir(assemblyDiff.directory);
    const pipelineOrderFile = `${assemblyDiff.directory}/${CDK_EXPRESS_PIPELINE_JSON_FILE}`;
    const cacheKeyPrefix = getCacheKey();
    const caches = await listCachesWithPrefix(githubToken, cacheKeyPrefix);
    if (caches.length === 0) {
      core.info(`No caches found with prefix: ${cacheKeyPrefix}`);
      return;
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
  gitHash: string
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

  await updateGithubPrDescription(owner, repo, pullNumber, githubToken, diffs, gitHash);
}
