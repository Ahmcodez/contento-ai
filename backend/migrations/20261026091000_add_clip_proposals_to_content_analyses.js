// Clip proposals made while the transcript was analysed, stored as line-id spans
// (hook line .. last line of the explanation). Clip detection then selects from
// these with no second AI pass over the whole transcript.
exports.up = async function up(knex) {
  await knex.schema.alterTable('content_analyses', (t) => {
    t.jsonb('clip_proposals').notNullable().defaultTo('[]');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('content_analyses', (t) => {
    t.dropColumn('clip_proposals');
  });
};
