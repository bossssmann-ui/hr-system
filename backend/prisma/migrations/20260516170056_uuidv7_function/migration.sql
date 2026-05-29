-- UUIDv7 generator function (pure PL/pgSQL, no extensions required).
-- Must run before any table that uses uuidv7() as a default.

CREATE OR REPLACE FUNCTION uuidv7() RETURNS UUID AS $$
DECLARE
  unix_ms BIGINT;
  rand    BYTEA;
  hex     TEXT;
BEGIN
  unix_ms := (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT;
  rand    := gen_random_bytes(10);

  hex := lpad(to_hex(unix_ms), 12, '0')
      || '7'
      || to_hex(get_byte(rand, 0) & 15)
      || lpad(to_hex(get_byte(rand, 1)), 2, '0')
      || lpad(to_hex((get_byte(rand, 2) & 63) | 128), 2, '0')
      || lpad(to_hex(get_byte(rand, 3)), 2, '0')
      || lpad(to_hex(get_byte(rand, 4)), 2, '0')
      || lpad(to_hex(get_byte(rand, 5)), 2, '0')
      || lpad(to_hex(get_byte(rand, 6)), 2, '0')
      || lpad(to_hex(get_byte(rand, 7)), 2, '0')
      || lpad(to_hex(get_byte(rand, 8)), 2, '0')
      || lpad(to_hex(get_byte(rand, 9)), 2, '0');

  RETURN CAST(
    substr(hex, 1,  8) || '-' ||
    substr(hex, 9,  4) || '-' ||
    substr(hex, 13, 4) || '-' ||
    substr(hex, 17, 4) || '-' ||
    substr(hex, 21, 12)
  AS UUID);
END;
$$ LANGUAGE plpgsql;
