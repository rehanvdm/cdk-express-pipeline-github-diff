import { createHash } from 'crypto';

export const CDK_EXPRESS_PIPELINE_JSON_FILE = 'cdk-express-pipeline.json';

export function getCacheKey(stackSelector?: string): string {
  let ret = `cdk-diff-pipeline-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-`;
  if (stackSelector) {
    ret += createHash('md5').update(stackSelector).digest('hex');
  }
  return ret;
}
