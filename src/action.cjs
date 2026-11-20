'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { audit } = require('./guard.cjs');

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_VISIBLE_ROWS = 50;

function readInput(root, file, label) {
  if (!file || path.isAbsolute(file)) {
    throw new Error(`${label} must be a workspace-relative file path.`);
  }
  let realFile;
  try {
    realFile = fs.realpathSync(path.resolve(root, file));
  } catch {
    throw new Error(`${label} could not be opened.`);
  }
  const relative = path.relative(root, realFile);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`${label} must resolve inside the workspace.`);
  }
  let content;
  try {
    const stat = fs.statSync(realFile);
    if (stat.isFile() && stat.size <= MAX_FILE_BYTES) {
      content = fs.readFileSync(realFile, 'utf8');
    }
  } catch {
    throw new Error(`${label} could not be read.`);
  }
  if (content === undefined) {
    throw new Error(`${label} must be a regular file of at most 16 MiB.`);
  }
  try {
    return JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function report(rows, env, write) {
  const visible = rows.slice(0, MAX_VISIBLE_ROWS);
  const omitted = rows.length - visible.length;
  const reappeared = rows.filter(row => row.kind === 'reappeared').length;
  const count = rows.length;
  if (env.GITHUB_OUTPUT) {
    fs.appendFileSync(env.GITHUB_OUTPUT,
      `violation-count=${count}\nreappeared-count=${reappeared}\n`);
  }
  const headline = count ? `${count} withdrawn listing(s) in a public state.` : 'No withdrawn listings in public states.';
  const summary = ['## Listing Withdrawal Guard', '', headline];
  if (count) {
    summary.push('', '| Listing ID | Finding | Public state | Withdrawn on |', '| --- | --- | --- | --- |');
    for (const row of visible) {
      summary.push(`| \`${row.id}\` | ${row.kind} | ${row.status} | ${row.withdrawnOn} |`);
    }
    if (omitted) summary.push('', `${omitted} more finding(s) omitted from this summary.`);
    write(`::error title=Withdrawn listings in public export::${headline}`);
    for (const row of visible) write(`${row.id}: ${row.kind} (${row.status})`);
  } else {
    write(headline);
  }
  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
  }
  return count ? 1 : 0;
}

function run(env = process.env, write = console.log) {
  const root = fs.realpathSync(env.GITHUB_WORKSPACE || process.cwd());
  const previousPath = env.INPUT_PREVIOUS;
  const current = readInput(root, env.INPUT_CURRENT, 'Current snapshot');
  const withdrawals = readInput(root, env.INPUT_WITHDRAWALS, 'Withdrawal register');
  const previous = previousPath ? readInput(root, previousPath, 'Previous snapshot') : undefined;
  return report(audit(current, withdrawals, previous), env, write);
}

if (require.main === module) {
  try {
    process.exitCode = run();
  } catch (error) {
    const message = error.message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.error(`::error title=Listing Withdrawal Guard::${message}`);
    process.exitCode = 2;
  }
}

module.exports = { run };
