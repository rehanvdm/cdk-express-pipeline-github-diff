import { ResourceDifference, type TemplateDiff } from '@aws-cdk/cloudformation-diff';
import * as fs from 'node:fs';
import { CdkExpressPipelineAssembly } from 'cdk-express-pipeline';
import { minimatch } from 'minimatch';

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
  diffLines: DiffLine[];
};

export type DiffSign = '~' | '+' | '-';
export type DiffLine = ResourceDiffLine | PropertyDiffLine | ValueDiffLine;

export type ResourceDiffLine = {
  type: 'Resource';
  name: string;
  id?: string;
  logicalId: string;
  lineContent: string;
  sign: DiffSign;
  diffRulesApplied?: DiffRule[];
};
export type PropertyDiffLine = {
  type: 'Property';
  name: string;
  lineContent: string;
  sign: DiffSign;
  depth: number;
};
export type ValueDiffLine = {
  type: 'Value';
  lineContent: string;
  sign?: DiffSign;
  depth: number;
};

export type DiffLineOutput = DiffLine & {
  path: string;
  resourceSign: DiffSign;
  show: boolean;
};

/**
 * Hides CDK diff lines that are output on the PR Description based on rules
 */
export type DiffRule = {
  name: string;

  /**
   * HIDE_RESOURCE: Hides the entire resource diff if any property changes match the path
   * HIDE_PROPERTIES: Hides only the property changes that match the path, but shows the resource and other property changes
   */
  type: 'HIDE_RESOURCE' | 'HIDE_PROPERTIES';

  /**
   * A glob pattern to match on the path: "ResourceName.ResourceId.Property.NestedProperty.NestedProperty...."
   * If a ResourceId has / in its name, it will be replaced with _ to avoid issues with glob matching
   */
  path: string;
};

