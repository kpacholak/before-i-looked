import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';

// The dash that null owners render as (styleguide: missing data renders as a dash).
const DASH = '\u2014';

const GOOD_NIGHT = '2026-01-01';
const MISSING_NIGHT = '2026-01-02';
const EMPTY_NIGHT = '2026-01-03';
const BAD_NIGHT = '2026-01-04';

const JOBS = ['a/job', 'b/job', 'c/job'];

const good = [
  '{"at":"2026-01-01T01:00:00+01:00","job":"b/job","status":"ok","owner":"ana"}',
  '{"at":"2026-01-01T01:05:00+01:00","job":"a/job","status":"retry","owner":null,"error":"x"}',
  '{"at":"2026-01-01T01:10:00+01:00","job":"a/job","status":"retry","owner":null,"error":"x"}',
  '{"at":"2026-01-01T01:15:00+01:00","job":"a/job","status":"retry","owner":null,"error":"x"}',
  '{"at":"2026-01-01T01:20:00+01:00","job":"c/job","status":"fail","owner":"bo","error":"boom"}',
].join('\n');

const bad = [
  '{"at":"2026-01-04T01:00:00+01:00","job":"b/job","status":"ok","owner":"ana"}',
  '{"at":',
  '{"at":"2026-01-04T01:30:00+01:00","job":"a/job","status":"ok","owner":null}',
].join('\n');

let runsDir: string;
let config: RigConfig;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'digest-routes-'));
  writeFileSync(join(runsDir, `${GOOD_NIGHT}.jsonl`), good + '\n');
  writeFileSync(join(runsDir, `${EMPTY_NIGHT}.jsonl`), '');
  writeFileSync(join(runsDir, `${BAD_NIGHT}.jsonl`), bad + '\n');
  config = {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// The table row (<tr>...</tr>) that mentions this job.
function rowFor(html: string, job: string): string {
  const row = html.split('</tr>').find((segment) => segment.includes(job));
  if (row === undefined) throw new Error(`no row for ${job}`);
  return row;
}

describe('digest page', () => {
  it('lists every job in the night', async () => {
    const res = await createApp(config).request(`/digest/${GOOD_NIGHT}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    for (const job of JOBS) expect(html).toContain(job);
  });

  it('returns 404 for a night with no file', async () => {
    const res = await createApp(config).request(`/digest/${MISSING_NIGHT}`);
    expect(res.status).toBe(404);
  });

  it('says nothing ran for an empty file', async () => {
    const res = await createApp(config).request(`/digest/${EMPTY_NIGHT}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
  });

  it('keeps the valid jobs and reports a line that did not parse', async () => {
    const res = await createApp(config).request(`/digest/${BAD_NIGHT}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('a/job');
    expect(html).toContain('b/job');
    expect(html).toContain('did not parse');
  });

  it('marks rows with 3 or more retries, or a last status of fail, as warn', async () => {
    const res = await createApp(config).request(`/digest/${GOOD_NIGHT}`);
    const html = await res.text();
    expect(rowFor(html, 'a/job')).toContain('<tr class="warn">');
    expect(rowFor(html, 'c/job')).toContain('<tr class="warn">');
    expect(rowFor(html, 'b/job')).not.toContain('class="warn"');
  });

  it('renders a null owner as a dash', async () => {
    const res = await createApp(config).request(`/digest/${GOOD_NIGHT}`);
    const html = await res.text();
    expect(rowFor(html, 'a/job')).toContain(DASH);
  });
});

describe('digest JSON', () => {
  it('returns the night with rows and badLines', async () => {
    const res = await createApp(config).request(`/api/digest/${GOOD_NIGHT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      night: string;
      rows: { job: string; retries: number; lastStatus: string }[];
      badLines: number;
    };
    expect(body.night).toBe(GOOD_NIGHT);
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => r.job)).toEqual(JOBS);
    const a = body.rows.find((r) => r.job === 'a/job');
    expect(a?.retries).toBe(3);
    expect(a?.lastStatus).toBe('retry');
  });

  it('returns 404 with an error for a night with no file', async () => {
    const res = await createApp(config).request(`/api/digest/${MISSING_NIGHT}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: MISSING_NIGHT });
  });

  it('gives no rows for an empty file', async () => {
    const res = await createApp(config).request(`/api/digest/${EMPTY_NIGHT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; badLines: number };
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('counts a bad line and keeps the valid rows', async () => {
    const res = await createApp(config).request(`/api/digest/${BAD_NIGHT}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { job: string }[]; badLines: number };
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['a/job', 'b/job']);
  });

  it('keeps owner null as null', async () => {
    const res = await createApp(config).request(`/api/digest/${GOOD_NIGHT}`);
    const body = (await res.json()) as { rows: { job: string; owner: string | null }[] };
    const a = body.rows.find((r) => r.job === 'a/job');
    expect(a?.owner).toBeNull();
    const b = body.rows.find((r) => r.job === 'b/job');
    expect(b?.owner).toBe('ana');
  });

  it('sorts rows by job', async () => {
    const res = await createApp(config).request(`/api/digest/${GOOD_NIGHT}`);
    const body = (await res.json()) as { rows: { job: string }[] };
    const jobs = body.rows.map((r) => r.job);
    expect(jobs).toEqual([...jobs].sort());
  });

  it('lists jobs in the same order as the HTML table', async () => {
    const jsonRes = await createApp(config).request(`/api/digest/${GOOD_NIGHT}`);
    const body = (await jsonRes.json()) as { rows: { job: string }[] };
    const jsonOrder = body.rows.map((r) => r.job);

    const htmlRes = await createApp(config).request(`/digest/${GOOD_NIGHT}`);
    const html = await htmlRes.text();
    const htmlOrder = [...jsonOrder].sort((x, y) => html.indexOf(x) - html.indexOf(y));
    expect(htmlOrder).toEqual(jsonOrder);
  });
});
