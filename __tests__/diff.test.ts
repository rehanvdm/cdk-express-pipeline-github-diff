import { TemplateDiff } from '@aws-cdk/cloudformation-diff';
import {
  DiffLineOutput,
  DiffRule,
  extractStackDiffOutput,
  generateDiffs,
  generateMarkdown,
  getSavedDiffs,
  saveDiffs
} from '../src/utils/diff';
import { DiffMethod, ExpandStackSelection, StackSelectionStrategy, Toolkit } from '@aws-cdk/toolkit-lib';
import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import { CloudAssembly } from 'aws-cdk-lib/cx-api';
import { CdkExpressPipeline, CdkExpressPipelineAssembly, ExpressStack } from 'cdk-express-pipeline';
import path from 'node:path';
import * as fs from 'node:fs';
import { CDK_EXPRESS_PIPELINE_JSON_FILE } from '../src/utils/shared';
import * as lambda from 'aws-cdk-lib/aws-lambda';

type AssemblyDiff = {
  assembly: CloudAssembly;
};
type AssemblyDiffFuncArgs = {
  withChange?: boolean;
  outputDir?: string;
};

function testAssembly(opts?: AssemblyDiffFuncArgs): AssemblyDiff {
  if (opts?.outputDir) {
    process.env.CDK_OUTDIR = opts?.outputDir;
  }
  const app = new cdk.App({
    outdir: opts?.outputDir
  });
  const expressPipeline = new CdkExpressPipeline();
  const wave1 = expressPipeline.addWave('wave1');
  const wave1stage1 = wave1.addStage('stage1');
  const stackA = new ExpressStack(app, 'stack-a', wave1stage1, {
    stackName: 'StackA'
  });
  const wave1stage2 = wave1.addStage('wave1stage2');
  const stackB = new ExpressStack(app, 'stack-b', wave1stage2, {
    stackName: 'StackB'
  });
  const stackD = new ExpressStack(app, 'stack-d', wave1stage2, {
    stackName: 'StackD'
  });

  const wave2 = expressPipeline.addWave('wave2');
  const wave2stage1 = wave2.addStage('stage1');
  const stackC = new ExpressStack(app, 'stack-c', wave2stage1, {
    stackName: 'StackC'
  });

  // Tst no change
  new sns.Topic(stackD, 'TopicD', {
    displayName: 'Topic D'
  });

  if (!opts?.withChange) {
    new sns.Topic(stackA, 'TopicA', {
      displayName: 'Topic A'
    });
    new sns.Topic(stackB, 'TopicB', {
      displayName: 'Topic B'
    });
    new sns.Topic(stackB, 'TopicR', {
      topicName: 'Topic R',
      displayName: 'Topic R',
      loggingConfigs: [
        {
          protocol: sns.LoggingProtocol.HTTP
        }
      ]
    });

    const vpc = new cdk.aws_ec2.Vpc(stackC, 'VPC');
    const sg1 = new cdk.aws_ec2.SecurityGroup(stackC, 'SG1', {
      vpc
    });
    sg1.addIngressRule(cdk.aws_ec2.Peer.anyIpv4(), cdk.aws_ec2.Port.tcp(443), 'Allow HTTPS traffic');
    new lambda.Function(stackC, 'Function', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async function(event, context) { return "Hello World"; };'),
      environment: {
        key1: 'value1',
        key2: 'value2'
      },
      memorySize: 256,
      vpc: vpc,
      securityGroups: [
        sg1,
        new cdk.aws_ec2.SecurityGroup(stackC, 'SG2', {
          vpc
        })
      ]
    });
    new lambda.Function(stackC, 'Function2', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async function(event, context) { return "Hello World"; };'),
      environment: {
        key1: 'value1'
      },
      memorySize: 256
    });
  } else {
    new sns.Topic(stackA, 'TopicA', {
      displayName: 'Topic A Change'
    });
    new sns.Topic(stackC, 'TopicC', {
      displayName: 'Topic C'
    });
    new sns.Topic(stackB, 'TopicR', {
      topicName: 'Topic R should not change',
      displayName: 'Topic R can change',
      enforceSSL: true
    });

    const vpc = new cdk.aws_ec2.Vpc(stackC, 'VPC', {
      vpcName: 'VPC Changed',
      maxAzs: 2
    });
    const sg1 = new cdk.aws_ec2.SecurityGroup(stackC, 'SG1', {
      vpc
    });
    sg1.addIngressRule(cdk.aws_ec2.Peer.anyIpv4(), cdk.aws_ec2.Port.tcp(443), 'Allow HTTPS traffic');
    new lambda.Function(stackC, 'Function', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('CHANGED CODE'),
      environment: {
        key1: 'value1-change',
        key3: 'value3'
      },
      memorySize: 512,
      vpc: vpc,
      securityGroups: [sg1]
    });

    new lambda.Function(stackC, 'Function2', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('CHANGED CODE'),
      environment: {
        key1: 'value1-change'
      },
      memorySize: 256
    });
  }

  expressPipeline.synth([wave1, wave2], false, {});
  process.env.CDK_OUTDIR = undefined;

  return {
    assembly: app.synth()
  };
}

