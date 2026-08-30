import { createLegacyApiRouter } from "../middleware/legacy-api.js";

export default createLegacyApiRouter({
  resource: "clients",
  migrateTo: "/tools/vendors",
  apiReplacement: "/api/tools/vendors/records",
});
