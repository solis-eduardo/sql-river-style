-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: alias como string literal (AS 'Foo') vira identificador — com aspas
-- só quando precisa
    SELECT c.name as "ColumnName",
           c.id as id_simples
      FROM c
