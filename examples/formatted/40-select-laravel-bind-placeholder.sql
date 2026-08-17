-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: placeholder de bind parameter (?) do log de query do Laravel não é
-- descartado
    SELECT COUNT(*) as aggregate
      FROM ecm_versoes
     WHERE ecm_versoes.disco = ?
       AND ecm_versoes.ativo = ?
