-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: sinal de menos unário não vira operador binário com espaço
select t.id from tabela t where t.saldo < -1000
