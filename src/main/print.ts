import * as core from '@actions/core';
import * as github from '@actions/github';
import { PullRequestEvent } from '@octokit/webhooks-definitions/schema.js';
import { generateMarkdown, getDiffsDir, getSavedDiffs } from '../utils/diff.js';
import * as cache from '@actions/cache';
import { CdkExpressPipelineAssembly } from 'cdk-express-pipeline';
import fs from 'node:fs';
import path from 'node:path';
import { updateGithubPrDescription } from '../utils/output.js';
import { getCacheKey } from './index.js';

export async function print() {
  const cloudAssemblyDirectory = core.getInput('cloud-assembly-directory', { required: true });
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

  await restoreCaches(githubToken, cloudAssemblyDirectory);
  await commentOnPr(githubToken, cloudAssemblyDirectory, owner, repo, pullNumber, gitHash);
}

async function listCachesWithPrefix(token: string, prefix: string) {
  const octokit = github.getOctokit(token);

  const caches = await octokit.rest.actions.getActionsCacheList({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo
  });

  return caches.data.actions_caches.filter((cache) => cache.key!.startsWith(prefix));
}
async function restoreCaches(githubToken: string, cloudAssemblyDirectory: string) {
  const savedDir = getDiffsDir(cloudAssemblyDirectory);
  const pipelineOrderFile = `${cloudAssemblyDirectory}/cdk-express-pipeline.json`;
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

async function commentOnPr(
  githubToken: string,
  cloudAssemblyDirectory: string,
  owner: string,
  repo: string,
  pullNumber: number,
  gitHash: string
) {
  const allStackDiffs = getSavedDiffs(cloudAssemblyDirectory);
  core.debug(`Found ${Object.keys(allStackDiffs.stacks).length} stack diffs` + JSON.stringify(allStackDiffs));

  const shortHandOrder: CdkExpressPipelineAssembly = JSON.parse(
    fs.readFileSync(path.join(cloudAssemblyDirectory, 'cdk-express-pipeline.json'), 'utf-8')
  );
  const markdown = generateMarkdown(shortHandOrder, allStackDiffs);

  await updateGithubPrDescription(owner, repo, pullNumber, githubToken, markdown, gitHash);
  core.info(markdown);
}
