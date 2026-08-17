-- Fonte: PostgreSQL Documentation, "CREATE PROCEDURE" (forma com corpo em
-- string constant, "Examples")
-- https://www.postgresql.org/docs/current/sql-createprocedure.html (PostgreSQL License)
CREATE PROCEDURE insert_data(a INTEGER, b INTEGER)
LANGUAGE sql
AS $$
    INSERT INTO tbl
         VALUES (a);

    INSERT INTO tbl
         VALUES (b);
$$;
