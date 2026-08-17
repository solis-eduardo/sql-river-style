-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: ORDER BY/GROUP BY que referenciam um alias do SELECT pelo nome
-- ganham as mesmas aspas do alias
    SELECT c.name as "ColumnName",
           c.id as safe_alias
      FROM c
  GROUP BY "ColumnName"
  ORDER BY "ColumnName",
           safe_alias
