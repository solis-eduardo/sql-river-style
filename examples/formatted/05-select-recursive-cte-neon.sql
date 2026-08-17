-- Fonte: Neon (sucessor do postgresqltutorial.com), "PostgreSQL Recursive Query"
-- https://neon.com/postgresql/postgresql-tutorial/postgresql-recursive-query
-- WITH RECURSIVE encontrando todos os subordinados de um gerente, unindo o
-- membro âncora com o membro recursivo via UNION.
WITH RECURSIVE subordinates AS (
    SELECT employee_id,
           manager_id,
           full_name
      FROM employees
     WHERE employee_id = 2

     UNION

    SELECT e.employee_id,
           e.manager_id,
           e.full_name
      FROM employees e
INNER JOIN subordinates s
        ON ( s.employee_id = e.manager_id )
)

    SELECT *
      FROM subordinates