async function generateTemplateDiffs(diffFunc: (opts?: AssemblyDiffFuncArgs) => AssemblyDiff, cdkOutChange: string) {
  let cdkDiffOutput = '';
  const cdkToolkit = new Toolkit({
    color: false,
    ioHost: {
      notify: async function (msg) {
        if (msg.level === 'result') {
          cdkDiffOutput += msg.message + '\n';
        }
      },
      requestResponse: async function (msg) {
        if (msg.level === 'result') {
          cdkDiffOutput += msg.message + '\n';
        }
        return msg.defaultResponse;
      }
    }
  });

  if (fs.existsSync(cdkOutChange)) {
    fs.rmSync(cdkOutChange, { recursive: true, force: true });
  }

  // Synth current CDK to file
  const diffBefore = diffFunc({ outputDir: cdkOutChange });
  // Synth changed CDK and only keep in memory
  const diffAfter = diffFunc({ withChange: true });
  const cxAfter = await cdkToolkit.fromAssemblyBuilder(async () => diffAfter.assembly);

  let templateDiffs: { [id: string]: TemplateDiff } = {};
  for (const stack of diffBefore.assembly.stacks) {
    const templateDiff = await cdkToolkit.diff(cxAfter, {
      method: DiffMethod.LocalFile(path.join(cdkOutChange, stack.id + '.template.json')),
      stacks: {
        strategy: StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE,
        patterns: [stack.id],
        expand: ExpandStackSelection.NONE,
        failOnEmpty: false
      }
    });
    templateDiffs = {
      ...templateDiffs,
      ...templateDiff
    };
  }
  // console.log('cdkConsole');
  // console.log(cdkConsole);

  //Because we are doing a for loop and seperate diff for each stack, we get the line:
  // ✨ Number of stacks with differences: 1
  // at the end of each stack diff, so we need to remove those lines and add a single one at the end
  cdkDiffOutput =
    cdkDiffOutput
      .split('\n')
      .filter((line) => !line.startsWith('✨ Number of stacks with differences:'))
      .join('\n') + `✨ Number of stacks with differences: ${Object.keys(templateDiffs).length}`;

  return { templateDiffs, cdkDiffOutput };
}

