-- Fonte: Stack Overflow, resposta de Taryn (CC BY-SA 4.0)
-- https://stackoverflow.com/a/16481475 — Retirado em 2026-08-17.
-- DELETE com JOIN (sintaxe SQL Server: `DELETE w FROM ... JOIN ...`),
-- complementando 11-delete-where-postgresql-docs.sql (DELETE simples).
DELETE w
FROM WorkRecord2 w
INNER JOIN Employee e
  ON EmployeeRun=EmployeeNo
WHERE Company = '1' AND Date = '2013-05-06'
