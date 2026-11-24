import { readFile } from 'node:fs/promises';

import { isObject } from '@busy-bar-apps/json-values';

export interface ReviewRequest {
  readonly pr: string;
  readonly state: 'ready' | 'check' | 'not-ready' | 'draft';
  readonly waiting: Date;
  readonly estimate: boolean;
}

export interface IncomingQueue {
  readonly scope: string;
  readonly observed: Date;
  readonly requests: readonly ReviewRequest[];
}

function timestamp(value: unknown): Date {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/u.test(value)) {
    throw new Error('Missing Trackbed timestamp');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Invalid Trackbed timestamp');
  }
  return date;
}

function request(value: unknown): ReviewRequest {
  if (!isObject(value) || typeof value['pr'] !== 'string') {
    throw new Error('Invalid Trackbed review request');
  }
  if (!/^[\w.-]+\/[\w.-]+#\d+$/u.test(value['pr'])) {
    throw new Error('Invalid Trackbed PR reference');
  }
  const state = value['state'];
  if (
    state !== 'ready' &&
    state !== 'check' &&
    state !== 'not-ready' &&
    state !== 'draft'
  ) {
    throw new Error('Unknown Trackbed review readiness');
  }
  return {
    pr: value['pr'],
    state,
    waiting: timestamp(value['waitingSince']),
    estimate: value['waitingFrom'] === 'opened',
  };
}

export async function readIncoming(path: string): Promise<IncomingQueue> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (
    !isObject(value) ||
    value['version'] !== 1 ||
    typeof value['scope'] !== 'string' ||
    !Array.isArray(value['requests'])
  ) {
    throw new Error('Invalid Trackbed incoming snapshot');
  }
  const requests = value['requests']
    .map(request)
    .sort(
      (a, b) =>
        Number(b.state === 'ready') - Number(a.state === 'ready') ||
        a.waiting.getTime() - b.waiting.getTime() ||
        a.pr.localeCompare(b.pr),
    );
  return {
    scope: value['scope'],
    observed: timestamp(value['observedAt']),
    requests,
  };
}
