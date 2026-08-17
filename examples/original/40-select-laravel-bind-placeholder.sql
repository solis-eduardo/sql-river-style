-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: placeholder de bind parameter (?) do log de query do Laravel não é
-- descartado
select count(*) as aggregate from "ecm_versoes" where "ecm_versoes"."disco" = ? and "ecm_versoes"."ativo" = ?
