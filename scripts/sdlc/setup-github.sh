#!/usr/bin/env bash
# One-time GitHub setup for the SDLC in docs/sdlc.md: squash-only auto-merge, the labels
# the risk gate uses, and branch protection on main (PR + green `ci` and `risk-gate`,
# admins included, no force pushes). Run by the owner after main exists on GitHub.
set -euo pipefail

repo="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

gh repo edit "$repo" \
  --enable-auto-merge \
  --delete-branch-on-merge \
  --enable-squash-merge \
  --enable-merge-commit=false \
  --enable-rebase-merge=false

gh label create risk:high --repo "$repo" --force --color B60205 --description "Set by the risk gate"
gh label create risk:low --repo "$repo" --force --color 0E8A16 --description "Set by the risk gate"
gh label create human-approved --repo "$repo" --force --color 1D76DB --description "Owner reviewed the focus items; lets a high-risk PR merge"
gh label create needs-owner-review --repo "$repo" --force --color FBCA04 --description "Owner forces high risk on this PR"

gh api -X PUT "repos/$repo/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["ci", "risk-gate"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

echo "GitHub is set up for $repo."
