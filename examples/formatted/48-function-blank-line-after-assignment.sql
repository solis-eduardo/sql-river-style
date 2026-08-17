-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: CREATE FUNCTION: linha em branco antes de SELECT/IF aninhado quando
-- vêm logo após uma atribuição simples
CREATE OR REPLACE FUNCTION bump_score(p_id INTEGER)
RETURNS NUMERIC
AS $$
DECLARE
    v_score NUMERIC;
BEGIN
    v_score := 10;

    SELECT amount INTO v_score
      FROM scores
     WHERE id = p_id;

    v_score := v_score + 1;

    IF v_score > 100
    THEN
        v_score := 100;
    END IF;

    RETURN v_score;
END;
$$
LANGUAGE plpgsql;
