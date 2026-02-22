import { Octokit } from '@octokit/core';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';
import { DiffSummary } from './diff.js';

const MAX_DESCRIPTION_LENGTH = 262145;

export function getNowFormated() {
  return (
    new Date()
      .toISOString() // e.g. "2025-08-09T15:43:22.000Z"
      .replace('T', ' ') // "2025-08-09 15:43:22.000Z"
      .replace(/\.\d{3}Z$/, '') + // remove milliseconds + Z
    ' (UTC)'
  );
}

export type AssemblyDiff = {
  header: string;
  markdown: string;
  summary: DiffSummary;
};
const MARKER = '<!-- CDK_EXPRESS_PIPELINE_DIFF_MARKER -->';
const MARKER_HEADER = `${MARKER}\n<!-- DO NOT MAKE CHANGES BELOW THIS LINE, IT WILL BE OVERWRITTEN ON NEXT DIFF -->\n---`;

async function getUpdatedDescription(
  octokit: InstanceType<ReturnType<(typeof Octokit)['plugin']>>,
  owner: string,
  repo: string,
  pullNumber: number,
  newMarkerContent: string
): Promise<string> {
  const response = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber
  });

  const currentDescription = response.data.body || '';
  const markerRegex = new RegExp(`${MARKER}[\\s\\S]*`, 'g');
  const cleanedDescription = currentDescription.replace(markerRegex, '').trim();

  return cleanedDescription + (cleanedDescription ? '\n\n' : '') + newMarkerContent;
}

export async function setGeneratingPrDescription(
  owner: string,
  repo: string,
  pullNumber: number,
  ghToken: string,
  gitHash: string
) {
  const MyOctokit = Octokit.plugin(restEndpointMethods);
  const octokit = new MyOctokit({ auth: ghToken });

  const now = getNowFormated();
  const newContent = `${MARKER_HEADER}
## CDK Diff

⏳ Generating diff from latest commit: ${gitHash} at ${now}...`;

  const combinedContent = await getUpdatedDescription(octokit, owner, repo, pullNumber, newContent);

  await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: pullNumber,
    body: combinedContent
  });

  return combinedContent;
}

export async function updateGithubPrDescriptionWithError(
  owner: string,
  repo: string,
  pullNumber: number,
  ghToken: string,
  gitHash: string,
  error: unknown
) {
  const MyOctokit = Octokit.plugin(restEndpointMethods);
  const octokit = new MyOctokit({ auth: ghToken });

  const now = getNowFormated();
  const errorMessage = error instanceof Error ? error.message : String(error);
  const newContent = `${MARKER_HEADER}
## CDK Diff

❌ Failed to generate/print diff from commit: ${gitHash} at ${now}

\`\`\`
${errorMessage}
\`\`\`

See Actions logs for full details.`;

  const combinedContent = await getUpdatedDescription(octokit, owner, repo, pullNumber, newContent);

  await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: pullNumber,
    body: combinedContent
  });

  return combinedContent;
}

export async function updateGithubPrDescription(
  owner: string,
  repo: string,
  pullNumber: number,
  ghToken: string,
  diffs: AssemblyDiff[],
  gitHash: string
) {
  const MyOctokit = Octokit.plugin(restEndpointMethods);
  const octokit = new MyOctokit({ auth: ghToken });

  const now = getNowFormated();
  let newContent = MARKER_HEADER;

  for (const diff of diffs) {
    const summaryMarkers = [];
    if (diff.summary.additions) {
      summaryMarkers.push(`🟢${diff.summary.additions}`);
    }
    if (diff.summary.updates) {
      summaryMarkers.push(`🟠${diff.summary.updates}`);
    }
    if (diff.summary.removals) {
      summaryMarkers.push(`🔴${diff.summary.removals}`);
    }
    const summaryText = summaryMarkers.length ? `${summaryMarkers.join(' ')}` : '';

    newContent += `
## ${diff.header}

<details open>
<summary> Details ${summaryText} </summary>

${diff.markdown}
</details>

*Generated At: ${now} from commit: ${gitHash}*`;
  }

  let combinedContent = await getUpdatedDescription(octokit, owner, repo, pullNumber, newContent);

  if (combinedContent.length > MAX_DESCRIPTION_LENGTH) {
    const availableSpace = MAX_DESCRIPTION_LENGTH - 100;
    combinedContent =
      combinedContent.substring(0, availableSpace) + '... TRUNCATED Look at GitHub Actions logs for full diff';
  }

  await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: pullNumber,
    body: combinedContent
  });

  return combinedContent;
}
