import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateTeamContributions, loadTeamFile, parseTeamCsv, parseTeamJson } from '../src/team.ts';
import type { FileContribution } from '../src/blame.ts';

test('parseTeamJson reads a JSON team roster', () => {
  assert.deepEqual(parseTeamJson('[{"name":"Alice","email":"alice@example.com"}]'), [
    { name: 'Alice', email: 'alice@example.com' },
  ]);
});

test('parseTeamCsv reads a CSV team roster', () => {
  assert.deepEqual(parseTeamCsv('name,email\nAlice,alice@example.com'), [
    { name: 'Alice', email: 'alice@example.com' },
  ]);
});

test('parseTeamCsv handles quoted fields containing commas', () => {
  assert.deepEqual(parseTeamCsv('name,email\n"Smith, Alice",alice@example.com'), [
    { name: 'Smith, Alice', email: 'alice@example.com' },
  ]);
});

test('parseTeamCsv handles escaped double-quotes inside quoted fields', () => {
  assert.deepEqual(parseTeamCsv('name,email\n"Alice ""A"" Smith",alice@example.com'), [
    { name: 'Alice "A" Smith', email: 'alice@example.com' },
  ]);
});

test('parseTeamCsv handles multiple rows with quoted fields', () => {
  assert.deepEqual(
    parseTeamCsv('name,email\n"Smith, Alice",alice@example.com\nBob,bob@example.com'),
    [
      { name: 'Smith, Alice', email: 'alice@example.com' },
      { name: 'Bob', email: 'bob@example.com' },
    ]
  );
});

test('parseTeamCsv throws when required columns are missing', () => {
  assert.throws(() => parseTeamCsv('handle,email\nAlice,alice@example.com'), /name and email headers/);
});

test('loadTeamFile falls back based on content when the extension is unknown', () => {
  const roster = loadTeamFile('team.roster', () => '[{"name":"Bob","email":"bob@example.com"}]');

  assert.deepEqual(roster, [{ name: 'Bob', email: 'bob@example.com' }]);
});

test('aggregateTeamContributions groups unmatched contributors as external', () => {
  const contributions: FileContribution[] = [
    {
      filePath: 'src/api.ts',
      authorEmail: 'alice@example.com',
      authorName: 'Alice',
      lines: 4,
      lastModified: '2024-06-10',
      changeType: 'modified',
    },
    {
      filePath: 'src/auth.ts',
      authorEmail: 'alice@example.com',
      authorName: 'Alice',
      lines: 2,
      lastModified: '2024-06-10',
      changeType: 'modified',
    },
    {
      filePath: 'src/auth.ts',
      authorEmail: 'vendor@example.com',
      authorName: 'Vendor',
      lines: 3,
      lastModified: '2024-06-09',
      changeType: 'modified',
    },
  ];

  const result = aggregateTeamContributions(contributions, [{ name: 'Alice', email: 'alice@example.com' }]);

  assert.deepEqual(result, [
    {
      label: 'alice@example.com',
      lines: 6,
      files: 2,
      percent: 67,
      bar: '####################',
    },
    {
      label: '[external]',
      lines: 3,
      files: 1,
      percent: 33,
      bar: '##########',
    },
  ]);
});
