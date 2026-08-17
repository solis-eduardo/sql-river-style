-- Fonte: PostgreSQL Documentation, "43.7.3. Returning Cursors" (exemplo
-- "myfunc" — função retornando vários refcursors via RETURN NEXT)
-- https://www.postgresql.org/docs/current/plpgsql-cursors.html (PostgreSQL License)
CREATE FUNCTION myfunc(refcursor, refcursor) RETURNS SETOF refcursor AS $$
BEGIN
    OPEN $1 FOR SELECT * FROM table_1;
    RETURN NEXT $1;
    OPEN $2 FOR SELECT * FROM table_2;
    RETURN NEXT $2;
END;
$$ LANGUAGE plpgsql;
