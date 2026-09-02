/** Side-effect entry for `tsx --import ./src/instrumentation.ts …` */
import "dotenv/config";
import { startOtel } from "./lib/otel.js";

startOtel();
