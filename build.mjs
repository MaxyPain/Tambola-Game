
import { build } from "esbuild";
import fs from "fs";
import path from "path";

const outdir = path.resolve("dist/public");
fs.mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: ["src/app.jsx"],
  bundle: true,
  format: "iife",
  globalName: "TambolaApp",
  outfile: path.join(outdir, "app.js"),
  minify: true,
  sourcemap: false,
  loader: { ".png": "file" },
  define: {
    "process.env.NODE_ENV": '"production"'
  }
});

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#0b1220" />
  <title>Tambola Pro</title>
  <link rel="stylesheet" href="/app.css" />
</head>
<body>
  <div id="root"></div>
  <script src="/socket.io/socket.io.js"></script>
  <script src="/app.js"></script>
</body>
</html>`;

fs.writeFileSync(path.join(outdir, "index.html"), html);