export function generateDiffs(
  templateDiffs: { [name: string]: TemplateDiff },
  cdkDiffOutput: string,
  diffRules: DiffRule[]
) {
  if (Object.keys(templateDiffs).length === 0) {
    return undefined;
  }
  const result: DiffResult = { stacks: {} };
  for (const [stackIdName, templateDiff] of Object.entries(templateDiffs)) {
    const stackId = stackIdName.split(' ')[0];
    result.stacks[stackId] = generateStackDiff(stackIdName, templateDiff, cdkDiffOutput, diffRules);
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

function generateStackDiff(
  stackIdName: string,
  templateDiff: TemplateDiff,
  cdkDiffOutput: string,
  diffRules: DiffRule[]
): StackDiff {
  const stackDiff: StackDiff = {
    summary: {
      additions: 0,
      removals: 0,
      updates: 0
    },
    markdown: '',
    diffLines: []
  };

  // Extract the diff output for this specific stack from cdkDiffOutput
  const stackDiffOutput = extractStackDiffOutput(stackIdName, cdkDiffOutput, diffRules);

  if (stackDiffOutput.markdown) {
    stackDiff.markdown = stackDiffOutput.markdown;
    stackDiff.diffLines = stackDiffOutput.diffLines;

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

function extractStackDiffLines(stackIdName: string, cdkDiffOutput: string) {
  const lines = cdkDiffOutput.split('\n');

  let startIndex = -1;
  let endIndex = -1;

  // Find the start of this stack's diff output
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('Stack ' + stackIdName)) {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) {
    return [];
  }

  // Find the end of this stack's diff output (next emoji line or end of file)
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    // Check if this line starts with an emoji (simplified pattern)
    if (lines[i].startsWith('Stack ') || line.startsWith('✨ Number of stacks')) {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    endIndex = lines.length;
  }

  const diffLines = lines.slice(startIndex, endIndex);
  // Find the "Resources" line and extract everything from there
  let resourcesStartIndex = -1;
  for (let i = 0; i < diffLines.length; i++) {
    if (diffLines[i].trim() === 'Resources') {
      resourcesStartIndex = i + 1;
      break;
    }
  }

  // Extract the lines between start and end, excluding the stack header line
  return diffLines.slice(resourcesStartIndex);
}

function diffRulesToString(diffRules: DiffRule[]) {
  if (diffRules.length === 0) {
    return '';
  }
  const grouped: Record<string, DiffRule[]> = diffRules.reduce(
    (acc, r) => {
      if (!acc[r.name]) acc[r.name] = [];
      acc[r.name].push(r);
      return acc;
    },
    {} as Record<string, DiffRule[]>
  );
  // Create a string like: RuleName(2), OtherRule(1)
  return Object.entries(grouped)
    .map(([name, groups]) => `${name}(${groups.length})`)
    .join(', ');
}

export function extractStackDiffOutput(
  stackIdName: string,
  cdkDiffOutput: string,
  diffRules: DiffRule[] = []
): { markdown: string; diffLines: DiffLineOutput[] } {
  const diffLines = extractStackDiffLines(stackIdName, cdkDiffOutput);
  if (!diffLines.length) {
    return { markdown: '', diffLines: [] };
  }
  // Top level resources applied to, we need to output it somewhere (for properties we output on the resource line)
  const resourceRulesApplied: DiffRule[] = [];

  const diffLinesOutput: DiffLineOutput[] = [];
  let path: string[] = [];
  let lastResource: ResourceDiffLine | undefined = undefined;
  let propertyStack: PropertyDiffLine[] = [];

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];
    const nextLie = i + 1 < diffLines.length ? diffLines[i + 1] : '';
    const diffLine = parseDiffLine(line, nextLie);

    if (diffLine.type === 'Resource') {
      path = [diffLine.name];
      if (diffLine.id) {
        path.push(diffLine.id);
      }
      propertyStack = [];
      diffLine.diffRulesApplied = [];
      lastResource = diffLine;
    } else if (diffLine.type === 'Property') {
      // Manage the property stack based on depth
      while (propertyStack.length > 0 && propertyStack[propertyStack.length - 1].depth >= diffLine.depth) {
        propertyStack.pop();
        path.pop();
      }
      propertyStack.push(diffLine);
      path.push(diffLine.name);
    } else if (diffLine.type === 'Value') {
      // For Value lines, we need to manage the path stack based on depth
      // Special case: depth -1 means keep current path (these are diff content lines)
      if (diffLine.depth !== -1) {
        // Pop properties from the stack if the Value line is at a shallower or equal depth
        while (propertyStack.length > 0 && propertyStack[propertyStack.length - 1].depth >= diffLine.depth) {
          propertyStack.pop();
          path.pop();
        }
      }
    }

    // Some resources can have / in their name like the L3 for VPC has a resource:
    // AWS::EC2::InternetGateway VPC/IGW VPCIGWB7E252D3
    // minmatch treats this as a path separator, so we need to replace it with something else otherwise * and ** does
    // not work as expected
    const pathString = path.join('.').replaceAll('/', '_');
    let show = true;
    for (const rule of diffRules) {
      if (minimatch(pathString, rule.path)) {
        if (rule.type === 'HIDE_RESOURCE') {
          if (diffLine.type === 'Resource') {
            if (diffLine.sign === '~') {
              show = false;
              resourceRulesApplied.push(rule);
            }
          } else {
            show = false;

            // Also apply to ALL the lines of the resource that we already have
            // (?not needed => and create a new rule to exclude new properties for this resource
            const indexLastResource = diffLinesOutput.findLastIndex((l) => l.type === 'Resource');
            if (indexLastResource === -1) {
              continue;
            }

            const resourcePath = diffLinesOutput![indexLastResource].path.split('.').slice(0, 2).join('.');
            const resourcePropertyIndex = -1;
            do {
              const resourcePropertyIndex = diffLinesOutput.findIndex((l) => l.path.startsWith(resourcePath) && l.show);
              if (resourcePropertyIndex !== -1) {
                diffLinesOutput[resourcePropertyIndex].show = false;
                if (diffLinesOutput[resourcePropertyIndex].type === 'Resource') {
                  resourceRulesApplied.push(rule);
                }
              }
            } while (resourcePropertyIndex !== -1);
          }
        } else if (rule.type === 'HIDE_PROPERTIES') {
          if (diffLine.type !== 'Resource') {
            const indexLastResource = diffLinesOutput.findLastIndex((l) => l.type === 'Resource');
            if (indexLastResource === -1 || diffLinesOutput![indexLastResource].resourceSign !== '~') {
              continue;
            }
            (diffLinesOutput![indexLastResource] as ResourceDiffLine).diffRulesApplied!.push(rule);
            show = false;
          }
        }
      }
    }

    diffLinesOutput.push({
      ...diffLine,
      path: path.join('.'),
      resourceSign: lastResource!.sign,
      show
    });
  }

  const markdown = [];
  if (resourceRulesApplied.length) {
    markdown.push(`!      {Applied Resource Diff Rules: ${diffRulesToString(resourceRulesApplied)}}`);
  }
  for (const line of diffLinesOutput) {
    if (!line.show) {
      continue;
    }
    const gitDiffSign = line.resourceSign === '~' ? '!' : line.sign;
    let lineContent = `${gitDiffSign}      ${line.lineContent}`;
    if (line.type === 'Resource' && line.diffRulesApplied?.length) {
      lineContent += ` {Applied Property Diff Rules: ${diffRulesToString(line.diffRulesApplied)}}`;
    }
    markdown.push(lineContent);
  }

  return { markdown: markdown.join('\n'), diffLines: diffLinesOutput };
}

function parseDiffLine(line: string, nextLie: string): DiffLine {
  if (line[0] === '[') {
    const splits = line.split(' ');
    const resourceLine: ResourceDiffLine = {
      type: 'Resource',
      name: splits[1],
      logicalId: '-',
      lineContent: line,
      sign: line[1] as DiffSign
    };

    if (resourceLine.sign === '+' || resourceLine.sign === '~') {
      resourceLine.id = splits[2];
      resourceLine.logicalId = splits[3];
    } else {
      resourceLine.logicalId = splits[2];
    }
    return resourceLine;
  } else {
    const indexOfBracket = line.indexOf('] ');
    const splits = line.slice(indexOfBracket + 2).split(' ');
    const sign = line[indexOfBracket - 1] as DiffSign;

    // Find the last indentation on the current line and the next line
    const depth = Math.max(line.indexOf('├─'), line.indexOf('└─'));
    const nextDepth = Math.max(nextLie.indexOf('├─'), nextLie.indexOf('└─'));

    if (splits.length >= 1) {
      // If the next line is more indented, this line is a property name
      if (nextDepth > depth) {
        const propertyLine: PropertyDiffLine = {
          type: 'Property',
          name: splits[0],
          lineContent: line,
          depth,
          sign
        };
        if (splits[0].startsWith('.') && splits[0].endsWith(':')) {
          propertyLine.name = splits[0].slice(1, -1);
        }
        return propertyLine;
      }

      return {
        type: 'Value',
        lineContent: line,
        sign: sign,
        depth
      };
    }

    return {
      type: 'Value',
      lineContent: line,
      sign: sign,
      depth
    };
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
