-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: keyword interval sai maiúscula
select a.id from tabela a where a.criado_em <= CURRENT_TIMESTAMP - interval '0 days'
