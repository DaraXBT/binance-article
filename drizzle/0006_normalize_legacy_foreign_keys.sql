-- Legacy databases were originally migrated by Prisma, whose foreign-key
-- names differ from Drizzle's names for the same constraints. Normalize only
-- the names so future Drizzle migrations converge on fresh and legacy installs.
DO $$
DECLARE
  mapping record;
  table_oid oid;
  legacy_constraint oid;
  target_constraint oid;
BEGIN
  FOR mapping IN
    SELECT *
    FROM (VALUES
      ('WorkspaceSession', 'WorkspaceSession_workspaceId_fkey', 'WorkspaceSession_workspaceId_Workspace_id_fk'),
      ('DeckProject', 'DeckProject_workspaceId_fkey', 'DeckProject_workspaceId_Workspace_id_fk'),
      ('Slide', 'Slide_deckId_fkey', 'Slide_deckId_DeckProject_id_fk'),
      ('CaptionPackage', 'CaptionPackage_deckId_fkey', 'CaptionPackage_deckId_DeckProject_id_fk'),
      ('RenderAsset', 'RenderAsset_deckId_fkey', 'RenderAsset_deckId_DeckProject_id_fk'),
      ('RenderAsset', 'RenderAsset_jobId_fkey', 'RenderAsset_jobId_JobRun_id_fk'),
      ('JobRun', 'JobRun_deckId_fkey', 'JobRun_deckId_DeckProject_id_fk'),
      ('JobRun', 'JobRun_workspaceId_fkey', 'JobRun_workspaceId_Workspace_id_fk'),
      (
        'GenerationAccessGrant',
        'GenerationAccessGrant_boundWorkspaceId_fkey',
        'GenerationAccessGrant_boundWorkspaceId_Workspace_id_fk'
      )
    ) AS names(table_name, legacy_name, target_name)
  LOOP
    table_oid := to_regclass(format('%I.%I', 'public', mapping.table_name));
    IF table_oid IS NULL THEN
      RAISE EXCEPTION 'Expected legacy table % is missing', mapping.table_name;
    END IF;

    SELECT oid INTO legacy_constraint
    FROM pg_constraint
    WHERE conrelid = table_oid AND conname = mapping.legacy_name;

    SELECT oid INTO target_constraint
    FROM pg_constraint
    WHERE conrelid = table_oid AND conname = mapping.target_name;

    IF legacy_constraint IS NOT NULL AND target_constraint IS NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
        'public',
        mapping.table_name,
        mapping.legacy_name,
        mapping.target_name
      );
    ELSIF legacy_constraint IS NULL AND target_constraint IS NULL THEN
      RAISE EXCEPTION 'Expected foreign key on table % is missing', mapping.table_name;
    ELSIF legacy_constraint IS NOT NULL AND target_constraint IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy and target foreign keys both exist on table %', mapping.table_name;
    END IF;
  END LOOP;
END $$;
