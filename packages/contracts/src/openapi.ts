import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createOpenApiDocument } from "./openapi-document.js";

const outputPath = fileURLToPath(new URL("../openapi.json", import.meta.url));
await writeFile(outputPath, `${JSON.stringify(createOpenApiDocument(), null, 2)}\n`, "utf8");
