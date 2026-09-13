// The frontend needs to navigate straight to the resulting job's detail
// page the instant an import completes (exactly like the upload flow
// already does with the processingJob returned from its upload
// response) — media_imports previously only stored media_asset_id, but
// a media asset's processing job isn't derivable without this column
// short of an extra lookup query on every poll.
exports.up = async function up(knex) {
  await knex.schema.alterTable('media_imports', (t) => {
    t.uuid('processing_job_id').references('id').inTable('processing_jobs').onDelete('SET NULL');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('media_imports', (t) => {
    t.dropColumn('processing_job_id');
  });
};
