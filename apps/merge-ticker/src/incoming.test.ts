import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { elementsById, overflowingText, textOf } from '@busy-bar-apps/bar-kit';

import { readIncoming } from './incoming.ts';
import { renderIncoming } from './render-incoming.ts';

const stamp = '2026-11-24T10:00:00Z';
const base = { version: 1, scope: 'acme/web', observedAt: stamp, requests: [] };
const row = {
  pr: 'acme/web#3',
  state: 'ready',
  waitingSince: stamp,
  waitingFrom: 'requested',
};
describe('incoming review snapshots', () => {
  let directory = '',
    path = '';
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'incoming-'));
    path = join(directory, 'incoming.json');
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it('shows each personal request, with the oldest ready PR first', async () => {
    await writeFile(
      path,
      JSON.stringify({
        ...base,
        requests: [
          {
            ...row,
            pr: 'acme/web#1',
            state: 'not-ready',
            waitingFrom: 'opened',
          },
          row,
          { ...row, pr: 'acme/web#2', waitingSince: '2026-11-24T08:00:00Z' },
        ],
      }),
    );
    const queue = await readIncoming(path);
    const frame = renderIncoming(new Date(stamp), queue, false);
    const words = elementsById(frame);
    expect(textOf(words, 'badge')).toBe('3');
    expect(textOf(words, 'headline')).toBe('TO REVIEW');
    expect(textOf(words, 'summary')).toBe('2 READY');
    expect(textOf(words, 'row-0')).toBe('#2');
    expect(textOf(words, 'state-0')).toBe('READY');
    expect(textOf(words, 'wait-0')).toBe('2h');
    expect(words.has('ready-0')).toBe(true);
    expect(textOf(words, 'row-2')).toBe('#1');
    expect(textOf(words, 'state-2')).toBe('BLOCKED');
    expect(textOf(words, 'wait-2')).toBe('~now');
    expect(words.has('ready-2')).toBe(false);
    expect(overflowingText(frame)).toEqual([]);
    const stale = elementsById(
      renderIncoming(new Date('2026-11-24T10:15:00Z'), queue, true),
    );
    expect(textOf(stale, 'headline')).toBe('STALE');
    expect(textOf(stale, 'footer')).toContain('15m');
  });
  it('distinguishes a successful empty snapshot from missing data', async () => {
    await writeFile(path, JSON.stringify({ ...base, scope: 'all' }));
    const words = elementsById(
      renderIncoming(new Date(stamp), await readIncoming(path), false),
    );
    expect(textOf(words, 'headline')).toBe('CLEAR');
    expect(textOf(words, 'header')).toBe('All repositories');
    for (const failed of [true, false]) {
      expect(
        textOf(
          elementsById(renderIncoming(new Date(stamp), undefined, failed)),
          'headline',
        ),
      ).toBe('NO DATA');
    }
  });
  it('preserves PR numbers and compares waits against the same scale on every page', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      ...row,
      pr: `long-owner/long-repository-name#${101 + i}`,
      state: 'check',
      waitingSince: i === 5 ? '2026-11-24T09:00:00Z' : '2026-11-24T08:00:00Z',
    }));
    await writeFile(
      path,
      JSON.stringify({ ...base, scope: 'all', requests: rows }),
    );
    const queue = await readIncoming(path);
    const first = elementsById(renderIncoming(new Date(stamp), queue, false));
    const nextFrame = renderIncoming(
      new Date('2026-11-24T10:00:08Z'),
      queue,
      false,
    );
    const next = elementsById(nextFrame);
    expect(textOf(first, 'row-0')).toMatch(/\.\.#101$/u);
    expect(textOf(next, 'row-0')).toMatch(/\.\.#106$/u);
    expect(textOf(first, 'page')).toBe('1/2');
    expect(textOf(next, 'page')).toBe('2/2');
    expect(next.has('row-1')).toBe(false);
    expect(first.get('age-bar-0')).toMatchObject({
      type: 'rectangle',
      width: 29,
    });
    expect(next.get('age-bar-0')).toMatchObject({
      type: 'rectangle',
      width: 15,
    });
    expect(overflowingText(nextFrame)).toEqual([]);
  });
  it.each([
    [null, 'snapshot'],
    [{ ...base, requests: [{ ...row, pr: 'broken' }] }, 'reference'],
    [{ ...base, requests: [null] }, 'request'],
    [{ ...base, requests: [{ ...row, state: 'unknown' }] }, 'readiness'],
    [{ ...base, observedAt: 'yesterday' }, 'timestamp'],
    [
      { ...base, requests: [{ ...row, waitingSince: 'nonsenseZ' }] },
      'timestamp',
    ],
  ])('rejects invalid observations', async (value, message) => {
    await writeFile(path, JSON.stringify(value));
    await expect(readIncoming(path)).rejects.toThrow(message);
  });
});
