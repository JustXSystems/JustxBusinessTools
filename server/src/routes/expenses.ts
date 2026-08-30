import { createLegacyApiRouter } from "../middleware/legacy-api.js";

export default createLegacyApiRouter({
  resource: "expenses",
  migrateTo: "/tools/paymenttracker",
  apiReplacement: "/api/tools/paymenttracker/records",
});
