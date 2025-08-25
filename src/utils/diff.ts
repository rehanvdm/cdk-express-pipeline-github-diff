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

      const propertyEntries = Object.entries(change.propertyUpdates);
      propertyEntries.forEach(([propertyPath, propertyChange], index) => {
        const isLastProperty = index === propertyEntries.length - 1;

        if (propertyChange.isAddition) {
          changes.push(`!         ${isLastProperty ? '└' : '├'}─ [+] ${propertyPath}`);
          changes.push(`!         ${isLastProperty ? ' ' : '│'}   └─ [+] ${JSON.stringify(propertyChange.newValue)}`);
        } else if (propertyChange.isRemoval) {
          changes.push(`!         ${isLastProperty ? '└' : '├'}─ [-] ${propertyPath}`);
          changes.push(`!         ${isLastProperty ? ' ' : '│'}   └─ [-] ${JSON.stringify(propertyChange.oldValue)}`);
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

          changes.push(
            `${propertyIndicator}         ${isLastProperty ? '└' : '├'}─ [~] ${propertyPath}${propertyReplacementIndicator}`
          );

          // Check if both values are objects for deep diff
          if (
            propertyChange.oldValue &&
            propertyChange.newValue &&
            typeof propertyChange.oldValue === 'object' &&
            typeof propertyChange.newValue === 'object'
          ) {
            // Do deep diff
            const deepChanges = deepDiff(
              propertyChange.oldValue,
              propertyChange.newValue,
              propertyPath,
              `!         ${isLastProperty ? ' ' : '│'}   `,
              isLastProperty
            );
            if (deepChanges.length > 0) {
              changes.push(...deepChanges);
            } else {
              // Fallback to simple diff if no deep changes found
              changes.push(
                `!         ${isLastProperty ? ' ' : '│'}   ├─ [-] ${JSON.stringify(propertyChange.oldValue)}`
              );
              changes.push(
                `!         ${isLastProperty ? ' ' : '│'}   └─ [+] ${JSON.stringify(propertyChange.newValue)}`
              );
            }
          } else {
            // Simple diff for non-objects
            changes.push(`!         ${isLastProperty ? ' ' : '│'}   ├─ [-] ${JSON.stringify(propertyChange.oldValue)}`);
            changes.push(`!         ${isLastProperty ? ' ' : '│'}   └─ [+] ${JSON.stringify(propertyChange.newValue)}`);
          }
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

function deepDiff(
  oldValue: any,
  newValue: any,
  path: string = '',
  baseIndent: string = '',
  isLast: boolean = true
): string[] {
  const changes: string[] = [];

  // If both values are objects and not null/undefined, do deep comparison
  if (
    oldValue &&
    newValue &&
    typeof oldValue === 'object' &&
    typeof newValue === 'object' &&
    !Array.isArray(oldValue) &&
    !Array.isArray(newValue)
  ) {
    const allKeys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
    const changedKeys = Array.from(allKeys).filter((key) => oldValue[key] !== newValue[key]);
    let hasChanges = false;

    changedKeys.forEach((key, index) => {
      const oldProp = oldValue[key];
      const newProp = newValue[key];
      const isLastKey = index === changedKeys.length - 1;

      if (oldProp !== newProp) {
        if (
          oldProp &&
          newProp &&
          typeof oldProp === 'object' &&
          typeof newProp === 'object' &&
          !Array.isArray(oldProp) &&
          !Array.isArray(newProp)
        ) {
          // Recursively diff nested objects
          changes.push(`${baseIndent}${isLastKey ? '└' : '├'}─ [~] ${key}`);
          const nestedChanges = deepDiff(oldProp, newProp, key, `${baseIndent}${isLastKey ? ' ' : '│'}   `, true);
          if (nestedChanges.length > 0) {
            changes.push(...nestedChanges);
            hasChanges = true;
          }
        } else if (oldProp === undefined && newProp !== undefined) {
          // Property was added
          changes.push(`${baseIndent}${isLastKey ? '└' : '├'}─ [+] ${key}`);
          changes.push(`${baseIndent}${isLastKey ? ' ' : '│'}   └─ [+] ${JSON.stringify(newProp)}`);
          hasChanges = true;
        } else if (oldProp !== undefined && newProp === undefined) {
          // Property was removed
          changes.push(`${baseIndent}${isLastKey ? '└' : '├'}─ [-] ${key}`);
          changes.push(`${baseIndent}${isLastKey ? ' ' : '│'}   └─ [-] ${JSON.stringify(oldProp)}`);
          hasChanges = true;
        } else {
          // Simple value change
          changes.push(`${baseIndent}${isLastKey ? '└' : '├'}─ [~] ${key}`);
          changes.push(`${baseIndent}${isLastKey ? ' ' : '│'}   ├─ [-] ${JSON.stringify(oldProp)}`);
          changes.push(`${baseIndent}${isLastKey ? ' ' : '│'}   └─ [+] ${JSON.stringify(newProp)}`);
          hasChanges = true;
        }
      }
    });

    return hasChanges ? changes : [];
  } else if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    // Handle arrays
    const maxLength = Math.max(oldValue.length, newValue.length);
    let hasChanges = false;

    for (let i = 0; i < maxLength; i++) {
      const oldItem = oldValue[i];
      const newItem = newValue[i];
      const isLastItem = i === maxLength - 1;

      if (oldItem !== newItem) {
        if (oldItem === undefined) {
          // Item was added
          changes.push(`${baseIndent}${isLastItem ? '└' : '├'}─ [+] ${path}[${i}]`);
          changes.push(`${baseIndent}${isLastItem ? ' ' : '│'}   └─ [+] ${JSON.stringify(newItem)}`);
          hasChanges = true;
        } else if (newItem === undefined) {
          // Item was removed
          changes.push(`${baseIndent}${isLastItem ? '└' : '├'}─ [-] ${path}[${i}]`);
          changes.push(`${baseIndent}${isLastItem ? ' ' : '│'}   └─ [-] ${JSON.stringify(oldItem)}`);
          hasChanges = true;
        } else if (typeof oldItem === 'object' && typeof newItem === 'object' && oldItem !== null && newItem !== null) {
          // Recursively diff array items that are objects
          changes.push(`${baseIndent}${isLastItem ? '└' : '├'}─ [~] ${path}[${i}]`);
          const nestedChanges = deepDiff(
            oldItem,
            newItem,
            `${path}[${i}]`,
            `${baseIndent}${isLastItem ? ' ' : '│'}   `,
            true
          );
          if (nestedChanges.length > 0) {
            changes.push(...nestedChanges);
            hasChanges = true;
          }
        } else {
          // Simple value change in array
          changes.push(`${baseIndent}${isLastItem ? '└' : '├'}─ [~] ${path}[${i}]`);
          changes.push(`${baseIndent}${isLastItem ? ' ' : '│'}   ├─ [-] ${JSON.stringify(oldItem)}`);
          changes.push(`${baseIndent}${isLastItem ? ' ' : '│'}   └─ [+] ${JSON.stringify(newItem)}`);
          hasChanges = true;
        }
      }
    }

    return hasChanges ? changes : [];
  } else {
    // Simple value change (non-objects or arrays)
    changes.push(`${baseIndent}${isLast ? '└' : '├'}─ [~] ${path}`);
    changes.push(`${baseIndent}${isLast ? ' ' : '│'}   ├─ [-] ${JSON.stringify(oldValue)}`);
    changes.push(`${baseIndent}${isLast ? ' ' : '│'}   └─ [+] ${JSON.stringify(newValue)}`);
    return changes;
  }
}

function ignoreResource(change: ResourceDifference): boolean {
  const resourceType = change.oldValue?.Type ?? change.newValue?.Type;
  switch (resourceType) {
    case 'AWS::CDK::Metadata':
      return true;
  }
  return false;
}
