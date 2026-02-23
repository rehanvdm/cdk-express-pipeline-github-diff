import * as core from '@actions/core';
import { DiffSummary, generateMarkdown, getDiffsDir, getSavedDiffs } from '../utils/diff.js';
import * as cache from '@actions/cache';
import { CdkExpressPipelineAssembly } from 'cdk-express-pipeline';
import fs from 'node:fs';
import path from 'node:path';
import { AssemblyDiff, updateGithubPrDescription } from '../utils/output.js';
import { CDK_EXPRESS_PIPELINE_JSON_FILE, getCacheKey } from '../utils/shared.js';
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
      const maxAttempts = 10;
      const retryDelayMs = 2000;
      let restoredKey: string | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        restoredKey = await cache.restoreCache([savedDir, pipelineOrderFile], c.key!);
        if (restoredKey) break;

        if (attempt < maxAttempts) {
          core.info(
            `Attempt ${attempt}/${maxAttempts}: Cache not yet available for key: ${c.key!}. Retrying in ${retryDelayMs / 1000}s...`
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }

      if (restoredKey) {
        core.info(
          `Successfully restored CDK Express Pipeline diffs from cache with key: ${c.key!} and id: ${restoredKey}`
        );
      } else {
        core.info(`No cached CDK Express Pipeline diffs found with key: ${c.key!} after ${maxAttempts} attempts`);
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
