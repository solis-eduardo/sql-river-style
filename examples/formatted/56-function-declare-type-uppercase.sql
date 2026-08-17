-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: DECLARE: tipo de dado sai maiúsculo (incl. RETURNS); cursor
-- statements e níveis de RAISE também; FORMAT/QUOTE_IDENT são funções nativas
CREATE FUNCTION f(p_id INT)
RETURNS RECORD
AS $$
DECLARE
    v_a INTEGER;
    v_b RECORD;
    v_c REFCURSOR;
    v_d NUMERIC := 0;
    v_e TEXT NOT NULL DEFAULT 'x';
BEGIN
    OPEN v_c FOR SELECT 1;

    FETCH v_c INTO v_a;

    CLOSE v_c;

    RAISE DEBUG 'd';

    RAISE WARNING 'w';

    RAISE EXCEPTION 'e';

    PERFORM QUOTE_IDENT('x');

    RETURN v_b;
END;
$$
LANGUAGE plpgsql;
