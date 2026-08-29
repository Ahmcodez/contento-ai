exports.up = async function up(knex) {
  // usage_records is an append-only audit ledger (docs/DATABASE.md) that
  // must survive deletion of the job it references — it currently has no
  // ON DELETE behavior, which means deleting a media_asset (which
  // cascades to processing_jobs) would fail with a foreign key violation
  // the moment any usage_records row exists for that job. SET NULL keeps
  // the ledger row (and its cost/audit value) while dropping the
  // now-dangling traceability link.
  await knex.raw('ALTER TABLE usage_records DROP CONSTRAINT usage_records_processing_job_id_foreign');
  await knex.raw(`
    ALTER TABLE usage_records
    ADD CONSTRAINT usage_records_processing_job_id_foreign
    FOREIGN KEY (processing_job_id) REFERENCES processing_jobs(id) ON DELETE SET NULL
  `);

  // Missing indexes found in review:
  // - media_assets.uploaded_by: joined in the "active jobs for user"
  //   quota check (processingJob.repository.js countActiveForUser) and
  //   every ownership-adjacent query touching a user's uploads.
  await knex.schema.alterTable('media_assets', (t) => {
    t.index('uploaded_by');
  });

  // - refresh_tokens.expires_at: needed for the token-cleanup query
  //   (scripts/cleanup.js) to find expired rows without a full table scan
  //   as this table grows.
  await knex.schema.alterTable('refresh_tokens', (t) => {
    t.index('expires_at');
  });

  // transcript_segments never got the same end_ms > start_ms guard that
  // clip_candidates has — documented in docs/DATABASE.md but not actually
  // enforced in the original migration.
  await knex.raw('ALTER TABLE transcript_segments ADD CONSTRAINT transcript_segments_end_after_start CHECK (end_ms > start_ms)');
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE transcript_segments DROP CONSTRAINT transcript_segments_end_after_start');

  await knex.schema.alterTable('refresh_tokens', (t) => {
    t.dropIndex('expires_at');
  });

  await knex.schema.alterTable('media_assets', (t) => {
    t.dropIndex('uploaded_by');
  });

  await knex.raw('ALTER TABLE usage_records DROP CONSTRAINT usage_records_processing_job_id_foreign');
  await knex.raw(`
    ALTER TABLE usage_records
    ADD CONSTRAINT usage_records_processing_job_id_foreign
    FOREIGN KEY (processing_job_id) REFERENCES processing_jobs(id)
  `);
};
