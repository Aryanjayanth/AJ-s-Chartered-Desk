import fs from "node:fs";
import path from "node:path";

const filesToPatch = [
  "node_modules/@tanstack/router-plugin/dist/esm/core/code-splitter/compilers.js",
  "node_modules/@tanstack/router-plugin/dist/cjs/core/code-splitter/compilers.cjs",
];

let patchedCount = 0;

for (const relPath of filesToPatch) {
  const filePath = path.resolve(process.cwd(), relPath);
  if (!fs.existsSync(filePath)) continue;

  let content = fs.readFileSync(filePath, "utf-8");
  const needle = "`const ${splitNodeMeta.localImporterIdent} = () => import('${splitUrl}')`";
  const replacement =
    "`const ${splitNodeMeta.localImporterIdent} = () => import(${JSON.stringify(splitUrl)})`";

  if (content.includes(needle)) {
    content = content.replaceAll(needle, replacement);
    fs.writeFileSync(filePath, content, "utf-8");
    patchedCount++;
  }
}

if (patchedCount > 0) {
  console.log(
    `[postinstall] Patched ${patchedCount} TanStack Router files for Windows path safety.`,
  );
}
