// How many clips the user asked for. Nullable: rows created before this existed,
// and callers that don't say, get the configured default at job-creation time.
exports.up = async function up(knex) {
  await knex.schema.alterTable('media_imports', (t) => {
    t.smallint('requested_clip_count');
  });
  await knex.schema.alterTable('processing_jobs', (t) => {
    t.smallint('requested_clip_count');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('processing_jobs', (t) => {
    t.dropColumn('requested_clip_count');
  });
  await knex.schema.alterTable('media_imports', (t) => {
    t.dropColumn('requested_clip_count');
  });
};
