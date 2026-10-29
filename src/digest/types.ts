// Plan morning-digest § 1. The shape every part of § 2 builds against: one row per job in a
// night's run log (runs/<night>.jsonl).

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of the run log, after parsing.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

export type DigestRow = {
  job: string;
  // null renders as `—` (styleguide: missing data is never dropped).
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  // As written in the log, offset kept; never converted to UTC.
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string;
  // Sorted by job.
  rows: DigestRow[];
  // Lines that did not parse. Counted, never thrown.
  badLines: number;
};

// Reads runs/<night>.jsonl. Returns null when the night has no file; an empty file gives a
// Night with no rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;
