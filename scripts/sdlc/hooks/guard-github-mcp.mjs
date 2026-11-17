#!/usr/bin/env node
// PreToolUse hook for GitHub MCP tools (matcher `mcp__.*github.*` in .claude/settings.json). The shell
// guard (guard-shell.mjs) only sees Bash and PowerShell; this one blocks the same owner-only actions
// when they go through an MCP tool: merging or auto-merging, approving, resolving review threads, and
// adding the owner's approval label. Claude runs with the owner's account, so this guards against
// mistakes; it is not a security boundary.
// Exit code 2 blocks the call and sends stderr back to Claude.
import { readFileSync } from 'node:fs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {}
const tool = String(input.tool_name ?? '');
const args = input.tool_input ?? {};

const name = tool.replace(/^mcp__.*?__/, '');
const method = String(args.method ?? '').toLowerCase();
const event = String(args.event ?? '').toUpperCase();

if (/(^|_)merge_pull_request$|pr_auto_merge$/.test(name)) {
  block('Merging is done by the risk gate (low risk) or by the owner (high risk). Open the PR and stop.');
}
if (/(un)?resolve_review_thread$/.test(name) || /(un)?resolve_thread/.test(method)) {
  block('Only the owner resolves review threads. Reply in the thread and leave it open.');
}
if (event === 'APPROVE') {
  block('Claude does not approve pull requests.');
}
// Labels: look only at the fields that set them (`labels` on any tool, and `label`/`name` on a label
// tool), so a PR description or comment that merely mentions a label is fine.
const labelTool = /label/i.test(name) || /label/i.test(method);
const labelValues = [args.labels, labelTool ? args.label : undefined, labelTool ? args.name : undefined]
  .flat()
  .filter((v) => v !== undefined && v !== null)
  .map((v) => String(typeof v === 'object' ? (v.name ?? JSON.stringify(v)) : v));
if (labelValues.some((v) => /^\s*human-approved\s*$/i.test(v))) {
  block('Only the owner gives the human-approved label.');
}
if (labelValues.some((v) => /^\s*(risk:(high|low)|needs-owner-review)\s*$/i.test(v))) {
  block('Risk labels are set by the risk gate and the owner.');
}

process.exit(0);

function block(reason) {
  process.stderr.write(`Blocked by scripts/sdlc/hooks/guard-github-mcp.mjs: ${reason}\n`);
  process.exit(2);
}
