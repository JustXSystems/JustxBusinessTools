import { pool } from "../db.js";
import { quotationV1Connector } from "../bos/connectors/quotation-v1.js";
import { createImsRouter } from "../ims/index.js";
import { jbtImsHost } from "../ims/hosts/jbt.js";
import { bosCatalogSource } from "../ims/sources/bos-catalog.js";

/**
 * Justx IMS-Dealer plugged into JBT: JBT sessions & notifications, approved Quotation V1
 * quotes as sales-invoice sources, and the BOS catalog / party book as master-data source.
 */
const imsRouter = createImsRouter({
  db: pool,
  host: jbtImsHost,
  sources: [quotationV1Connector(pool)],
  catalogs: [bosCatalogSource(pool)],
});

export default imsRouter;
