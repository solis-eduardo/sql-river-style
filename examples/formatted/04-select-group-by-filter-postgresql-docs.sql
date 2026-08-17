-- Fonte: PostgreSQL Documentation, "3.7. Aggregate Functions"
-- https://www.postgresql.org/docs/current/tutorial-agg.html (PostgreSQL License)
-- count(*) com a cláusula FILTER (WHERE ...) dentro da lista do SELECT.
    SELECT city,
           COUNT(*) FILTER (WHERE temp_lo < 45),
           MAX(temp_lo)
      FROM weather
  GROUP BY city
