import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const sourcePath = process.argv[2];
if (sourcePath === undefined) {
  throw new Error("Usage: node scripts/build-compromised-password-denylist.mjs <local-source.txt>");
}

const sourceBytes = await readFile(sourcePath);
const source = sourceBytes.toString("utf8");
const sourceEntryCount = source.split(/\r?\n/u).filter((value) => value.trim().length > 0).length;
const normalized = [
  ...new Set(
    source
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value.normalize("NFKC").toLocaleLowerCase("en-US")),
  ),
].sort();

const bitCount = 262_144;
const hashCount = 7;
const bloom = Buffer.alloc(bitCount / 8);
for (const value of normalized) {
  const digest = createHash("sha256").update(value, "utf8").digest();
  for (let index = 0; index < hashCount; index += 1) {
    const bit = digest.readUInt32BE(index * 4) & (bitCount - 1);
    bloom[bit >>> 3] |= 1 << (bit & 7);
  }
}

const chunks = bloom.toString("base64").match(/.{1,100}/gu) ?? [];
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
process.stdout.write(`import { createHash } from "node:crypto";\n\n`);
process.stdout.write(
  `import { isCompromisedPassword as isLegacyCompromisedPassword } from "./compromised-password-denylist-v1.js";\n\n`,
);
process.stdout.write(
  `export const compromisedPasswordDenylistVersion = "vicam-compromised-passwords-v2";\n`,
);
process.stdout.write(`export const compromisedPasswordEntryCount = ${normalized.length};\n`);
process.stdout.write(`export const compromisedPasswordSourceEntryCount = ${sourceEntryCount};\n`);
process.stdout.write(`export const compromisedPasswordSourceSha256 = "${sourceSha256}";\n`);
process.stdout.write(`export const compromisedPasswordBloomBitCount = ${bitCount};\n`);
process.stdout.write(`export const compromisedPasswordBloomHashCount = ${hashCount};\n\n`);
process.stdout.write(`const bloom = Buffer.from(\n  [\n`);
for (const chunk of chunks) process.stdout.write(`    "${chunk}",\n`);
process.stdout.write(`  ].join(""),\n  "base64",\n);\n\n`);
process.stdout.write(
  `export function compromisedPasswordFingerprint(password: string): string {\n`,
);
process.stdout.write(
  `  return createHash("sha256").update(password.normalize("NFKC").toLocaleLowerCase("en-US"), "utf8").digest("hex");\n`,
);
process.stdout.write(`}\n\n`);
process.stdout.write(`export function isCompromisedPassword(password: string): boolean {\n`);
process.stdout.write(`  if (isLegacyCompromisedPassword(password)) return true;\n`);
process.stdout.write(
  `  const digest = Buffer.from(compromisedPasswordFingerprint(password), "hex");\n`,
);
process.stdout.write(
  `  for (let index = 0; index < compromisedPasswordBloomHashCount; index += 1) {\n`,
);
process.stdout.write(
  `    const bit = digest.readUInt32BE(index * 4) & (compromisedPasswordBloomBitCount - 1);\n`,
);
process.stdout.write(`    if ((bloom[bit >>> 3]! & (1 << (bit & 7))) === 0) return false;\n`);
process.stdout.write(`  }\n`);
process.stdout.write(`  return true;\n`);
process.stdout.write(`}\n`);
