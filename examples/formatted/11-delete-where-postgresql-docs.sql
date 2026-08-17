-- Fonte: PostgreSQL Documentation, "6.6. Deleting Data"
-- https://www.postgresql.org/docs/current/dml-delete.html (PostgreSQL License)
-- DELETE simples com condição no WHERE.
    DELETE
      FROM products
     WHERE price = 10
