-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: parâmetro posicional do PL/pgSQL ($1, $2...) não é confundido com
-- tag de dollar-quote
CREATE FUNCTION myfunc(refcursor, refcursor)
RETURNS setof REFCURSOR
AS $$
BEGIN
    OPEN $1 FOR SELECT * FROM table_1;

    RETURN NEXT $1;

    OPEN $2 FOR SELECT * FROM table_2;

    RETURN NEXT $2;
END;
$$
LANGUAGE plpgsql;
