-- Fonte: PostgreSQL Documentation, "3.2. Joins Between Tables"
-- https://www.postgresql.org/docs/current/tutorial-join.html (PostgreSQL License)
-- SELECT com INNER JOIN implícito entre "weather" e "cities", qualificando
-- todas as colunas com o nome da tabela.
SELECT weather.city, weather.temp_lo, weather.temp_hi,
       weather.prcp, weather.date, cities.location
    FROM weather JOIN cities ON weather.city = cities.name;
