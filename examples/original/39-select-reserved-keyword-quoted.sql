-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: palavra reservada do Postgres fora da lista curada de keywords do
-- formatter mantém aspas
select "user", "table", "check" from tabela.tabela
