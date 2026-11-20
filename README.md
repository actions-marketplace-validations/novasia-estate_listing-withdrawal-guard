# Listing Withdrawal Guard

A stale import can return a withdrawn property to a public feed even when its
current row looks valid. Listing Withdrawal Guard checks the candidate export
against the team's withdrawal register and fails the GitHub Actions job if a
withdrawn listing is public. An optional preceding export shows which IDs
reappeared and which were already public.

Maintained by [NovAsia Estate](https://novasia.estate/).

## Run it on a pull request

This job reads the candidate feed from the proposed merge and the withdrawal
register from the pull request's base commit. Keep the register and the workflow
under review so a feed change cannot silently authorize its own reinstatement.

```yaml
name: Check listing export
on:
  pull_request:
permissions:
  contents: read
jobs:
  listing-export:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
        with:
          path: candidate
          persist-credentials: false
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
        with:
          ref: ${{ github.event.pull_request.base.sha }}
          path: baseline
          persist-credentials: false
      - uses: novasia-estate/listing-withdrawal-guard@v1.0.0
        with:
          current: candidate/feeds/listings.json
          previous: baseline/feeds/listings.json
          withdrawals: baseline/policy/withdrawals.json
```

Replace `previous` with your actual preceding published export where it differs
from the base branch. Omit it if you only need the withdrawal check. Configure
this job as a required check, or run it immediately before uploading the same
candidate snapshot in a release job.

## Inputs

| Input | Use |
| --- | --- |
| `current` | Required. Candidate snapshot containing objects with `id` and `status`. |
| `withdrawals` | Required. Authoritative register containing objects with `id`, `withdrawnOn`, and optionally `reinstatedOn`. |
| `previous` | Optional. Preceding snapshot with the same format as `current`. |

All files are workspace-relative UTF-8 JSON arrays, one row per ID. Use stable,
case-sensitive string IDs with up to 80 ASCII letters, digits, dots, underscores,
colons or hyphens, beginning with a letter or digit. Prefix IDs when two markets
or feeds can reuse the same number. Use internal listing IDs suitable for logs.

Feed statuses are `listed` and `reserved` for public rows, and `draft` and
`withdrawn` for non-public rows. Convert source-specific statuses before running
the guard. Extra object fields are ignored. Unknown statuses, bad dates and
duplicate IDs fail validation so inconsistent data cannot pass silently.

Keep one record for the latest withdrawal per ID. Use dates in `YYYY-MM-DD`
format. Set `reinstatedOn` only after an approved reinstatement has taken effect.
It must be on or after `withdrawnOn`. Replace the record and drop the
reinstatement date if the listing is withdrawn again. The guard reads completed
events from the register and does not schedule future status changes.

## Results

The action fails if any blocked ID is public in the candidate. The summary
and job log list up to 50 affected IDs. The outputs `violation-count` and
`reappeared-count` always include the complete totals for valid inputs.

| Finding | Meaning |
| --- | --- |
| `reappeared` | The previous snapshot omitted the ID or marked it non-public. |
| `already-public` | Both snapshots show the blocked ID in a public state. |
| `public` | The candidate contains the blocked ID and no previous snapshot was supplied. |

For the supplied synthetic fixtures, `SEA-101` reappears, `SEA-102` was already
public, and `SEA-103` is allowed because it was reinstated. These are examples
and contain no actual property data.

## Run locally

Node.js 24, with no package installation required. Run from the project root.

```sh
node --test
INPUT_CURRENT=examples/candidate.json \
INPUT_PREVIOUS=examples/previous.json \
INPUT_WITHDRAWALS=examples/withdrawals.json \
node src/action.cjs
```

Local exit codes are 0 for a clean snapshot, 1 for violations, and 2 for invalid
inputs. The action makes no network requests. Its output contains affected IDs,
statuses, withdrawal dates and counts. Inputs can each be up to 16 MiB.

MIT licensed. See [examples](examples/) and [tests](test/).
