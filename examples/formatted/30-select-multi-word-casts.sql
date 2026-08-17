-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: casts de tipo composto (mais de uma palavra) ficam totalmente
-- maiúsculos
    SELECT t.a::DOUBLE PRECISION,
           t.b::CHARACTER VARYING(255),
           t.c::TIMESTAMP WITH TIME ZONE,
           t.d::TIMESTAMP WITHOUT TIME ZONE,
           t.e::INT
      FROM t
