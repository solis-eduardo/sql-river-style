-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: identificadores entre aspas encadeados ("tabela"."coluna") preservam
-- o ponto e tiram aspas desnecessárias
select *
       from "ecm_versoes"
       inner join "ecm_arquivos"
       on "ecm_versoes"."arquivo_id" = "ecm_arquivos"."id"
       where "ecm_arquivos"."deleted_at" is null
       and "ecm_arquivos"."anexo" = true
