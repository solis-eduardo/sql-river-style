-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: CREATE FUNCTION: comentários standalone antes do CREATE são
-- preservados (não somem mais)
-- primeira linha do cabeçalho
-- segunda linha do cabeçalho
CREATE FUNCTION f()
RETURNS INT
AS $$
BEGIN
    RETURN 1;
END;
$$
LANGUAGE plpgsql;
