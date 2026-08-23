exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS citext');

  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.specificType('email', 'citext').notNullable().unique();
    t.text('password_hash').notNullable();
    t.text('name');
    t.timestamp('email_verified_at');
    t.enu('plan', ['free', 'pro']).notNullable().defaultTo('free');
    t.timestamp('deleted_at');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('workspaces', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('name').notNullable();
    t.uuid('owner_id').notNullable().references('id').inTable('users');
    t.boolean('is_personal').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index('owner_id');
  });

  await knex.schema.createTable('workspace_members', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.enu('role', ['owner', 'editor', 'viewer']).notNullable().defaultTo('owner');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['workspace_id', 'user_id']);
    t.index('user_id');
  });

  await knex.schema.createTable('refresh_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('token_hash').notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('revoked_at');
    t.uuid('replaced_by_id');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index('user_id');
  });

  await knex.schema.createTable('projects', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.text('title').notNullable();
    t.text('description');
    t.enu('status', ['active', 'archived']).notNullable().defaultTo('active');
    t.uuid('created_by').notNullable().references('id').inTable('users');
    t.timestamps(true, true);
    t.index('workspace_id');
    t.index(['workspace_id', 'status']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('projects');
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('workspace_members');
  await knex.schema.dropTableIfExists('workspaces');
  await knex.schema.dropTableIfExists('users');
};
