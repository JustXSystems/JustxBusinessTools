import type { Pool } from "mysql2/promise";
import {
  IMS_ALWAYS_ON_MODULES,
  IMS_MODULE_CATALOG,
  getProfileImsModules,
  setProfileImsModules,
} from "../ims-profile-modules.js";
import type { ToolCapabilityAdapter } from "./types.js";

export const imsCapabilityAdapter: ToolCapabilityAdapter = {
  toolId: "imsdealer",
  name: "Justxsystems IMS",
  hasCeiling: true,
  catalog: IMS_MODULE_CATALOG,
  alwaysOn: IMS_ALWAYS_ON_MODULES,
  get: (db: Pool, businessProfileId: number) => getProfileImsModules(db, businessProfileId),
  set: (db: Pool, businessProfileId: number, keys: ReadonlyArray<string> | null) =>
    setProfileImsModules(db, businessProfileId, keys),
};
