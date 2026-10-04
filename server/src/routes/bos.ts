import { pool } from "../db.js";
import { createBosRouter } from "../bos/index.js";
import { jbtHost } from "../bos/hosts/jbt.js";
import { quotationV1Connector } from "../bos/connectors/quotation-v1.js";
import { siteSurveyV1Connector } from "../bos/connectors/site-survey-v1.js";

/** Justx BOS plugged into JBT: JBT sessions & notifications, Quotation V1 + Site Survey V1 connectors. */
const bosRouter = createBosRouter({
  db: pool,
  host: jbtHost,
  connectors: [quotationV1Connector(pool), siteSurveyV1Connector(pool)],
});

export default bosRouter;
