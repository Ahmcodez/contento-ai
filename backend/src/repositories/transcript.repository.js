const db = require('../db/client');

/**
 * Replaces any existing transcript for the asset instead of failing on the
 * unique(media_asset_id) constraint. A stage can legitimately run twice
 * (BullMQ retry after a crash past this point, or a reaper re-enqueue), and
 * the second run must not die on a duplicate key. Segments go with the old
 * transcript via ON DELETE CASCADE.
 */
async function create({ mediaAssetId, fullText, language, provider, rawProviderResponse, segments }) {
  return db.transaction(async (trx) => {
    await trx('transcripts').where({ media_asset_id: mediaAssetId }).del();

    const [transcript] = await trx('transcripts')
      .insert({
        media_asset_id: mediaAssetId,
        full_text: fullText,
        language,
        provider,
        raw_provider_response: rawProviderResponse ? JSON.stringify(rawProviderResponse) : null,
      })
      .returning('*');

    if (segments && segments.length > 0) {
      const rows = segments.map((s, i) => ({
        transcript_id: transcript.id,
        sequence: i,
        start_ms: s.startMs,
        end_ms: s.endMs,
        text: s.text,
        speaker_label: s.speakerLabel || null,
        word_timestamps: s.wordTimestamps ? JSON.stringify(s.wordTimestamps) : null,
      }));
      await trx('transcript_segments').insert(rows);
    }

    return transcript;
  });
}

async function findByMediaAssetId(mediaAssetId) {
  return db('transcripts').where({ media_asset_id: mediaAssetId }).first();
}

async function findSegments(transcriptId) {
  return db('transcript_segments').where({ transcript_id: transcriptId }).orderBy('sequence', 'asc');
}

async function findSegmentsInRange(transcriptId, startMs, endMs) {
  return db('transcript_segments')
    .where({ transcript_id: transcriptId })
    .andWhere('start_ms', '<', endMs)
    .andWhere('end_ms', '>', startMs)
    .orderBy('sequence', 'asc');
}

module.exports = { create, findByMediaAssetId, findSegments, findSegmentsInRange };
