import { TemplateDiff } from '@aws-cdk/cloudformation-diff';
//@ts-expect-error TS/JS import issue but works
import { generateDiffs, generateMarkdown, getSavedDiffs, saveDiffs } from '../src/utils/diff';
import { DiffMethod, ExpandStackSelection, StackSelectionStrategy, Toolkit } from '@aws-cdk/toolkit-lib';
import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import { CloudAssembly } from 'aws-cdk-lib/cx-api';
import { CdkExpressPipeline, CdkExpressPipelineAssembly, ExpressStack } from 'cdk-express-pipeline';
import path from 'node:path';
import * as fs from 'node:fs';
//@ts-expect-error TS/JS import issue but works
import { CDK_EXPRESS_PIPELINE_JSON_FILE } from '../src/utils/shared';

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

  const wave2 = expressPipeline.addWave('wave2');
  const wave2stage1 = wave2.addStage('stage1');
  const stackC = new ExpressStack(app, 'stack-c', wave2stage1, {
    stackName: 'StackC'
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
      displayName: 'Topic R'
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
      displayName: 'Topic R can change'
    });
  }

  expressPipeline.synth([wave1, wave2], false, {});
  process.env.CDK_OUTDIR = undefined;

  return {
    assembly: app.synth()
  };
}

async function generateTemplateDiffs(diffFunc: (opts?: AssemblyDiffFuncArgs) => AssemblyDiff, cdkOutChange: string) {
  // const cdkConsole = '';
  const cdkToolkit = new Toolkit();
  //   {
  //   ioHost: {
  //     notify: async function (msg) {
  //       console.log(msg.message);
  //       cdkConsole += stripAnsiCodes(msg.message) + '\n';
  //     },
  //     requestResponse: async function (msg) {
  //       console.log(msg.message);
  //       cdkConsole += stripAnsiCodes(msg.message) + '\n';
  //       return msg.defaultResponse;
  //     }
  //   }
  // }

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

  return templateDiffs;
}

describe('diff.ts', () => {
  it('test complex diff markdown', async () => {
    const cdkOut = path.join(__dirname, 'fixtures', 'cdk.out', 'testAssembly');

    // GH Action 1
    const templateDiffs = await generateTemplateDiffs(testAssembly, cdkOut);
    const stackDiffs = await generateDiffs(templateDiffs);
    await saveDiffs(stackDiffs, cdkOut);

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
});
