import { ResourceDifference, type TemplateDiff } from '@aws-cdk/cloudformation-diff';
import * as fs from 'node:fs';
import { CdkExpressPipelineAssembly } from 'cdk-express-pipeline';

export type DiffOptions = {
  /**
   * The stack selectors to use for the diff operation.
   */
  stackSelectors: string[];
};
export type DiffResult = {
  stacks: Record<string, StackDiff>;
};
export type StackDiff = {
  summary: {
    additions: number;
    removals: number;
    updates: number;
  };
  markdown: string;
};

export function generateDiffs(templateDiffs: { [name: string]: TemplateDiff }): DiffResult | undefined {
  if (Object.keys(templateDiffs).length === 0) {
    return undefined;
  }
  const result: DiffResult = { stacks: {} };
  for (const [name, templateDiff] of Object.entries(templateDiffs)) {
    result.stacks[name] = generateStackDiff(templateDiff);
  }

  return result;
}

export function saveDiffs(diffResult: DiffResult, outputDir: string): void {
  if (Object.keys(diffResult.stacks).length === 0) {
    return;
  }
  for (const [stackNameId, stackDiff] of Object.entries(diffResult.stacks)) {
    if (!fs.existsSync(`${outputDir}/cdk-express-pipeline/diffs`)) {
      fs.mkdirSync(`${outputDir}/cdk-express-pipeline/diffs`, { recursive: true });
    }
    const filePath = `${outputDir}/cdk-express-pipeline/diffs/${stackNameId}.json`;
    fs.writeFileSync(filePath, JSON.stringify(stackDiff, null, 2));
  }
}

export function getSavedDiffs(outputDir: string) {
  const combinedDiff: DiffResult = { stacks: {} };
  const files = fs.readdirSync(`${outputDir}/cdk-express-pipeline/diffs`);
  for (const file of files) {
    const stackId = file.replace('.json', '');
    const stackDiff = JSON.parse(fs.readFileSync(`${outputDir}/cdk-express-pipeline/diffs/${file}`, 'utf-8'));
    combinedDiff.stacks[stackId] = stackDiff;
  }
  return combinedDiff;
}

export function generateMarkdown(order: CdkExpressPipelineAssembly, diffResult: DiffResult) {
  let markdown = '```diff\n';

  order.waves.forEach((wave) => {
    markdown += `🌊 ${wave.waveId}\n`;
    wave.stages.forEach((stage) => {
      markdown += `  🏗 ${stage.stageId}\n`;
      stage.stacks.forEach((stack) => {
        const stackDiff = diffResult.stacks[stack.stackId]; // + ' (' + stack.stackName + ')'
        if (stackDiff) {
          markdown += `    📦 ${stack.stackName} (${stack.stackId})\n`;
          if (stackDiff.markdown) {
            markdown += `${stackDiff.markdown}\n`;
          }
        }
      });
    });
  });
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
      const replacementIndicator = change.changeImpact === 'WILL_REPLACE' ? ' [💥 REPLACEMENT]' : '';
      changes.push(
        `!       [~] ${change.oldValue?.Type || change.newValue?.Type} ${logicalId} ${logicalId}${replacementIndicator}`
      );

      Object.entries(change.propertyUpdates).forEach(([propertyPath, propertyChange]) => {
        if (propertyChange.isAddition) {
          changes.push(`!         └─ [+] ${propertyPath}`);
          changes.push(`!             └─ [+] ${JSON.stringify(propertyChange.newValue)}`);
        } else if (propertyChange.isRemoval) {
          changes.push(`!         └─ [-] ${propertyPath}`);
          changes.push(`!             └─ [-] ${JSON.stringify(propertyChange.oldValue)}`);
        } else if (propertyChange.isUpdate) {
          changes.push(`!         └─ [~] ${propertyPath}`);
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

//TODO: Let pass in more later
function ignoreResource(change: ResourceDifference): boolean {
  const resourceType = change.oldValue?.Type ?? change.newValue?.Type;
  switch (resourceType) {
    case 'AWS::CDK::Metadata':
      return true;
    case 'AWS::Lambda::Function': {
      const keys = Object.keys(change.propertyUpdates);
      if ((keys.length <= 2 && keys.includes('Code')) || keys.includes('Metadata')) {
        return true;
      }
    }
  }
  return false;
}
