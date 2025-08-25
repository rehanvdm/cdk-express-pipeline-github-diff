import { ResourceDifference, type TemplateDiff } from '@aws-cdk/cloudformation-diff';
import * as fs from 'node:fs';
import { CdkExpressPipelineAssembly } from 'cdk-express-pipeline';

export type DiffResult = {
  stacks: Record<string, StackDiff>;
};
export type DiffSummary = {
  additions: number;
  removals: number;
  updates: number;
};
export type StackDiff = {
  summary: DiffSummary;
  markdown: string;
};

export function generateDiffs(templateDiffs: { [name: string]: TemplateDiff }, cdkDiffOutput: string) {
  if (Object.keys(templateDiffs).length === 0) {
    return undefined;
  }
  const result: DiffResult = { stacks: {} };
  for (const [stackIdName, templateDiff] of Object.entries(templateDiffs)) {
    const stackId = stackIdName.split(' ')[0];
    result.stacks[stackId] = generateStackDiff(stackIdName, templateDiff, cdkDiffOutput);
  }

  return result;
}

export function getDiffsDir(outputDir: string) {
  return `${outputDir}/cdk-express-pipeline/diffs`;
}
export function saveDiffs(diffResult: DiffResult, outputDir: string) {
  if (Object.keys(diffResult.stacks).length === 0) {
    return;
  }
  const diffsDir = getDiffsDir(outputDir);
  for (const [stackNameId, stackDiff] of Object.entries(diffResult.stacks)) {
    if (!fs.existsSync(diffsDir)) {
      fs.mkdirSync(diffsDir, { recursive: true });
    }
    const filePath = `${diffsDir}/${stackNameId}.json`;
    fs.writeFileSync(filePath, JSON.stringify(stackDiff, null, 2));
  }
}

export function getSavedDiffs(outputDir: string) {
  const combinedDiff: DiffResult = { stacks: {} };
  const diffsDir = getDiffsDir(outputDir);
  const files = fs.readdirSync(diffsDir);
  for (const file of files) {
    const stackId = file.replace('.json', '');
    const stackDiff = JSON.parse(fs.readFileSync(`${diffsDir}/${file}`, 'utf-8'));
    combinedDiff.stacks[stackId] = stackDiff;
  }
  return combinedDiff;
}

export function generateMarkdown(order: CdkExpressPipelineAssembly, diffResult: DiffResult) {
  let markdown = '```diff\n';

  for (const wave of order.waves) {
    markdown += `🌊 ${wave.waveId}\n`;
    for (const stage of wave.stages) {
      markdown += `  🏗 ${stage.stageId}\n`;
      for (const stack of stage.stacks) {
        const stackDiff = diffResult.stacks[stack.stackId];
        if (stackDiff) {
          markdown += `    📦 ${stack.stackName} (${stack.stackId})\n`;
          if (stackDiff.markdown) {
            markdown += `${stackDiff.markdown}\n`;
          }
        }
      }
    }
  }
  markdown += '```\n';

  return markdown;
}

function generateStackDiff(stackIdName: string, templateDiff: TemplateDiff, cdkDiffOutput: string): StackDiff {
  const stackDiff: StackDiff = {
    summary: {
      additions: 0,
      removals: 0,
      updates: 0
    },
    markdown: ''
  };

  // Extract the diff output for this specific stack from cdkDiffOutput
  const stackDiffOutput = extractStackDiffOutput(stackIdName, cdkDiffOutput);

  if (stackDiffOutput) {
    stackDiff.markdown = stackDiffOutput;

    // Calculate summary from the template diff
    templateDiff.resources.forEachDifference((logicalId: string, change: ResourceDifference) => {
      if (ignoreResource(change)) {
        return;
      }

      if (change.isUpdate) {
        stackDiff.summary.updates++;
        if (change.changeImpact === 'WILL_REPLACE' || change.changeImpact === 'MAY_REPLACE') {
          stackDiff.summary.removals++;
        }
      } else if (change.isAddition) {
        stackDiff.summary.additions++;
      } else if (change.isRemoval) {
        stackDiff.summary.removals++;
      }
    });
  }

  return stackDiff;
}

function extractStackDiffOutput(stackIdName: string, cdkDiffOutput: string): string {
  const lines = cdkDiffOutput.split('\n');
  const stackStartPattern = new RegExp(`^Stack ${stackIdName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

  let startIndex = -1;
  let endIndex = -1;

  // Find the start of this stack's diff output
  for (let i = 0; i < lines.length; i++) {
    if (stackStartPattern.test(lines[i])) {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) {
    return '';
  }

  // Find the end of this stack's diff output (next emoji line or end of file)
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    // Check if this line starts with an emoji (simplified pattern)
    if (/^[^\s]*[✨🌊🏗📦]/u.test(line)) {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    endIndex = lines.length;
  }

  // Extract the lines between start and end, excluding the stack header line
  const diffLines = lines.slice(startIndex + 1, endIndex);

  // Find the "Resources" line and extract everything from there
  let resourcesStartIndex = -1;
  for (let i = 0; i < diffLines.length; i++) {
    if (diffLines[i].trim() === 'Resources') {
      resourcesStartIndex = i;
      break;
    }
  }

  if (resourcesStartIndex === -1) {
    return '';
  }

  // Extract from "Resources" line onwards, but stop before the next emoji line
  const resourcesLines = diffLines.slice(resourcesStartIndex);
  const resultLines: string[] = [];

  for (const line of resourcesLines) {
    // Stop if we encounter an emoji line (indicating next stack or section)
    if (/^[^\s]*[✨🌊🏗📦]/u.test(line)) {
      break;
    }
    resultLines.push(line);
  }

  return resultLines.join('\n').trim();
}

function ignoreResource(change: ResourceDifference): boolean {
  const resourceType = change.oldValue?.Type ?? change.newValue?.Type;
  switch (resourceType) {
    case 'AWS::CDK::Metadata':
      return true;
  }
  return false;
}
