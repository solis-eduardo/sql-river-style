-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: casts de tipo composto (mais de uma palavra) ficam totalmente
-- maiúsculos
select t.a::double precision,
                   t.b::character varying(255),
                   t.c::timestamp with time zone,
                   t.d::timestamp without time zone,
                   t.e::int
              from t
