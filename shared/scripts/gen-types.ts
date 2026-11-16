// Generates TypeScript types from the JSON Schemas, which are the source of truth.
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { compileFromFile } from 'json-schema-to-typescript';

const schemaDir = join(import.meta.dirname, '../schemas');
const outDir = join(import.meta.dirname, '../src/generated');

await mkdir(outDir, { recursive: true });
for (const file of (await readdir(schemaDir)).filter((f) => f.endsWith('.schema.json')).sort()) {
  const ts = await compileFromFile(join(schemaDir, file), {
    bannerComment: `// Generated from schemas/${file} by scripts/gen-types.ts. Do not edit.`,
    style: { singleQuote: true },
  });
  const out = join(outDir, `${basename(file, '.schema.json')}.ts`);
  await writeFile(out, ts);
  console.log(`wrote ${out}`);
}
