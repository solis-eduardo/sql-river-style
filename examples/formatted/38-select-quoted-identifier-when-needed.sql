-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: identificador entre aspas só fica quando é necessário:
-- maiúscula/acento/espaço/keyword reservada mantêm, o resto tira
    SELECT "Tabela".coluna_simples,
           tabela."Coluna Com Espaço",
           tabela."situação",
           tabela."order"
      FROM "Tabela"
