-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: CASE WHEN/THEN em blocos, um por linha, e END alinhado com o CASE
select a.id from tabela a where a.status <> 42 and case when x = '' then true when x = 'a' -- Arquivados
       then a.status_id = 41 when x = 't' then b.is_closed is true and a.status_id not in (1,2) end
