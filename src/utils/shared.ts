export const CDK_EXPRESS_PIPELINE_JSON_FILE = 'cdk-express-pipeline.json';

const sanitize = (value: string): string => value.replace(/[^a-zA-Z0-9_*]/g, '-');

export function getCacheKey(cloudAssemblyDirectory: string, stackSelector?: string): string {
  let ret = `cdk-diff-pipeline--${process.env.GITHUB_RUN_ID}--${process.env.GITHUB_RUN_ATTEMPT}--`;
  ret += sanitize(cloudAssemblyDirectory) + '--';
  if (stackSelector) {
    ret += sanitize(stackSelector);
  }
  return ret;
}
