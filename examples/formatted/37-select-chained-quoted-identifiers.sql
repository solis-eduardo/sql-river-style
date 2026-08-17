-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: identificadores entre aspas encadeados ("tabela"."coluna") preservam
-- o ponto e tiram aspas desnecessárias
    SELECT *
      FROM ecm_versoes
INNER JOIN ecm_arquivos
        ON ( ecm_versoes.arquivo_id = ecm_arquivos.id )
     WHERE ecm_arquivos.deleted_at IS NULL
       AND ecm_arquivos.anexo = TRUE
