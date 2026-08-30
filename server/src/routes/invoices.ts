import { createLegacyApiRouter } from "../middleware/legacy-api.js";

export default createLegacyApiRouter({
  resource: "invoices",
  migrateTo: "/tools/invoice",
  apiReplacement: "/api/documents/invoice",
});
