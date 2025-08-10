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
    const mode = core.getInput('mode', { required: true });
    if (mode !== 'generate' && mode !== 'print') {
      core.setFailed(`Invalid mode '${mode}' specified. Valid modes are 'generate' or 'print'.`);
      return;
    }

    const cloudAssemblyDirectory = core.getInput('cloud-assembly-directory', { required: true });

    if (mode === 'generate') await generate(cloudAssemblyDirectory);
    else if (mode === 'print') await print(cloudAssemblyDirectory);

    // // Check if cloud assembly directory exists
    // if (!fs.existsSync(cloudAssemblyDirectory)) {
    //   core.setFailed(`Cloud assembly directory '${cloudAssemblyDirectory}' does not exist`);
    //   return;
    // }
    //
    //   // Load the CDK Express Pipeline Assembly
    //   const assembly = new CdkExpressPipelineAssembly(cloudAssemblyDirectory);
    //
    //   // Generate diffs for all stacks
    //   const templateDiffs = assembly.templateDiffs;
    //   const diffResult = generateDiffs(templateDiffs);
    //
    //   if (!diffResult) {
    //     core.info('No changes detected in any stacks');
    //     return;
    //   }
    //
    //   // Save diffs to filesystem
    //   saveDiffs(diffResult, process.cwd());
    //
    //   // Generate markdown from the diffs
    //   const markdown = generateMarkdown(assembly, diffResult);
    //
    //   // Update the GitHub PR description
    //   await updateGithubPrDescription(markdown);

    core.info('Successfully updated PR description with CDK Express Pipeline diff');
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

async function generate(cloudAssemblyDirectory: string) {
  const cdkToolkit = new Toolkit();
  const cx = await cdkToolkit.fromAssemblyDirectory(cloudAssemblyDirectory);

  const stackSelectors = core.getInput('stack-selectors', { required: true });
  const patterns = stackSelectors
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const templateDiffs = await cdkToolkit.diff(cx, {
    method: DiffMethod.ChangeSet(),
    stacks: {
      strategy: StackSelectionStrategy.PATTERN_MUST_MATCH,
      patterns: patterns,
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
  const shortHandOrder: CdkExpressPipelineAssembly = JSON.parse(
    fs.readFileSync(path.join(cloudAssemblyDirectory, 'cdk-express-pipeline.json'), 'utf-8')
  );
  const markdown = generateMarkdown(shortHandOrder, allStackDiffs);

  const result = await updateGithubPrDescription(owner, repo, pullNumber, githubToken, markdown, gitHash);
  core.info(result);
  await core.summary.addRaw(result).write({ overwrite: true });
}
