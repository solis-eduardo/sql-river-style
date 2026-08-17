-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: RAISE/EXECUTE saem maiúsculos dentro do corpo, igual
-- BEGIN/RETURN/END, mesmo sem estruturação própria
CREATE FUNCTION f()
RETURNS VOID
AS $$
BEGIN
    RAISE NOTICE 'oi %', 1;

    EXECUTE FORMAT('select %I', 'x');
END;
$$
LANGUAGE plpgsql;
