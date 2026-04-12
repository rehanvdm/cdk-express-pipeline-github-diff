# CDK Express Pipeline GitHub Diff

A GitHub Action that generates and displays [CDK Express Pipeline](https://github.com/rehanvdm/cdk-express-pipeline)
diffs directly in your pull request description, providing clear visibility into infrastructure changes grouped by
waves, stages and stacks.

## Features

- 🔍 **Automated Diff Generation**: Automatically generates CDK diffs for Express Pipeline stacks on pull requests
- 🌊 **Wave-based Organization**: Displays diffs organized by pipeline waves and stages for better readability
- 📦 **Stack-level Details**: Shows detailed resource changes (additions, updates, deletions) for each stack
- 🔄 **Parallel Diffs**: CDK Diff your app faster by breaking them into multiple jobs (matrix supported)
- 🎯 **Selective Diffing**: Stack selectors to diff specific waves/stages/stacks enabling the use of parallel diff jobs
- 📝 **Visual Diff on PR Description**: Updates pull request descriptions with formatted diff output
- 🔍 **Full output on Action Summary**: Updates action/job run summary with the full diff output for easy access

## Example Outputs

### PR Description output

The action will append a formatted diff to the pull request description, it will never overwrite the existing
description. Here's an example of what it looks like:

![img.png](docs/imgs/pr_description.png)

### Action Summary output

The action will also update the action/job summary with the full CDK diff output without any changes:

![img.png](docs/imgs/action_summary.png)

## Usage

This action operates in two distinct modes: `generate` and `print`. Understanding these modes is essential for setting
up your workflow correctly.

### Generate Mode (`mode: 'generate'`)

The generate mode analyzes your CDK Express Pipeline assembly and creates detailed diffs for each stack. This mode:

- Must be run after `cdk synth` to generate the cloud assembly
- Analyzes your CDK Express Pipeline assembly structure
- Creates detailed diffs showing resource changes (additions, updates, deletions) for each stack
- Caches the diff data for retrieval by the print mode
- Updates action/job summaries with the full diff output

**Parameters for Generate Mode:**

- `mode`: Set to `'generate'` (required)
- `github-token`: GitHub token for API access and caching that needs `pull-requests: write` permission (required)
- `cloud-assembly-directory`: Directory containing the CDK Cloud Assembly (optional, default: `cdk.out`)
- `stack-selectors`: Comma-separated stack selectors or patterns to diff (optional, default: `**` for all stacks)
- `job-name`: Name of the job, used to link to action/job logs in summaries (optional)
- `diff-rules`: An array of objects indicating rules to apply to the diff output on the PR description (optional)
  Example Usage:

  ```yaml
  diff-rules: |
    - name: hide-all-sns-resources
      type: HIDE_RESOURCE
      path: AWS::SNS::Topic.*
    - name: hide-all-sns-property-changes
      type: HIDE_PROPERTIES
      path: AWS::SNS::Topic.*
  ```

  Properties:
  - `name`: The name of the rule shown next to the hidden resource/properties in the diff.
  - `type`: The type of rule. Options are:
    - `HIDE_RESOURCE`: Hides the entire resource diff if any property changes match the path
    - `HIDE_PROPERTIES`: Hides only the property changes that match the path, but shows the resource and other property
      changes
    - `HIDE_RESOURCE_IF_EMPTY`: Does not hide any properties itself. After all other rules have run, if the matched
      resource has no visible children remaining, hides the resource header too. Combine with `HIDE_PROPERTIES` rules to
      suppress both the properties and the now-empty resource header.
  - `path`: A glob pattern to match on the path with format:
    `ResourceName.ResourceId.Property.NestedProperty.NestedProperty....` If a ResourceId has / in its name, it will be
    replaced with \_ to avoid issues with glob matching

- `display-timezones`: A YAML array of [IANA timezone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
  names to display alongside UTC in the "Generated At" timestamp (optional). Example Usage:

  ```yaml
  display-timezones: |
    - America/New_York
    - Europe/Paris
    - Asia/Tokyo
  ```

  The timestamp will render compactly as:
  `YYYY-MM-DD HH:MM:SS (UTC) | HH:MM:SS (EST) | HH:MM:SS (CET) | HH:MM:SS (JST)`. If a timezone falls on a different
  calendar date than UTC, a relative day offset is appended, e.g. `HH:MM:SS (+1d) (JST)` or `HH:MM:SS (-1d) (PST)`.

#### Diff Rules Examples

##### HIDE ALL SNS TOPIC RESOURCES

This rule hides all SNS Topic resources from the diff output if they have changes.

```yaml
diff-rules: |
  - name: hide-all-sns-resources
    type: HIDE_RESOURCE
    path: AWS::SNS::Topic.*
```

Output Before:

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (wave1_stage1_stack-a)
-      [-] AWS::SNS::Topic TopicBB2A41848 destroy
!      [~] AWS::SNS::Topic TopicA TopicA1C813746
!       └─ [~] DisplayName
!           ├─ [-] Topic A
!           └─ [+] Topic A Change
+      [+] AWS::SNS::TopicPolicy TopicR/Policy TopicRPolicyD33151F3
!      [~] AWS::SNS::Topic TopicR TopicRC70D74C1 replace
!       ├─ [~] DisplayName
!       │   ├─ [-] Topic R
!       │   └─ [+] Topic R can change
!       └─ [~] TopicName (requires replacement)
!           ├─ [-] Topic R
!           └─ [+] Topic R should not change
```

Output After:

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (wave1_stage1_stack-a)
       {Applied Resource Diff Rules: hide-all-sns-resources(2)}
-      [-] AWS::SNS::Topic TopicBB2A41848 destroy
+      [+] AWS::SNS::TopicPolicy TopicR/Policy TopicRPolicyD33151F3
```

##### HIDE ALL SNS TOPIC PROPERTY CHANGES

```yaml
diff-rules: |
  - name: hide-all-sns-property-changes
    type: HIDE_PROPERTIES
    path: AWS::SNS::Topic.*
```

<details>
<summary> Output Before & After </summary>

Output Before:

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (wave1_stage1_stack-a)
-      [-] AWS::SNS::Topic TopicBB2A41848 destroy
!      [~] AWS::SNS::Topic TopicA TopicA1C813746
!       └─ [~] DisplayName
!           ├─ [-] Topic A
!           └─ [+] Topic A Change
+      [+] AWS::SNS::TopicPolicy TopicR/Policy TopicRPolicyD33151F3
!      [~] AWS::SNS::Topic TopicR TopicRC70D74C1 replace
!       ├─ [~] DisplayName
!       │   ├─ [-] Topic R
!       │   └─ [+] Topic R can change
!       └─ [~] TopicName (requires replacement)
!           ├─ [-] Topic R
!           └─ [+] Topic R should not change
```

Output After:

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (wave1_stage1_stack-a)
-      [-] AWS::SNS::Topic TopicBB2A41848 destroy
!      [~] AWS::SNS::Topic TopicA TopicA1C813746 {Applied Property Diff Rules: hide-all-sns-property-changes(3)}
+      [+] AWS::SNS::TopicPolicy TopicR/Policy TopicRPolicyD33151F3
!      [~] AWS::SNS::Topic TopicR TopicRC70D74C1 replace {Applied Property Diff Rules: hide-all-sns-property-changes(6)}
```

</details>

#### HIDE ALL PROPERTY CHANGES FOR THE SNS TOPIC WITH ID `TopicR`

```yaml
diff-rules: |
  - name: hide-topic-r-property-changes
    type: HIDE_PROPERTIES
    path: AWS::SNS::Topic.TopicR.*
```

<details>
<summary> Output Before & After </summary>

Output Before:

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (wave1_stage1_stack-a)
-      [-] AWS::SNS::Topic TopicBB2A41848 destroy
!      [~] AWS::SNS::Topic TopicA TopicA1C813746
!       └─ [~] DisplayName
!           ├─ [-] Topic A
!           └─ [+] Topic A Change
+      [+] AWS::SNS::TopicPolicy TopicR/Policy TopicRPolicyD33151F3
!      [~] AWS::SNS::Topic TopicR TopicRC70D74C1 replace
!       ├─ [~] DisplayName
!       │   ├─ [-] Topic R
!       │   └─ [+] Topic R can change
!       └─ [~] TopicName (requires replacement)
!           ├─ [-] Topic R
!           └─ [+] Topic R should not change
```

Output After:

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (wave1_stage1_stack-a)
-      [-] AWS::SNS::Topic TopicBB2A41848 destroy
!      [~] AWS::SNS::Topic TopicA TopicA1C813746
!       └─ [~] DisplayName
!           ├─ [-] Topic A
!           └─ [+] Topic A Change
+      [+] AWS::SNS::TopicPolicy TopicR/Policy TopicRPolicyD33151F3
!      [~] AWS::SNS::Topic TopicR TopicRC70D74C1 replace {Applied Property Diff Rules: hide-topic-r-property-changes(6)}
```

</details>

#### HIDE ALL SNS TOPIC `DisplayName` CHANGES

```yaml
diff-rules: |
  - name: hide-sns-display-name-changes
    type: HIDE_PROPERTIES
    path: AWS::SNS::Topic.*.DisplayName
```

<details>
<summary> Output Before & After </summary>

Output Before:

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (wave1_stage1_stack-a)
-      [-] AWS::SNS::Topic TopicBB2A41848 destroy
!      [~] AWS::SNS::Topic TopicA TopicA1C813746
!       └─ [~] DisplayName
!           ├─ [-] Topic A
!           └─ [+] Topic A Change
+      [+] AWS::SNS::TopicPolicy TopicR/Policy TopicRPolicyD33151F3
!      [~] AWS::SNS::Topic TopicR TopicRC70D74C1 replace
!       ├─ [~] DisplayName
!       │   ├─ [-] Topic R
!       │   └─ [+] Topic R can change
!       └─ [~] TopicName (requires replacement)
!           ├─ [-] Topic R
!           └─ [+] Topic R should not change
```

Output After:

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (wave1_stage1_stack-a)
-      [-] AWS::SNS::Topic TopicBB2A41848 destroy
!      [~] AWS::SNS::Topic TopicA TopicA1C813746 {Applied Property Diff Rules: hide-sns-display-name-changes(3)}
+      [+] AWS::SNS::TopicPolicy TopicR/Policy TopicRPolicyD33151F3
!      [~] AWS::SNS::Topic TopicR TopicRC70D74C1 replace {Applied Property Diff Rules: hide-sns-display-name-changes(3)}
!       └─ [~] TopicName (requires replacement)
!           ├─ [-] Topic R
!           └─ [+] Topic R should not change
```

</details>

#### HIDE ALL LAMBDA FUNCTION `Environment` CHANGES for `key1`

```yaml
diff-rules: |
  - name: hide-env-key1-changes
    type: HIDE_PROPERTIES
    path: AWS::Lambda::Function.*.Environment.Variables.key1
```

<details>
<summary> Output Before & After </summary>

Output Before:

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (wave1_stage1_stack-a)
!      [~] AWS::Lambda::Function Function Function76856677
!       ├─ [~] Code
!       │   └─ [~] .ZipFile:
!       │       ├─ [-] CHANGED CODE
!       │       └─ [+] exports.handler = async function(event, context) { return "Hello World"; };
!       ├─ [~] Environment
!       │   └─ [~] .Variables:
!       │       ├─ [~] .key1:
!       │       │   ├─ [-] value1
!       │       │   └─ [+] value1-change
!       │       ├─ [-] Removed: .key2
!       │       └─ [+] Added: .key3
```

Output After:

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (wave1_stage1_stack-a)
!      [~] AWS::Lambda::Function Function Function76856677 {Applied Property Diff Rules: hide-env-key1-changes(3)}
!       ├─ [~] Code
!       │   └─ [~] .ZipFile:
!       │       ├─ [-] CHANGED CODE
!       │       └─ [+] exports.handler = async function(event, context) { return "Hello World"; };
!       ├─ [~] Environment
!       │   └─ [~] .Variables:
!       │       ├─ [-] Removed: .key2
!       │       └─ [+] Added: .key3
```

</details>

#### HIDE ALL TAG CHANGES FOR ALL RESOURCES

```yaml
diff-rules: |
  - name: hide-all-tag-changes
    type: HIDE_PROPERTIES
    path: *.Tags
```

<details>
<summary> Output Before & After </summary>

Output Before:

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (wave1_stage1_stack-a)
!      [~] AWS::EC2::VPC VPC VPCB9E5F0B4
!       └─ [~] Tags
!           └─ @@ -1,6 +1,6 @@
!              [ ] [
!              [ ]   {
!              [ ]     "Key": "Name",
!              [-]     "Value": "wave2_stage1_stack-c/VPC"
!              [+]     "Value": "VPC Changed"
!              [ ]   }
!              [ ] ]
```

Output After:

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (wave1_stage1_stack-a)
!      [~] AWS::EC2::VPC VPC VPCB9E5F0B4 {Applied Property Diff Rules: hide-all-tag-changes(9)}
```

</details>

#### HIDE RESOURCE IF ALL PROPERTY CHANGES ARE HIDDEN

`HIDE_RESOURCE_IF_EMPTY` does **not** hide any properties itself. It is a post-processing rule. After all other rules
have run, if the matched resource has no visible children remaining, the resource header is hidden too. Combine it with
`HIDE_PROPERTIES` rules that do the property hiding.

This is useful when hiding properties on frequently changing resources, as it prevents empty resource headers from
cluttering the diff output. This increases the signal-to-noise ratio by suppressing the entire resource when all its
changes are hidden, rather than showing the resource with no changes visible.

```yaml
diff-rules: |
  - name: hide-sns-display-properties
    type: HIDE_PROPERTIES
    path: AWS::SNS::Topic.*.DisplayName
  - name: hide-sns-if-empty
    type: HIDE_RESOURCE_IF_EMPTY
    path: AWS::SNS::Topic.*
```

<details>
<summary> Output Before & After </summary>

Output Before:

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (wave1_stage1_stack-a)
!      [~] AWS::SNS::Topic TopicA TopicA1C81374A
!       └─ [~] DisplayName
!           ├─ [-] Topic A
!           └─ [+] Topic A Change
!      [~] AWS::SNS::Topic TopicB TopicA1C81374B
!       └─ [~] DisplayName
!           ├─ [-] Topic B
!           └─ [+] Topic B Change
!      [~] AWS::SNS::Topic TopicC TopicA1C81374C
!       └─ [~] DisplayName
!           ├─ [-] Topic C
!           └─ [+] Topic C Change
  🏗 wave1stage2
    📦 StackB (wave1_wave1stage2_stack-b)
-      [-] AWS::SNS::Topic TopicBB2A41848 destroy
+      [+] AWS::SNS::TopicPolicy TopicR/Policy TopicRPolicyD33151F3
!      [~] AWS::SNS::Topic TopicR TopicRC70D74C1 replace
!       ├─ [~] DisplayName
!       │   ├─ [-] Topic R
!       │   └─ [+] Topic R can change
!       └─ [~] TopicName (requires replacement)
!           ├─ [-] Topic R
!           └─ [+] Topic R should not change
```

Output After (`HIDE_PROPERTIES` hides all SNS properties first; `HIDE_RESOURCE_IF_EMPTY` then detects the now-empty `~`
resource headers and removes them too):

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (wave1_stage1_stack-a)
!      {Applied Resource Diff Rules: hide-sns-if-empty(3)}
  🏗 wave1stage2
    📦 StackB (wave1_wave1stage2_stack-b)
-      [-] AWS::SNS::Topic TopicBB2A41848 destroy
+      [+] AWS::SNS::TopicPolicy TopicR/Policy TopicRPolicyD33151F3
-      [~] AWS::SNS::Topic TopicR TopicRC70D74C1 replace {Applied Property Diff Rules: hide-sns-display-properties(3)}
!       └─ [~] TopicName (requires replacement)
!           ├─ [-] Topic R
!           └─ [+] Topic R should not change
```

Compare this to the output if we didn't have `HIDE_RESOURCE_IF_EMPTY`:

```diff
🌊 wave1
  🏗 stage1
    📦 StackA (wave1_stage1_stack-a)
!      [~] AWS::SNS::Topic TopicA TopicA1C81374A {Applied Property Diff Rules: hide-sns-display-properties(3)}
!      [~] AWS::SNS::Topic TopicB TopicA1C81374B {Applied Property Diff Rules: hide-sns-display-properties(3)}
!      [~] AWS::SNS::Topic TopicC TopicA1C81374C {Applied Property Diff Rules: hide-sns-display-properties(3)}
    🏗 wave1stage2
        📦 StackB (wave1_wave1stage2_stack-b)
-      [-] AWS::SNS::Topic TopicBB2A41848 destroy
+      [+] AWS::SNS::TopicPolicy TopicR/Policy TopicRPolicyD33151F3
-      [~] AWS::SNS::Topic TopicR TopicRC70D74C1 replace {Applied Property Diff Rules: hide-sns-display-properties(3)}
!       └─ [~] TopicName (requires replacement)
!           ├─ [-] Topic R
!           └─ [+] Topic R should not change
```

</details>

### Print Mode (`mode: 'print'`)

The print mode retrieves cached diff data and updates the pull request description. This mode:

- Retrieves all cached diff data from previous `generate` jobs
- Combines diffs according to the pipeline wave/stage structure
- Updates the pull request description with formatted diff output
- Can combine results from multiple cloud assemblies

**Parameters for Print Mode:**

- `mode`: Set to `'print'` (required)
- `github-token`: GitHub token for API access and caching that needs `pull-requests: write` permission (required)
- `cloud-assembly-directory`: Directory containing the CDK Cloud Assembly (optional, default: `cdk.out`)
- `job-name`: Name of the job, used to link to action/job logs in summaries (optional)
- `cloud-assemblies`: An array of objects representing cloud assemblies to print diffs from (optional). Do not specify
  `cloud-assembly-directory` when using this property as it is the "array" version of `cloud-assembly-directory` and
  allows you to specify multiple assemblies and custom headers. Example Usage:
  ```yaml
  cloud-assemblies: |
    - header: CDK Diff Development
      directory: cdk.out/dev
    - header: CDK Diff Production
      directory: cdk.out/prod
  ```
- `display-timezones`: A YAML array of [IANA timezone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
  names to display alongside UTC in the "Generated At" timestamp (optional). Example Usage:

  ```yaml
  display-timezones: |
    - America/New_York
    - Europe/Paris
    - Asia/Tokyo
  ```

  The timestamp will render compactly as:
  `YYYY-MM-DD HH:MM:SS (UTC) | HH:MM:SS (EST) | HH:MM:SS (CET) | HH:MM:SS (JST)`. If a timezone falls on a different
  calendar date than UTC, a relative day offset is appended, e.g. `HH:MM:SS (+1d) (JST)` or `HH:MM:SS (-1d) (PST)`.

### Basic - Single Job Diff

For simple workflows where you generate and display diffs in a single job.

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
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install dependencies
        run: npm ci
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

### Complex - Parallel Diffs using Matrix

Doing diffs in parallel can significantly speed up the process, especially for large CDK applications with many stacks.
This example shows how you can generate diffs across multiple jobs in parallel and combine the output.

<details>
<summary> Click for Workflow YAML </summary>

```yaml
name: CDK Diff Parallel
on:
  pull_request:
    branches: [main]
jobs:
  generate-diffs:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
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
          stack-selectors: ${{ matrix.selectors }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          job-name: ${{ matrix.job-name }}

  print-diffs:
    needs: generate-diffs
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      id-token: write
    steps:
      - name: Update PR with Combined Diffs
        uses: rehanvdm/cdk-express-pipeline-github-diff@v1
        with:
          mode: 'print'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

</details>

### Advanced - Multiple Cloud Assemblies

You might want to do multiple diffs per environment on a single PR. For example, doing both `dev` and `prod` diffs on
the PR to `main` enables catching issues on `prod` early, before the code is merged to `main`. This can be done by
generating Cloud Assemblies with `cdk synth --output ASSEMBLY_DIR` for each environment and then using their output
directories in the action.

This example does a `**` diff to keep it brief, but you can also do the diffs in parallel using the matrix strategy as
shown above.

<details>
<summary> Click for Workflow YAML </summary>

```yaml
name: Diff Multiple Assemblies
on:
  pull_request:
    branches: [main]
jobs:
  diff-envs:
    name: CDK Diff Environments
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      id-token: write
    strategy:
      matrix:
        include:
          - cloud-assembly-directory: cdk.out/dev
          - cloud-assembly-directory: cdk.out/prod
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4
      - name: Set up node
        uses: actions/setup-node@v3
        with:
          node-version: 20
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/your-github-deploy-role
          aws-region: us-east-1

      - name: CDK Synth
        run: npm run cdk -- synth '**' --output ${{ matrix.cloud-assembly-directory }}
      - name: Generate CDK Diff
        uses: rehanvdm/cdk-express-pipeline-github-diff@feature/init
        with:
          mode: generate
          github-token: ${{ secrets.GITHUB_TOKEN }}
          cloud-assembly-directory: ${{ matrix.cloud-assembly-directory }}

  print-diffs:
    name: CDK Diff and Deploy
    runs-on: ubuntu-latest
    needs:
      - diff-envs
    permissions:
      pull-requests: write
      id-token: write
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4
      - name: Update PR with Diff
        uses: rehanvdm/cdk-express-pipeline-github-diff@feature/init
        with:
          mode: print
          github-token: ${{ secrets.GITHUB_TOKEN }}
          cloud-assemblies: |
            - header: CDK Diff Development
              directory: cdk.out/dev
            - header: CDK Diff Production
              directory: cdk.out/prod
```

Will produce the following:

![advance_pr_description.png](docs/imgs/advance_pr_description.png)

</details>

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

## FAQ

### What happens if I have a big diff and it exceeds the GitHub comment size limit?

The diff will be truncated, 260kb is a lot of space and most will not have this issue. However, if you do hit the limit,
the action will still update the pull request description up to the limit and indicate it was truncated. The full diff
will still be available in the action summary and you can always find it in the action logs.

### Why not place the diff in a comment(s)?

Placing comments creates a lot of noise and can clutter the pull request discussion, especially when doing many parallel
diffs where each diff is a comment. Instead, this action updates the pull request description and action summary with
the diff, providing a cleaner and more organized view of changes. Accepting the 260KB description limit is a trade-off
for a cleaner PR experience.

### Can I use this action with non-Express Pipeline CDK applications?

This action is specifically designed for CDK Express Pipeline applications. It relies on the wave/stage/stack structure
that Express Pipeline provides. For regular CDK applications, you may want to use alternative diff actions.

### How do I handle authentication for the action?

The action requires a GitHub token with `pull-requests: write` permission to update PR descriptions and action
summaries.

## Credits

This action is inspired by [cdk-diff-action](https://github.com/corymhall/cdk-diff-action)

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
