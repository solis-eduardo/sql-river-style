-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: SELECT mantém pelo menos 4 espaços de indentação mesmo sem JOIN mais
-- largo que GROUP BY
    SELECT COUNT(*),
           categoria_id
      FROM ecm_versoes
      JOIN ecm_arquivos
        ON ( ecm_versoes.arquivo_id = ecm_arquivos.id )
     WHERE ecm_versoes.deleted_at IS NULL
       AND ecm_arquivos.deleted_at IS NOT NULL
       AND categoria_id = 59
  GROUP BY 2
