const fs = require("fs");
const path = require("path");
const { analyzeCodebase } = require("./scanner");
const { renderAll } = require("./renderers");

function usage() {
  console.log("Usage: node src/cli.js scan <path> --output <docs-dir>");
}

function main(argv) {
  if (argv[2] !== "scan" || !argv[3]) {
    usage();
    process.exit(1);
  }
  const target = path.resolve(argv[3]);
  const outputFlag = argv.indexOf("--output");
  const outDir = path.resolve(outputFlag >= 0 ? argv[outputFlag + 1] : "docs");
  const scan = analyzeCodebase(target);
  const rendered = renderAll(scan);

  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, file] of Object.entries(rendered)) {
    const filename = {
      openapiJson: "openapi.json",
      openapiYaml: "openapi.yaml",
      markdown: "API_DOCUMENTATION.md",
      html: "index.html",
      drift: "drift-report.json",
      postman: "postman_collection.json"
    }[name];
    if (filename) fs.writeFileSync(path.join(outDir, filename), file.content);
  }

  console.log(`Scanned ${scan.files.length} files.`);
  console.log(`Extracted ${scan.endpoints.length} endpoints.`);
  console.log(`Documentation written to ${outDir}`);
  if (scan.drift.newInCode.length || scan.drift.removedFromSpec.length) {
    process.exitCode = 1;
  }
}

main(process.argv);
