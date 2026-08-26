/**
 * Minimal in-process counters for the things docs/OPERATIONS.md asks to
 * track: job failures, processing time, API errors, AI provider errors,
 * queue failures, storage failures. This is deliberately not Prometheus/
 * Datadog/etc — those cost money or require infra this project doesn't
 * need yet. It's a free, always-available baseline; see
 * docs/OPERATIONS.md for what to add in production.
 *
 * Counters reset on process restart — that's fine for the dev/small-scale
 * use case this serves. Durable history lives in the DB
 * (processing_errors, processing_job_events, usage_records), not here.
 */
const counters = new Map();
const durationSamples = new Map(); // stage -> last N durations, for a rough p50/p95

const MAX_SAMPLES = 200;

function increment(name, labels = {}) {
  const key = formatKey(name, labels);
  counters.set(key, (counters.get(key) || 0) + 1);
}

function recordDuration(stage, ms) {
  if (!durationSamples.has(stage)) durationSamples.set(stage, []);
  const samples = durationSamples.get(stage);
  samples.push(ms);
  if (samples.length > MAX_SAMPLES) samples.shift();
}

function formatKey(name, labels) {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return labelStr ? `${name}{${labelStr}}` : name;
}

function percentile(samples, p) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function snapshot() {
  const durations = {};
  for (const [stage, samples] of durationSamples.entries()) {
    durations[stage] = {
      count: samples.length,
      p50Ms: percentile(samples, 50),
      p95Ms: percentile(samples, 95),
    };
  }
  return {
    counters: Object.fromEntries(counters),
    durations,
  };
}

module.exports = { increment, recordDuration, snapshot };
