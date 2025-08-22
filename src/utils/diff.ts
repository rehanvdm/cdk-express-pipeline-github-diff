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

export function generateDiffs(templateDiffs: { [name: string]: TemplateDiff }) {
  if (Object.keys(templateDiffs).length === 0) {
    return undefined;
  }
  const result: DiffResult = { stacks: {} };
  for (const [stackIdName, templateDiff] of Object.entries(templateDiffs)) {
    const stackId = stackIdName.split(' ')[0];
    result.stacks[stackId] = generateStackDiff(templateDiff);
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

function generateStackDiff(templateDiff: TemplateDiff): StackDiff {
  const stackDiff: StackDiff = {
    summary: {
      additions: 0,
      removals: 0,
      updates: 0
    },
    markdown: ''
  };
  const changes: string[] = [];

  templateDiff.resources.forEachDifference((logicalId: string, change: ResourceDifference) => {
    if (ignoreResource(change)) {
      return;
    }

    if (change.isUpdate) {
      stackDiff.summary.updates++;

      let indicator = '!';
      let replacementIndicator = '';
      if (change.changeImpact === 'WILL_REPLACE') {
        indicator = '-';
        replacementIndicator = ' (requires replacement)';
        stackDiff.summary.removals++;
      } else if (change.changeImpact === 'MAY_REPLACE') {
        indicator = '-';
        replacementIndicator = ' (may require replacement)';
        stackDiff.summary.removals++;
      }

      changes.push(
        `${indicator}       [~] ${change.oldValue?.Type || change.newValue?.Type} ${logicalId} ${logicalId}${replacementIndicator}`
      );

      Object.entries(change.propertyUpdates).forEach(([propertyPath, propertyChange]) => {
        if (propertyChange.isAddition) {
          changes.push(`!         └─ [+] ${propertyPath}`);
          changes.push(`!             └─ [+] ${JSON.stringify(propertyChange.newValue)}`);
        } else if (propertyChange.isRemoval) {
          changes.push(`!         └─ [-] ${propertyPath}`);
          changes.push(`!             └─ [-] ${JSON.stringify(propertyChange.oldValue)}`);
        } else if (propertyChange.isUpdate) {
          let propertyIndicator = '!';
          let propertyReplacementIndicator = '';
          if (propertyChange.changeImpact === 'WILL_REPLACE') {
            propertyIndicator = '-';
            propertyReplacementIndicator = ' (requires replacement)';
          } else if (propertyChange.changeImpact === 'MAY_REPLACE') {
            propertyIndicator = '-';
            propertyReplacementIndicator = ' (may require replacement)';
          }

          changes.push(`${propertyIndicator}         └─ [~] ${propertyPath}${propertyReplacementIndicator}`);
          changes.push(`!             ├─ [-] ${JSON.stringify(propertyChange.oldValue)}`);
          changes.push(`!             └─ [+] ${JSON.stringify(propertyChange.newValue)}`);
        }
      });
    } else if (change.isAddition) {
      stackDiff.summary.additions++;
      changes.push(`+       [+] ${change.newValue?.Type} ${logicalId} ${logicalId}`);
    } else if (change.isRemoval) {
      stackDiff.summary.removals++;
      changes.push(`-       [-] ${change.oldValue?.Type} ${logicalId} ${logicalId}`);
    }
  });

  if (changes.length > 0) {
    stackDiff.markdown = changes.join('\n');
  }
  return stackDiff;
}

function ignoreResource(change: ResourceDifference): boolean {
  const resourceType = change.oldValue?.Type ?? change.newValue?.Type;
  switch (resourceType) {
    case 'AWS::CDK::Metadata':
      return true;
  }
  return false;
}
