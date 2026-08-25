const db = require('../db/client');

async function upsertPending(clipCandidateId) {
  const existing = await db('generated_clips').where({ clip_candidate_id: clipCandidateId }).first();
  if (existing) {
    const [row] = await db('generated_clips')
      .where({ id: existing.id })
      .update({ render_status: 'pending', render_error: null, updated_at: db.fn.now() })
      .returning('*');
    return row;
  }
  const [row] = await db('generated_clips')
    .insert({ clip_candidate_id: clipCandidateId, render_status: 'pending' })
    .returning('*');
  return row;
}

async function markRendering(clipCandidateId) {
  const [row] = await db('generated_clips')
    .where({ clip_candidate_id: clipCandidateId })
    .update({ render_status: 'rendering', updated_at: db.fn.now() })
    .returning('*');
  return row;
}

async function markRendered(clipCandidateId, { storageKey, thumbnailStorageKey, subtitleStorageKey, durationSeconds }) {
  const [row] = await db('generated_clips')
    .where({ clip_candidate_id: clipCandidateId })
    .update({
      render_status: 'rendered',
      storage_key: storageKey,
      thumbnail_storage_key: thumbnailStorageKey,
      subtitle_storage_key: subtitleStorageKey,
      duration_seconds: durationSeconds,
      updated_at: db.fn.now(),
    })
    .returning('*');
  return row;
}

async function markFailed(clipCandidateId, error) {
  const [row] = await db('generated_clips')
    .where({ clip_candidate_id: clipCandidateId })
    .update({ render_status: 'failed', render_error: error, updated_at: db.fn.now() })
    .returning('*');
  return row;
}

async function findByClipCandidateId(clipCandidateId) {
  return db('generated_clips').where({ clip_candidate_id: clipCandidateId }).first();
}

module.exports = { upsertPending, markRendering, markRendered, markFailed, findByClipCandidateId };
