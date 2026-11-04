-- Enable guest marketing home at `/` (earlier builds defaulted enabled=false and redirected to login).
UPDATE platform_config
SET value = JSON_SET(COALESCE(value, JSON_OBJECT()), '$.enabled', true)
WHERE config_key = 'public_home'
  AND (
    JSON_EXTRACT(value, '$.enabled') IS NULL
    OR JSON_EXTRACT(value, '$.enabled') = false
    OR JSON_UNQUOTE(JSON_EXTRACT(value, '$.enabled')) IN ('false', '0')
  );
