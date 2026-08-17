-- Fonte: Stack Overflow, resposta de AdaTheDev (CC BY-SA 4.0)
-- https://stackoverflow.com/a/4849704 — Retirado em 2026-08-17.
-- Consulta ao catálogo do SQL Server (sys.columns/sys.tables) pra achar em
-- quais tabelas uma coluna aparece; aliases de coluna com aspas simples
-- ('ColumnName') e alinhamento manual de espaços no fonte original.
    SELECT c.name as "ColumnName",
           (schema_name(t.schema_id) + '.' + t.name) as "TableName"
      FROM sys.columns c
      JOIN sys.tables t
        ON ( c.object_id = t.object_id )
     WHERE c.name LIKE '%MyName%'
  ORDER BY "TableName",
           "ColumnName"
