import { createLegacyApiRouter } from "../middleware/legacy-api.js";

export default createLegacyApiRouter({
  resource: "tasks",
  migrateTo: "/tools/servicetasks",
  apiReplacement: "/api/tools/servicetasks/records",
});
