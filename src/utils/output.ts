import { Octokit } from '@octokit/core';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';
import { DiffSummary } from './diff.js';

const MAX_DESCRIPTION_LENGTH = 262145;

export function getNowFormated(additionalTimezones?: string[]) {
  const now = new Date();
  const utcStr =
    now
      .toISOString() // e.g. "2025-08-09T15:43:22.000Z"
      .replace('T', ' ') // "2025-08-09 15:43:22.000Z"
      .replace(/\.\d{3}Z$/, '') + // remove milliseconds + Z
    ' (UTC)';

  if (!additionalTimezones || additionalTimezones.length === 0) {
    return utcStr;
  }

  // UTC midnight used as the baseline for day-difference calculation
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const tzParts = additionalTimezones
    .map((tz) => {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          timeZoneName: 'short'
        }).formatToParts(now);
        const year = parseInt(parts.find((p) => p.type === 'year')?.value ?? '0', 10);
        const month = parseInt(parts.find((p) => p.type === 'month')?.value ?? '1', 10) - 1;
        const day = parseInt(parts.find((p) => p.type === 'day')?.value ?? '0', 10);
        const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
        const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
        const second = parts.find((p) => p.type === 'second')?.value ?? '';
        const tzName = parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;

        // Append a relative day indicator when the local date differs from the UTC date
        const localMidnight = Date.UTC(year, month, day);
        const dayDiff = Math.round((localMidnight - utcMidnight) / (1000 * 60 * 60 * 24));
        const dayIndicator = dayDiff !== 0 ? ` (${dayDiff > 0 ? '+' : ''}${dayDiff}d)` : '';

        return `${hour}:${minute}:${second}${dayIndicator} (${tzName})`;
      } catch {
        return null;
      }
    })
    .filter((s): s is string => s !== null);

  if (tzParts.length === 0) {
    return utcStr;
  }

  return utcStr + ' | ' + tzParts.join(' | ');
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

const GENERATING_MARKER = '⏳ Generating diff from latest commit';

export async function setGeneratingPrDescription(
  owner: string,
  repo: string,
  pullNumber: number,
  ghToken: string,
  gitHash: string,
  timezones?: string[]
) {
  const MyOctokit = Octokit.plugin(restEndpointMethods);
  const octokit = new MyOctokit({ auth: ghToken });

  const response = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber
  });

  if ((response.data.body || '').includes(GENERATING_MARKER)) {
    return response.data.body || '';
  }

  const now = getNowFormated(timezones);
  const newContent = `${MARKER_HEADER}
## CDK Diff

${GENERATING_MARKER}: ${gitHash} at ${now}`;

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
  gitHash: string,
  timezones?: string[]
) {
  const MyOctokit = Octokit.plugin(restEndpointMethods);
  const octokit = new MyOctokit({ auth: ghToken });

  const now = getNowFormated(timezones);
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
