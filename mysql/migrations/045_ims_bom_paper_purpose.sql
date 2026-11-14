-- BOM paper: purpose-driven layouts + industry pack / tone / density / margin privacy.
-- Legacy aesthetic template ids (aether, classic, …) still normalize to a purpose on read.

ALTER TABLE ims_settings
  MODIFY COLUMN bom_paper_template VARCHAR(32) NOT NULL DEFAULT 'proposal',
  ADD COLUMN bom_industry_pack VARCHAR(32) NOT NULL DEFAULT 'general' AFTER bom_paper_template,
  ADD COLUMN bom_paper_tone VARCHAR(16) NOT NULL DEFAULT 'neutral' AFTER bom_industry_pack,
  ADD COLUMN bom_paper_density VARCHAR(16) NOT NULL DEFAULT 'comfort' AFTER bom_paper_tone,
  ADD COLUMN bom_hide_margin TINYINT(1) NOT NULL DEFAULT 0 AFTER bom_paper_density;
