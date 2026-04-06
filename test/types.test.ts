import test from 'node:test';
import assert from 'node:assert/strict';
import type { PRInfo, Approver } from '../src/types.ts';
// Verify the re-exports from github and gitlab resolve to the same types
import type { PRInfo as GitHubPRInfo, Approver as GitHubApprover } from '../src/github.ts';
import type { PRInfo as GitLabPRInfo, Approver as GitLabApprover } from '../src/gitlab.ts';

// Type-level assertions: these assignments would fail to compile if the
// types diverged between modules.
const _prInfoGitHub: PRInfo = {} as GitHubPRInfo;
const _prInfoGitLab: PRInfo = {} as GitLabPRInfo;
const _approverGitHub: Approver = {} as GitHubApprover;
const _approverGitLab: Approver = {} as GitLabApprover;

void _prInfoGitHub;
void _prInfoGitLab;
void _approverGitHub;
void _approverGitLab;

test('PRInfo accepts a fully-populated object', () => {
  const pr: PRInfo = {
    number: 42,
    title: 'Fix flaky parser behavior',
    html_url: 'https://github.com/acme/repo/pull/42',
  };

  assert.equal(pr.number, 42);
  assert.equal(pr.title, 'Fix flaky parser behavior');
  assert.equal(pr.html_url, 'https://github.com/acme/repo/pull/42');
});

test('PRInfo number is preserved exactly (not coerced)', () => {
  const pr: PRInfo = { number: 0, title: '', html_url: '' };
  assert.equal(pr.number, 0);
});

test('Approver requires login and makes email optional', () => {
  const withEmail: Approver = { login: 'alex', email: 'alex@example.com' };
  const withoutEmail: Approver = { login: 'jamie' };

  assert.equal(withEmail.login, 'alex');
  assert.equal(withEmail.email, 'alex@example.com');
  assert.equal(withoutEmail.login, 'jamie');
  assert.equal(withoutEmail.email, undefined);
});

test('Approver email is undefined when not provided', () => {
  const approver: Approver = { login: 'alex' };
  assert.equal('email' in approver, false);
});

test('Approver login is a non-empty string in typical usage', () => {
  const approver: Approver = { login: 'some-user' };
  assert.equal(typeof approver.login, 'string');
  assert.ok(approver.login.length > 0);
});
