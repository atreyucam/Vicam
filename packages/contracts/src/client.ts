import createClient from "openapi-fetch";

import type { paths } from "./generated/schema.js";

export function createVicamApiClient(baseUrl = "/api/v1") {
  return createClient<paths>({ baseUrl });
}
