-- Point platform branding at the official JustX logo (drop generated SVG/PNG presets).
UPDATE platform_config
SET value = JSON_SET(
  COALESCE(value, JSON_OBJECT()),
  '$.logoUrl', '/icons/justx-logo.png',
  '$.installIconUrl', '/icons/justx-logo.png'
)
WHERE config_key = 'branding'
  AND (
    JSON_UNQUOTE(JSON_EXTRACT(value, '$.logoUrl')) LIKE '%/icons/presets/%'
    OR JSON_UNQUOTE(JSON_EXTRACT(value, '$.logoUrl')) LIKE '%jbt-icon.svg'
    OR JSON_UNQUOTE(JSON_EXTRACT(value, '$.logoUrl')) LIKE '%justxsystems-icon.svg'
    OR JSON_UNQUOTE(JSON_EXTRACT(value, '$.installIconUrl')) LIKE '%/icons/presets/%'
    OR JSON_UNQUOTE(JSON_EXTRACT(value, '$.installIconUrl')) LIKE '%jbt-icon.svg'
    OR JSON_UNQUOTE(JSON_EXTRACT(value, '$.installIconUrl')) LIKE '%justxsystems-icon.svg'
    OR JSON_EXTRACT(value, '$.installIconUrl') IS NULL
  );
