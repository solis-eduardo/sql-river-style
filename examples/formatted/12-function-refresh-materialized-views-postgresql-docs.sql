-- Fonte: PostgreSQL Documentation, "43.6. Control Structures" (loop sobre
-- consulta ao catálogo, exemplo "Refreshing Materialized Views")
-- https://www.postgresql.org/docs/current/plpgsql-control-structures.html (PostgreSQL License)
-- FOR ... IN <query> LOOP percorrendo pg_class/pg_namespace, com RAISE
-- NOTICE e EXECUTE format() dentro do laço.
CREATE FUNCTION refresh_mviews()
RETURNS INTEGER
AS $$
DECLARE
    mviews RECORD;
BEGIN
    RAISE NOTICE 'Refreshing all materialized views...';

    FOR mviews IN SELECT n.nspname as mv_schema, c.relname as mv_name, pg_catalog.pg_get_userbyid(c.relowner) as owner FROM pg_catalog.pg_class c LEFT JOIN pg_catalog.pg_namespace n ON (n.oid = c.relnamespace) WHERE c.relkind = 'm' ORDER BY 1
    LOOP
        -- Now "mviews" has one record with information about the materialized view
        RAISE NOTICE 'Refreshing materialized view %.% (owner: %)...', QUOTE_IDENT(mviews.mv_schema), QUOTE_IDENT(mviews.mv_name), QUOTE_IDENT(mviews.owner);

        EXECUTE FORMAT('REFRESH MATERIALIZED VIEW %I.%I', mviews.mv_schema, mviews.mv_name);
    END LOOP;

    RAISE NOTICE 'Done refreshing materialized views.';

    RETURN 1;
END;
$$
LANGUAGE plpgsql;
