-- Fonte: Stack Overflow, resposta de BinaryMisfit (CC BY-SA 4.0)
-- https://stackoverflow.com/a/452934 — Retirado em 2026-08-17.
-- INSERT multi-linha com lista de colunas numa linha própria e VALUES com
-- várias tuplas; complementa 06-insert-multi-row-values-postgresql-docs.sql
-- (mesma ideia, formatação de origem bem diferente).
INSERT INTO MyTable
  ( Column1, Column2, Column3 )
VALUES
  ('John', 123, 'Lloyds Office'),
  ('Jane', 124, 'Lloyds Office'),
  ('Billy', 125, 'London Office'),
  ('Miranda', 126, 'Bristol Office');