describe('diff.ts', () => {
  it('test complex diff markdown - no diff rules', async () => {
    const cdkOut = path.join(__dirname, 'fixtures', 'cdk.out', 'testAssembly');

    // GH Action 1
    const testDiffRes = await generateTemplateDiffs(testAssembly, cdkOut);
    const stackDiffs = await generateDiffs(testDiffRes.templateDiffs, testDiffRes.cdkDiffOutput, []);
    if (stackDiffs) {
      await saveDiffs(stackDiffs, cdkOut);
    }

    // GH Action 2
    const allStackDiffs = getSavedDiffs(cdkOut);
    const shortHandOrder: CdkExpressPipelineAssembly = JSON.parse(
      fs.readFileSync(path.join(cdkOut, CDK_EXPRESS_PIPELINE_JSON_FILE), 'utf-8')
    );
    const markdown = generateMarkdown(shortHandOrder, allStackDiffs);

    // Local inspection
    //fs.writeFileSync('__tests__/diff-output-markdown.md', result);

    expect(markdown).toMatchSnapshot();
  });

  it('test paths', async () => {
    const cdkOut = path.join(__dirname, 'fixtures', 'cdk.out', 'testAssembly');
    const testDiffRes = await generateTemplateDiffs(testAssembly, cdkOut);

    const result: Record<string, string> = {};
    for (const [stackIdName] of Object.entries(testDiffRes.templateDiffs)) {
      const stackId = stackIdName.split(' ')[0];
      result[stackId] = extractStackDiffOutput(stackIdName, testDiffRes.cdkDiffOutput)
        .diffLines.map((l: DiffLineOutput) => l.path + ' >> ' + l.lineContent)
        .join('\n');
    }
    function safeSnapShotMarkdownCompare(str: string) {
      // Ensure that the line after "There were no differences." is an empty line.
      return str.replace(/(There were no differences\.?)\n([^\n])/g, '$1\n\n$2');
    }
    expect(safeSnapShotMarkdownCompare(testDiffRes.cdkDiffOutput)).toMatchSnapshot();
    expect(result).toMatchSnapshot();
  });

  it('test complex diff markdown - diff rules', async () => {
    const cdkOut = path.join(__dirname, 'fixtures', 'cdk.out', 'testAssembly');
    const testDiffRes = await generateTemplateDiffs(testAssembly, cdkOut);

    const shortHandOrder: CdkExpressPipelineAssembly = JSON.parse(
      fs.readFileSync(path.join(cdkOut, CDK_EXPRESS_PIPELINE_JSON_FILE), 'utf-8')
    );

    const tests: Record<string, DiffRule[]> = {
      'Hide all SNS Topics - Resource level': [
        {
          name: 'hide-all-sns-resources',
          type: 'HIDE_RESOURCE',
          path: 'AWS::SNS::Topic.*'
        }
      ],
      'Hide all SNS Topic Changes - Property level': [
        {
          name: 'hide-all-sns-property-changes',
          type: 'HIDE_PROPERTIES',
          path: 'AWS::SNS::Topic.*'
        }
      ],

      'Hide only TopicA - Resource level': [
        {
          name: 'hide-all-topica-resources',
          type: 'HIDE_RESOURCE',
          path: 'AWS::SNS::Topic.TopicA*'
        }
      ],
      'Hide only TopicA changes - Property level': [
        {
          name: 'hide-topica-property-changes',
          type: 'HIDE_PROPERTIES',
          path: 'AWS::SNS::Topic.TopicA*'
        }
      ],

      'Hide all SNS Topics that have Display Name changes': [
        {
          name: 'hide-topics-with-display-name-changes',
          type: 'HIDE_RESOURCE',
          path: 'AWS::SNS::Topic.*.DisplayName'
        }
      ],
      'Hide all SNS Topic Display Name changes': [
        {
          name: 'hide-topics-display-name-changes',
          type: 'HIDE_PROPERTIES',
          path: 'AWS::SNS::Topic.*.DisplayName'
        }
      ],

      'Hide Lambda changes to all Lambdas with env key1': [
        {
          name: 'hide-env-key1-changes',
          type: 'HIDE_PROPERTIES',
          path: 'AWS::Lambda::Function.*.Environment.Variables.key1'
        }
      ],
      'Hide all Lambda code changes': [
        {
          name: 'hide-code-changes',
          type: 'HIDE_PROPERTIES',
          path: 'AWS::Lambda::Function.*.Code.*'
        }
      ],

      'Hide all tag changes': [
        {
          name: 'hide-all-tag-changes',
          type: 'HIDE_PROPERTIES',
          path: '*.Tags'
        }
      ],

      'Multiple rules': [
        {
          name: 'hide-topics-display-name-changes',
          type: 'HIDE_PROPERTIES',
          path: 'AWS::SNS::Topic.*.DisplayName'
        },
        {
          name: 'hide-topics-topic-name-changes',
          type: 'HIDE_PROPERTIES',
          path: 'AWS::SNS::Topic.*.TopicName'
        }
      ],

      // HIDE_RESOURCE_IF_EMPTY on its own does nothing — properties are still shown, so no resource
      // is hidden. Demonstrates it is truly a post-processing-only rule.
      'HIDE_RESOURCE_IF_EMPTY - standalone, no effect': [
        {
          name: 'hide-sns-if-empty',
          type: 'HIDE_RESOURCE_IF_EMPTY',
          path: 'AWS::SNS::Topic.*'
        }
      ],

      // HIDE_PROPERTIES hides all SNS Topic properties; HIDE_RESOURCE_IF_EMPTY then detects the
      // now-empty resource headers and removes them too.
      'HIDE_RESOURCE_IF_EMPTY - all properties hidden by HIDE_PROPERTIES, resources hidden': [
        {
          name: 'hide-sns-properties',
          type: 'HIDE_PROPERTIES',
          path: 'AWS::SNS::Topic.*'
        },
        {
          name: 'hide-sns-if-empty',
          type: 'HIDE_RESOURCE_IF_EMPTY',
          path: 'AWS::SNS::Topic.*'
        }
      ],

      // HIDE_PROPERTIES only hides DisplayName. TopicA (only had DisplayName) becomes empty so
      // HIDE_RESOURCE_IF_EMPTY hides it. TopicR still has TopicName visible so it stays.
      'HIDE_RESOURCE_IF_EMPTY - some properties remain, resource stays visible': [
        {
          name: 'hide-sns-display-name',
          type: 'HIDE_PROPERTIES',
          path: 'AWS::SNS::Topic.*.DisplayName'
        },
        {
          name: 'hide-sns-if-empty',
          type: 'HIDE_RESOURCE_IF_EMPTY',
          path: 'AWS::SNS::Topic.*'
        }
      ],

      // HIDE_PROPERTIES handles DisplayName; HIDE_RESOURCE_IF_EMPTY targets only TopicR by ResourceId.
      // TopicR still has remaining visible properties so it is NOT hidden despite the rule matching.
      'HIDE_RESOURCE_IF_EMPTY combined with HIDE_PROPERTIES': [
        {
          name: 'hide-topics-display-name-changes',
          type: 'HIDE_PROPERTIES',
          path: 'AWS::SNS::Topic.*.DisplayName'
        },
        {
          name: 'hide-topics-topic-name-if-empty',
          type: 'HIDE_RESOURCE_IF_EMPTY',
          path: 'AWS::SNS::Topic.TopicR*'
        }
      ]
    };

    for (const [name, rules] of Object.entries(tests)) {
      const stackDiffs = await generateDiffs(testDiffRes.templateDiffs, testDiffRes.cdkDiffOutput, rules);
      expect(stackDiffs).toBeDefined();
      const markdown = generateMarkdown(shortHandOrder, stackDiffs);
      expect(markdown).toMatchSnapshot(name);
    }
  });

  it('test undefined', async () => {
    const cdkOut = path.join(__dirname, 'fixtures', 'cdk.out', 'testAssembly');

    function testAssemblyWithUndefined(opts?: AssemblyDiffFuncArgs): AssemblyDiff {
      if (opts?.outputDir) {
        process.env.CDK_OUTDIR = opts?.outputDir;
      }

      const app = new cdk.App({
        outdir: opts?.outputDir
      });
      const expressPipeline = new CdkExpressPipeline();
      const wave1 = expressPipeline.addWave('wave1');
      const wave1stage1 = wave1.addStage('stage1');
      const stackA = new ExpressStack(app, 'stack-a', wave1stage1, {
        stackName: 'StackA'
      });

      if (!opts?.withChange) {
        const apiLambda = new lambda.Function(stackA, 'lambda-api', {
          functionName: 'api',
          code: lambda.Code.fromInline('exports.handler = async function(event, context) { return "Hello World"; };'),
          handler: 'index.handler',
          runtime: lambda.Runtime.NODEJS_22_X,
          memorySize: 1024,
          environment: {
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1'
          }
        });
        const apiLambdaUrl = apiLambda.addFunctionUrl({
          authType: lambda.FunctionUrlAuthType.NONE,
          cors: {
            allowedOrigins: ['*'],
            allowedHeaders: ['*']
          }
        });

        const apiOrigin = cdk.Fn.select(2, cdk.Fn.split('/', apiLambdaUrl.url));
        new cdk.CfnOutput(stackA, 'Lambda API Host', { value: apiLambdaUrl.url });
        new cdk.CfnOutput(stackA, 'Lambda API Origin', { value: apiOrigin });
      }

      expressPipeline.synth([wave1], false, {});
      process.env.CDK_OUTDIR = undefined;

      return {
        assembly: app.synth()
      };
    }

    const testDiffRes = await generateTemplateDiffs(testAssemblyWithUndefined, cdkOut);
    const stackDiffs = await generateDiffs(testDiffRes.templateDiffs, testDiffRes.cdkDiffOutput, []);
    if (stackDiffs) {
      await saveDiffs(stackDiffs, cdkOut);
    }

    // GH Action 2
    const allStackDiffs = getSavedDiffs(cdkOut);
    const shortHandOrder: CdkExpressPipelineAssembly = JSON.parse(
      fs.readFileSync(path.join(cdkOut, CDK_EXPRESS_PIPELINE_JSON_FILE), 'utf-8')
    );
    const markdown = generateMarkdown(shortHandOrder, allStackDiffs);

    expect(markdown).toMatchSnapshot();
  });

  it('test combined lambda rules - hide VERSION env var, code changes, and hide lambda if empty', async () => {
    const cdkOut = path.join(__dirname, 'fixtures', 'cdk.out', 'testLambdaRules');

    function testAssemblyForLambdaRules(opts?: AssemblyDiffFuncArgs): AssemblyDiff {
      if (opts?.outputDir) {
        process.env.CDK_OUTDIR = opts?.outputDir;
      }
      const app = new cdk.App({ outdir: opts?.outputDir });
      const expressPipeline = new CdkExpressPipeline();
      const wave1 = expressPipeline.addWave('wave1');
      const wave1stage1 = wave1.addStage('stage1');
      const stackA = new ExpressStack(app, 'stack-a', wave1stage1, { stackName: 'StackA' });

      if (!opts?.withChange) {
        new lambda.Function(stackA, 'LambdaCodeAndVersion', {
          runtime: lambda.Runtime.NODEJS_24_X,
          handler: 'index.handler',
          code: lambda.Code.fromInline('original code'),
          environment: { VERSION: '1.0.0' }
        });
        new lambda.Function(stackA, 'LambdaVersion', {
          runtime: lambda.Runtime.NODEJS_24_X,
          handler: 'index.handler',
          code: lambda.Code.fromInline('original code'),
          environment: { VERSION: '1.0.0' }
        });
        new lambda.Function(stackA, 'LambdaWithOtherChanges', {
          runtime: lambda.Runtime.NODEJS_24_X,
          handler: 'index.handler',
          code: lambda.Code.fromInline('original code'),
          memorySize: 256
        });
      } else {
        new lambda.Function(stackA, 'LambdaCodeAndVersion', {
          runtime: lambda.Runtime.NODEJS_24_X,
          handler: 'index.handler',
          code: lambda.Code.fromInline('changed code'),
          environment: { VERSION: '2.0.0' }
        });
        new lambda.Function(stackA, 'LambdaVersion', {
          runtime: lambda.Runtime.NODEJS_24_X,
          handler: 'index.handler',
          code: lambda.Code.fromInline('original code'),
          environment: { VERSION: '2.0.0' }
        });
        new lambda.Function(stackA, 'LambdaWithOtherChanges', {
          runtime: lambda.Runtime.NODEJS_24_X,
          handler: 'index.handler',
          code: lambda.Code.fromInline('changed code'),
          memorySize: 512
        });
      }

      expressPipeline.synth([wave1], false, {});
      process.env.CDK_OUTDIR = undefined;
      return { assembly: app.synth() };
    }

    const testDiffRes = await generateTemplateDiffs(testAssemblyForLambdaRules, cdkOut);
    const shortHandOrder: CdkExpressPipelineAssembly = JSON.parse(
      fs.readFileSync(path.join(cdkOut, CDK_EXPRESS_PIPELINE_JSON_FILE), 'utf-8')
    );

    const rules: DiffRule[] = [
      {
        name: 'hide-dd-tags',
        type: 'HIDE_PROPERTIES',
        path: 'AWS::Lambda::Function.*.Environment.Variables.VERSION'
      },
      {
        name: 'hide-code-changes',
        type: 'HIDE_PROPERTIES',
        path: 'AWS::Lambda::Function.*.Code.*'
      },
      {
        name: 'hide-lambda-if-all-changes-are-hidden',
        type: 'HIDE_RESOURCE_IF_EMPTY',
        path: 'AWS::Lambda::Function.*'
      }
    ];

    const stackDiffs = await generateDiffs(testDiffRes.templateDiffs, testDiffRes.cdkDiffOutput, rules);
    expect(stackDiffs).toBeDefined();
    const markdown = generateMarkdown(shortHandOrder, stackDiffs!);
    expect(markdown).toMatchSnapshot();
  });

  it('test HIDE_RESOURCE_IF_EMPTY with slash in resource ID', () => {
    // Regression test: resources whose CDK construct path contains a "/" (produced by L3/nested
    // constructs, e.g. "NestedConstruct/Lambda") were never hidden by HIDE_RESOURCE_IF_EMPTY
    // because minimatch's * does not match "/", so the rule path "AWS::Lambda::Function.*"
    // failed to match "AWS::Lambda::Function.NestedConstruct/Lambda".
    const stackIdName = 'myStack (MyStack)';

    // Lambda whose only change is an env var — all properties hidden → resource should be hidden.
    const allHiddenDiff = `Stack myStack (MyStack)
Resources
[~] AWS::Lambda::Function NestedConstruct/Lambda NestedConstructLambdaABCD1234
 └─ [~] Environment
     └─ [~] .Variables:
         └─ [~] .ENV_VAR:
             ├─ [-] original-value
             └─ [+] updated-value
✨ Number of stacks with differences: 1`;

    // Lambda with env var + MemorySize change — env var hidden but MemorySize remains visible.
    const partiallyHiddenDiff = `Stack myStack (MyStack)
Resources
[~] AWS::Lambda::Function NestedConstruct/Lambda NestedConstructLambdaABCD1234
 ├─ [~] Environment
 │   └─ [~] .Variables:
 │       └─ [~] .ENV_VAR:
 │           ├─ [-] original-value
 │           └─ [+] updated-value
 └─ [~] MemorySize
     ├─ [-] 256
     └─ [+] 512
✨ Number of stacks with differences: 1`;

    const rules: DiffRule[] = [
      {
        name: 'hide-env-var',
        type: 'HIDE_PROPERTIES',
        path: 'AWS::Lambda::Function.*.Environment.Variables.ENV_VAR'
      },
      {
        name: 'hide-lambda-if-all-changes-are-hidden',
        type: 'HIDE_RESOURCE_IF_EMPTY',
        path: 'AWS::Lambda::Function.*'
      }
    ];

    // All changes hidden → HIDE_RESOURCE_IF_EMPTY must fire despite the "/" in the resource ID.
    const allHiddenResult = extractStackDiffOutput(stackIdName, allHiddenDiff, rules);
    expect(allHiddenResult.diffLines.find((l) => l.type === 'Resource')?.show).toBe(false);
    expect(allHiddenResult.markdown).toContain('hide-lambda-if-all-changes-are-hidden(1)[NestedConstruct/Lambda]');

    // Partial hide → MemorySize still visible, resource must NOT be hidden.
    const partialResult = extractStackDiffOutput(stackIdName, partiallyHiddenDiff, rules);
    expect(partialResult.diffLines.find((l) => l.type === 'Resource')?.show).toBe(true);
    expect(partialResult.markdown).toMatch(/\[~\] AWS::Lambda::Function NestedConstruct\/Lambda/);
  });
});
