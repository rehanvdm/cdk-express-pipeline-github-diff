# CDK Express Pipeline GitHub Diff

A GitHub Action that generates and displays AWS CDK Express Pipeline diffs directly in your pull request description,
providing clear visibility into infrastructure changes grouped by waves, stages and stacks

## Features

- 🔍 **Automated Diff Generation**: Automatically generates CDK diffs for Express Pipeline stacks on pull requests
- 🌊 **Wave-based Organization**: Displays diffs organized by pipeline waves and stages for better readability
- 📦 **Stack-level Details**: Shows detailed resource changes (additions, updates, deletions) for each stack
- 🔄 **Parallel Diffs**: CDK Diff your app faster by breaking them into multiple jobs (matrix supported)
- 🎯 **Selective Diffing**: Stack selectors to diff specific waves/stages/stacks enabling the use of parallel diff jobs
- 📝 **Visual Diff on PR Description**: Updates pull request descriptions with formatted diff output
- 🔍 **Full output on Action Summary**: Updates action/job run summary with the full diff output for easy access

## Usage

There are multiple ways to use this action depending on your workflow needs. Below shows a basic example where a single
job generates and displays diffs. Then a more complex example that uses matrix jobs to generate diffs in parallel and
then combines the output.

### Basic Usage

For simple workflows where you generate and display diffs in a single job:

```yaml
name: CDK Diff
on:
  pull_request:
    branches: [main]

jobs:
  cdk-diff:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Build CDK
        run: npm run build

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/your-github-deploy-role
          aws-region: us-east-1

      - name: Synthesize CDK
        run: npm run cdk -- synth '**'

      - name: Generate CDK Diff
        uses: rehanvdm/cdk-express-pipeline-github-diff@v1
        with:
          mode: 'generate'
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Update PR with Diff
        uses: rehanvdm/cdk-express-pipeline-github-diff@v1
        with:
          mode: 'print'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Complex example with Parallel Diffs using Matrix

For matrix workflows where you generate diffs across multiple jobs and combine the output:

```yaml
name: CDK Diff Matrix
on:
  pull_request:
    branches: [main]

jobs:
  generate-diffs:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
      id-token: write
    strategy:
      matrix:
        include:
          - job-name: Diff default - wave1
            selectors: 'Wave1_*'
          - job-name: Diff default - wave2
            selectors: 'Wave2_*'
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install dependencies
        run: npm ci
      - name: Build CDK
        run: npm run build
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/your-github-deploy-role
          aws-region: us-east-1
      - name: Synthesize CDK
        run: npm run cdk -- synth '**'
      - name: Generate CDK Diff
        uses: rehanvdm/cdk-express-pipeline-github-diff@v1
        with:
          mode: 'generate'
          stack-selectors: ${{ matrix.stack-group }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          job-name: ${{ matrix.job-name }}

  print-diffs:
    needs: generate-diffs
    runs-on: ubuntu-latest
    steps:
      - name: Update PR with Combined Diffs
        uses: rehanvdm/cdk-express-pipeline-github-diff@v1
        with:
          mode: 'print'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input                      | Description                                                    | Required | Default           |
| -------------------------- | -------------------------------------------------------------- | -------- | ----------------- |
| `mode`                     | Action mode: `generate` to create diffs, `print` to update PR  | ✅       | -                 |
| `cloud-assembly-directory` | Directory containing the CDK Cloud Assembly                    | ❌       | `cdk.out`         |
| `stack-selectors`          | Comma-separated stack selectors or patterns to diff            | ❌       | `**` (all stacks) |
| `github-token`             | GitHub token for API access and caching                        | ✅       | -                 |
| `job-name`                 | Name of the job, used to link to action/job logs in summaries. | ❌       | -                 |

## Example Outputs

### PR Description output

The action will append a formatted diff to the pull request description, it will never overwrite the existing
description. Here’s an example of what it might look like:

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (stack-a-id)
+       [+] AWS::S3::Bucket MyBucket MyBucket
!       [~] AWS::Lambda::Function MyFunction MyFunction
!         └─ [~] Runtime
!             ├─ [-] "nodejs18.x"
!             └─ [+] "nodejs20.x"

  🏗 wave1stage2
    📦 StackB (stack-b-id)
-       [-] AWS::DynamoDB::Table OldTable OldTable

🌊 wave2
  🏗 stage1
    📦 StackC (stack-c-id)
+       [+] AWS::SNS::Topic NotificationTopic NotificationTopic
```

## How It Works

1. **Generate Mode**:
   - You must run `cdk synth` before using this action to generate the cloud assembly
   - Analyzes your CDK Express Pipeline assembly
   - Creates detailed diffs for each stack showing resource changes and creates the action/job summaries
   - Caches the diff data for retrieval by the print mode job
2. **Print Mode**:
   - Retrieves all cached diff data from previous generate jobs
   - Combines diffs according to the pipeline wave/stage structure
   - Updates the pull request description with formatted diff output

## Stack Selectors

The `stack-selectors` input supports various patterns:

- `**` - All stacks (default)
- `Wave1_*` - All stacks in all stages for `Wave1`
- `Wave1_Stage1_*,Wave1_Stage2_*` - All stacks in `Stage1` and `Stage2` for `Wave1`

See more details in the
[CDK Express Pipeline documentation](https://rehanvdm.github.io/cdk-express-pipeline/guides/selective-deployment/)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have questions:

- Open an issue on GitHub
- Check existing issues for solutions
- Review the action logs for detailed error information
