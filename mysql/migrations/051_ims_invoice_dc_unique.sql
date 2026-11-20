-- One delivery challan may appear on at most one invoice (stock already moved on DC approve).
-- Keep the earliest link per DC when cleaning accidental duplicates.

DELETE l FROM ims_invoice_dc_links l
INNER JOIN (
  SELECT tenant_id, dc_id, MIN(created_at) AS keep_at
  FROM ims_invoice_dc_links
  GROUP BY tenant_id, dc_id
  HAVING COUNT(*) > 1
) d ON d.tenant_id = l.tenant_id AND d.dc_id = l.dc_id AND l.created_at > d.keep_at;

-- If any same-timestamp duplicates remain, keep one arbitrary row.
DELETE l1 FROM ims_invoice_dc_links l1
INNER JOIN ims_invoice_dc_links l2
  ON l1.tenant_id = l2.tenant_id
 AND l1.dc_id = l2.dc_id
 AND l1.invoice_id > l2.invoice_id;

ALTER TABLE ims_invoice_dc_links
  ADD UNIQUE KEY uq_ims_inv_dc_dc (tenant_id, dc_id);
