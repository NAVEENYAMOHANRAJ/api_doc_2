const fs = require("fs");
const path = require("path");

const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", "dist", "build", "vendor", ".next", ".apidocgen"]);
const CODE_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".go", ".rb", ".php", ".cs", ".kt", ".rs", ".swift"]);
const SPEC_NAMES = new Set(["openapi.json", "swagger.json", "api-docs.json"]);
const SPEC_EXTS  = new Set([".yaml", ".yml"]);

/* ═══════════════════════════════════════════════════════════════
   ROUTE PATTERNS  (leaf-level matchers — prefix resolution happens
   separately in extractRoutesFromFile via buildPrefixTree)
═══════════════════════════════════════════════════════════════ */
const ROUTE_PATTERNS = [
  /* Express / Fastify / Node.js - Simple pattern */
  {
    name: "express",
    regex: /\b(?:app|router|route|server)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*["'`]([^"'`]+)["'`]/gi,
    methodGroup: 1, pathGroup: 2
  },
  /* NestJS method decorators */
  {
    name: "nestjs",
    regex: /@(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/gi,
    methodGroup: 1, pathGroup: 2, isNest: true
  },
  /* FastAPI / Flask */
  {
    name: "fastapi-flask",
    regex: /@(?:app|router|blueprint|bp)\s*\.\s*(get|post|put|patch|delete|options|head|route)\s*\(\s*["'`]([^"'`]+)["'`](?:\s*,\s*methods\s*=\s*\[([^\]]+)\])?/gi,
    methodGroup: 1, pathGroup: 2, methodsGroup: 3
  },
  /* Spring Boot */
  {
    name: "spring",
    regex: /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["'](?:[^)]*method\s*=\s*RequestMethod\.(GET|POST|PUT|DELETE|PATCH))?/gi,
    methodGroup: 1, pathGroup: 2, methodsGroup: 3
  },
  /* Go (chi, gin, gorilla, echo) */
  {
    name: "go",
    regex: /\b(?:r|router|group|api|v\d+|e|g)\s*\.\s*(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s*\(\s*"([^"]+)"/g,
    methodGroup: 1, pathGroup: 2
  },
  /* Laravel explicit */
  {
    name: "laravel",
    regex: /Route::(get|post|put|delete|patch|options)\s*\(\s*["']([^"']+)["']/gi,
    methodGroup: 1, pathGroup: 2
  },
  /* Laravel match */
  {
    name: "laravel-match",
    regex: /Route::match\s*\(\s*\[([^\]]+)\]\s*,\s*["']([^"']+)["']/gi,
    methodGroup: 1, pathGroup: 2, isMatch: true
  },
  /* Laravel resource / apiResource */
  {
    name: "laravel-resource",
    regex: /Route::(?:api)?[Rr]esource\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*(?:,\s*(\{[^}]*\}))?\s*\)/gi,
    pathGroup: 1, controllerGroup: 2, optionsGroup: 3, isResource: true
  },
  /* Rails */
  {
    name: "rails",
    regex: /^\s*(get|post|put|delete|patch)\s+["']([^"']+)["']/gim,
    methodGroup: 1, pathGroup: 2
  },
  /* Django */
  {
    name: "django",
    regex: /\bpath\s*\(\s*["']([^"']+)["']/gi,
    staticMethod: "GET", pathGroup: 1
  },
  /* Ruby on Rails/Sinatra */
  {
    name: "sinatra",
    regex: /\b(get|post|put|delete|patch)\s+["']([^"']+)["']\s+do/gi,
    methodGroup: 1, pathGroup: 2
  }
];

/* ═══════════════════════════════════════════════════════════════
   LARAVEL RESOURCE MAP
═══════════════════════════════════════════════════════════════ */
const RESOURCE_MAP = [
  { action: "index",   method: "GET",    suffix: "",      operationSuffix: "List"   },
  { action: "store",   method: "POST",   suffix: "",      operationSuffix: "Create" },
  { action: "show",    method: "GET",    suffix: "/{id}", operationSuffix: "Show"   },
  { action: "update",  method: "PUT",    suffix: "/{id}", operationSuffix: "Update" },
  { action: "destroy", method: "DELETE", suffix: "/{id}", operationSuffix: "Delete" }
];

/* ═══════════════════════════════════════════════════════════════
   CONTROLLER INDEX  (Laravel / NestJS)
═══════════════════════════════════════════════════════════════ */
let controllerIndex = {};

function buildControllerIndex(files) {
  controllerIndex = {};

  for (const f of files) {
    /* ── PHP/Laravel controllers ── */
    if (f.ext === ".php") {
      const ns = (f.content.match(/namespace\s+([\w\\]+)\s*;/) || [])[1] || "";
      const classMatch = f.content.match(/class\s+(\w+Controller)\s+extends/);
      if (!classMatch) continue;
      const className = classMatch[1];
      const middlewareCalls = [...f.content.matchAll(/\$this->middleware\s*\(\s*["']([^"']+)["'](?:[^;]*only\s*\(\s*\[([^\]]+)\])?(?:[^;]*except\s*\(\s*\[([^\]]+)\])?/g)];
      const middleware = middlewareCalls.map(m => ({
        name: m[1],
        only: m[2] ? m[2].split(",").map(s => s.trim().replace(/["']/g, "")) : null,
        except: m[3] ? m[3].split(",").map(s => s.trim().replace(/["']/g, "")) : null
      }));
      const methods = {};
      for (const match of f.content.matchAll(/\/\*\*\s*([\s\S]*?)\*\/\s*(?:public|protected)\s+function\s+(\w+)\s*\(([^)]*)\)/g)) {
        methods[match[2]] = { docblock: match[1].replace(/\s*\*\s*/g, " ").trim(), params: match[3] };
      }
      controllerIndex[className] = { namespace: ns, middleware, methods, filePath: f.path };
    }

    /* ── TypeScript / NestJS controllers — build @Controller prefix index ── */
    if ([".ts", ".tsx", ".js", ".jsx"].includes(f.ext)) {
      const ctrlMatch = f.content.match(/@Controller\s*\(\s*["'`]([^"'`]*)["'`]\s*\)/);
      if (!ctrlMatch) continue;
      const classNameMatch = f.content.match(/(?:export\s+)?(?:default\s+)?class\s+(\w+)/);
      const className = classNameMatch ? classNameMatch[1] : path.basename(f.path, f.ext);
      controllerIndex[className] = {
        nestPrefix: ctrlMatch[1],
        filePath: f.path,
        methods: {},
        middleware: []
      };
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   NESTED ROUTE PREFIX RESOLUTION

   Handles:
   - Express:  router.use('/prefix', subRouter) or app.use('/api/v1', router)
   - Express:  const apiRouter = express.Router(); apiRouter.get('/path', ...)
   - NestJS:   @Module({ imports: [RouterModule.register([...])] })
   - Laravel:  Route::group(['prefix' => 'v1'], fn)  /  Route::prefix('v1')->group(...)
   - Go:       v1 := r.Group("/v1")  /  r.Route("/v1", func(r chi.Router) { ... })
   - FastAPI:  app.include_router(router, prefix="/api/v1")
═══════════════════════════════════════════════════════════════ */

/**
 * Build a prefix map: variableName -> resolvedPrefix.
 * We scan the entire file for patterns that mount routers at a prefix.
 */
function buildPrefixMap(content) {
  const prefixMap = {};   // varName -> prefix string

  /* 1. Express: app.use('/prefix', varName) or router.use('/prefix', varName) */
  for (const m of content.matchAll(/(?:app|server|router)\s*\.\s*use\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    const prefix = normalizePath(m[1]);
    const varName = m[2];
    prefixMap[varName] = (prefixMap[varName] || "") + prefix;
  }

  /* 2. Express const r = express.Router() / Router() — keep empty, populated by use() above */
  /* We also resolve chains: if varA mounts varB, varB's prefix = varA's prefix + varB's use-prefix */
  /* (Handled implicitly: we iterate until stable — see resolveChainedPrefixes below) */

  /* 3. Laravel: Route::prefix('v1')->group(fn) or Route::group(['prefix' => 'v1'], fn) */
  for (const m of content.matchAll(/Route::(?:group\s*\(\s*\[['"]prefix['"]\s*=>\s*['"]([^'"]+)['"])/g)) {
    if (!prefixMap["__laravel_prefix__"]) prefixMap["__laravel_prefix__"] = normalizePath(m[1]);
  }
  for (const m of content.matchAll(/Route::prefix\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!prefixMap["__laravel_prefix__"]) prefixMap["__laravel_prefix__"] = normalizePath(m[1]);
  }

  /* 4. Go: v1 := r.Group("/v1") or g := r.Group("/v1") */
  for (const m of content.matchAll(/([A-Za-z_$][\w$]*)\s*:=\s*(?:r|router|e|g|api)\s*\.\s*(?:Group|Route)\s*\(\s*"([^"]+)"/g)) {
    prefixMap[m[1]] = normalizePath(m[2]);
  }
  /* Go: r.Route("/v1", func(r chi.Router) { ... }) — inline group */
  for (const m of content.matchAll(/(?:r|router)\s*\.\s*Route\s*\(\s*"([^"]+)"/g)) {
    prefixMap["__go_route__"] = normalizePath(m[1]);
  }

  /* 5. FastAPI: app.include_router(router, prefix="/api/v1") */
  for (const m of content.matchAll(/include_router\s*\([^)]*prefix\s*=\s*["']([^"']+)["'][^)]*\)/g)) {
    prefixMap["__fastapi_prefix__"] = normalizePath(m[1]);
  }

  /* 6. Express: const v1 = router.route('/v1') — rare but handle */
  for (const m of content.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*router\.route\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
    prefixMap[m[1]] = normalizePath(m[2]);
  }

  return prefixMap;
}

/**
 * Given a route match and the prefix map, return the effective prefix.
 * We look at:
 *  - what variable the route is defined on (e.g. v1Router.get('/users', ...))
 *  - any applicable parent prefixes for that variable
 */
function resolvePrefix(varName, prefixMap) {
  if (!varName) return "";
  /* Direct lookup */
  if (prefixMap[varName]) return prefixMap[varName];
  /* Try case-insensitive */
  const lv = varName.toLowerCase();
  for (const [k, v] of Object.entries(prefixMap)) {
    if (k.toLowerCase() === lv) return v;
  }
  return "";
}

/**
 * Extract the router variable name from a route match context.
 * For:  v1Router.get('/path', ...)   → "v1Router"
 *       router.post('/path', ...)    → "router"
 *       app.get('/path', ...)        → "app"
 */
function extractRouterVarName(content, matchIndex) {
  /* Look behind the match index up to 200 chars */
  const behind = content.slice(Math.max(0, matchIndex - 200), matchIndex);
  /* Find the last word before the dot-method call: word.get( / word.post( etc. */
  const m = behind.match(/([A-Za-z_$][\w$]*)\s*\.\s*$/);
  return m ? m[1] : "";
}

/* ═══════════════════════════════════════════════════════════════
   NESTJS PREFIX RESOLUTION

   @Controller('prefix') declares a class-level prefix.
   @Get('/path') on a method → full route is /prefix/path
   We resolve this by scanning the file for @Controller + matching
   the enclosing class, then prepending its prefix.
═══════════════════════════════════════════════════════════════ */

/**
 * Build a map: { charIndex: nestPrefix } for each controller class in the file.
 * Returns array of { startIdx, endIdx, prefix } sorted by startIdx.
 */
function buildNestControllerRanges(content) {
  const ranges = [];
  /* Find each @Controller(...) class ... { ... } */
  for (const m of content.matchAll(/@Controller\s*\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/g)) {
    const prefix = m[1] || "";
    /* Find the opening brace of the class */
    const afterDecorator = content.indexOf("{", m.index);
    if (afterDecorator === -1) continue;
    /* Find matching closing brace */
    let depth = 0, end = afterDecorator;
    for (let i = afterDecorator; i < content.length; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    ranges.push({ startIdx: m.index, endIdx: end, prefix: normalizePath("/" + prefix) });
  }
  return ranges;
}

function getNestPrefix(matchIndex, nestRanges) {
  for (const r of nestRanges) {
    if (matchIndex >= r.startIdx && matchIndex <= r.endIdx) return r.prefix;
  }
  return "";
}

/* ═══════════════════════════════════════════════════════════════
   DJANGO / FASTAPI URL INCLUDE RESOLUTION

   Django: urlpatterns = [path('api/', include('app.urls'))]
   FastAPI: app.include_router(router, prefix='/api/v1')
   We collect all include() calls with their prefixes.
═══════════════════════════════════════════════════════════════ */
function buildDjangoPrefixMap(content) {
  const map = {};
  /* Django: path('prefix/', include('module')) */
  for (const m of content.matchAll(/path\s*\(\s*["']([^"']+)["']\s*,\s*include\s*\(/g)) {
    const prefix = normalizePath("/" + m[1]);
    /* We can't resolve which file is included without fs access here,
       so we store it as __django_prefix__ for downstream use */
    map["__django_include__"] = prefix;
  }
  return map;
}

/* ═══════════════════════════════════════════════════════════════
   FILE COLLECTION
═══════════════════════════════════════════════════════════════ */
function collectFiles(root) {
  const out = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
        continue;
      }
      const abs = path.join(dir, entry.name);
      const ext = path.extname(entry.name).toLowerCase();
      if (CODE_EXTS.has(ext) || SPEC_NAMES.has(entry.name.toLowerCase()) || SPEC_EXTS.has(ext)) {
        out.push({ path: path.relative(root, abs).replace(/\\/g, "/"), abs, ext, name: entry.name });
      }
    }
  }
  walk(root);
  return out;
}

function detectProject(root, files) {
  const names = new Set(files.map(f => f.path.toLowerCase()));
  const langs = new Set();
  for (const f of files) {
    if ([".js", ".jsx", ".ts", ".tsx"].includes(f.ext)) langs.add("Node.js/TypeScript");
    if (f.ext === ".py") langs.add("Python");
    if (f.ext === ".java" || f.ext === ".kt") langs.add("Java/Kotlin");
    if (f.ext === ".go") langs.add("Go");
    if (f.ext === ".php") langs.add("PHP");
    if (f.ext === ".rb") langs.add("Ruby");
  }

  const frameworks = [];
  let projectName = path.basename(root);
  let projectVersion = "1.0.0";
  let projectDescription = "";

  if (names.has("package.json")) {
    const pkg = readJsonSafe(path.join(root, "package.json"));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.express) frameworks.push("Express");
    if (deps.fastify) frameworks.push("Fastify");
    if (deps["@nestjs/core"]) frameworks.push("NestJS");
    if (deps.koa) frameworks.push("Koa");
    if (deps.hapi || deps["@hapi/hapi"]) frameworks.push("Hapi");
    if (pkg.name) projectName = pkg.name;
    if (pkg.version) projectVersion = pkg.version;
    if (pkg.description) projectDescription = pkg.description;
  }

  if (names.has("composer.json")) {
    const composer = readJsonSafe(path.join(root, "composer.json"));
    const req = composer.require || {};
    if (req["laravel/framework"]) {
      frameworks.push("Laravel " + (req["laravel/framework"] || ""));
    }
    if (req["tymon/jwt-auth"]) frameworks.push("JWT Auth (tymon/jwt-auth)");
    if (req["barryvdh/laravel-cors"] || req["fruitcake/laravel-cors"]) frameworks.push("CORS (laravel-cors)");
    if (composer.name) projectName = composer.name.split("/").pop();
    if (composer.description) projectDescription = composer.description;
  }

  if (names.has("requirements.txt") || names.has("pyproject.toml")) {
    frameworks.push("Python API");
    /* Check for FastAPI / Django */
    try {
      const req = fs.readFileSync(path.join(root, "requirements.txt"), "utf8");
      if (/fastapi/i.test(req)) frameworks.push("FastAPI");
      if (/django/i.test(req)) frameworks.push("Django");
      if (/flask/i.test(req)) frameworks.push("Flask");
    } catch {}
  }

  if (names.has("pom.xml") || names.has("build.gradle")) frameworks.push("Spring/JVM");
  if (names.has("go.mod")) {
    frameworks.push("Go API");
    try {
      const mod = fs.readFileSync(path.join(root, "go.mod"), "utf8");
      if (/gin-gonic\/gin/.test(mod)) frameworks.push("Gin");
      if (/go-chi\/chi/.test(mod)) frameworks.push("Chi");
      if (/echo/.test(mod)) frameworks.push("Echo");
    } catch {}
  }

  /* Read env file for base URL + CORS hints */
  let baseUrl = "http://localhost";
  const envPath = [".env", ".env.example"].map(n => path.join(root, n)).find(p => fs.existsSync(p));
  if (envPath) {
    const envContent = fs.readFileSync(envPath, "utf8");
    const appUrl = (envContent.match(/^APP_URL=(.+)$/m) || [])[1];
    if (appUrl) baseUrl = appUrl.trim();
    const corsOrigins = (envContent.match(/^CORS_ALLOWED_ORIGINS=(.+)$/m) || [])[1];
    if (corsOrigins) {
      const origins = corsOrigins.trim().split(",").map(s => s.trim());
      frameworks.push(`CORS origins: ${origins.join(", ")}`);
    }
  }

  return { languages: [...langs], frameworks, projectName, projectVersion, projectDescription, baseUrl };
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

/* ═══════════════════════════════════════════════════════════════
   MAIN ANALYSIS ENTRY POINTS
═══════════════════════════════════════════════════════════════ */
function analyzeCodebase(root) {
  const files = collectFiles(root);
  const virtual = files.map(f => ({ ...f, content: fs.readFileSync(f.abs, "utf8") }));
  return analyzeFiles(virtual, path.basename(root), root);
}

function analyzeVirtualFiles(files, title = "Uploaded API") {
  const normalized = files.map(file => ({
    path: file.path.replace(/\\/g, "/"),
    name: path.basename(file.path),
    ext: path.extname(file.path).toLowerCase(),
    content: file.content || ""
  }));
  return analyzeFiles(normalized, title, null);
}

function analyzeFiles(files, title, root) {
  const codeFiles = files.filter(f => CODE_EXTS.has(f.ext));
  const specFiles = files.filter(f => SPEC_NAMES.has((f.name || "").toLowerCase()) || SPEC_EXTS.has(f.ext));
  const project   = root ? detectProject(root, files) : detectVirtualProject(files);

  buildControllerIndex(codeFiles);

  const existingSpecEndpoints = specFiles.flatMap(parseExistingSpec);
  const discovered = codeFiles.flatMap(f => extractRoutesFromFile(f, codeFiles));
  const merged = mergeEndpoints([...existingSpecEndpoints, ...discovered]);
  const drift  = diffEndpoints(existingSpecEndpoints, discovered);
  const authMatrix = buildAuthMatrix(merged);

  /* Extract data models from all code files */
  const dataModels = extractDataModels(codeFiles);

  return {
    title: project.projectName || title || "API Documentation",
    version: project.projectVersion || "1.0.0",
    description: project.projectDescription || "Generated by Smart API Documentation Generator.",
    baseUrl: project.baseUrl || "http://localhost",
    generatedAt: new Date().toISOString(),
    project,
    files: codeFiles.map(f => ({ path: f.path, ext: f.ext })),
    existingSpecFound: existingSpecEndpoints.length > 0,
    endpoints: merged,
    drift,
    authMatrix,
    dataModels,
    features: {
      localCloneFirst: true,
      technologyIndependentPatterns: ROUTE_PATTERNS.map(p => p.name),
      outputs: ["OpenAPI JSON", "OpenAPI YAML", "Markdown", "Static HTML", "Postman Collection", "Drift Report"]
    }
  };
}

function detectVirtualProject(files) {
  const langs = new Set();
  for (const f of files) {
    if ([".js", ".jsx", ".ts", ".tsx"].includes(f.ext)) langs.add("Node.js/TypeScript");
    if (f.ext === ".py") langs.add("Python");
    if (f.ext === ".java" || f.ext === ".kt") langs.add("Java/Kotlin");
    if (f.ext === ".go") langs.add("Go");
    if (f.ext === ".php") langs.add("PHP");
    if (f.ext === ".rb") langs.add("Ruby");
  }
  /* Try to sniff frameworks from file paths */
  const frameworks = [];
  const hasPkg = files.some(f => f.name === "package.json");
  if (hasPkg) {
    const pkg = files.find(f => f.name === "package.json");
    try {
      const json = JSON.parse(pkg.content || "{}");
      const deps = { ...(json.dependencies || {}), ...(json.devDependencies || {}) };
      if (deps.express) frameworks.push("Express");
      if (deps["@nestjs/core"]) frameworks.push("NestJS");
      if (deps.fastify) frameworks.push("Fastify");
    } catch {}
  }
  return {
    languages: [...langs], frameworks,
    projectName: "Uploaded API", projectVersion: "1.0.0",
    projectDescription: "", baseUrl: "http://localhost"
  };
}

/* ═══════════════════════════════════════════════════════════════
   ROUTE EXTRACTION  —  THE CORE ENGINE
   Now handles nested/grouped routes via prefix resolution.
═══════════════════════════════════════════════════════════════ */
function extractRoutesFromFile(file, allFiles) {
  const endpoints = [];
  const content = file.content;

  /* Build prefix map for this file (for Express sub-routers, Go groups, etc.) */
  const prefixMap = buildPrefixMap(content);

  /* Build NestJS @Controller ranges for this file */
  const nestRanges = buildNestControllerRanges(content);

  /* Laravel: detect if this is a routes file with group/prefix blocks */
  const laravelPrefixes = extractLaravelGroupPrefixes(content);

  for (const pattern of ROUTE_PATTERNS) {
    pattern.regex.lastIndex = 0;

    /* ── Laravel resource expansion ── */
    if (pattern.isResource) {
      for (const match of content.matchAll(pattern.regex)) {
        const resourcePath = match[pattern.pathGroup];
        const controllerName = match[pattern.controllerGroup];
        const optionsStr = match[pattern.optionsGroup] || "";

        const onlyMatch = optionsStr.match(/'only'\s*=>\s*\[([^\]]+)\]/);
        const exceptMatch = optionsStr.match(/'except'\s*=>\s*\[([^\]]+)\]/);
        const only = onlyMatch ? onlyMatch[1].split(",").map(s => s.trim().replace(/["']/g, "")) : null;
        const except = exceptMatch ? exceptMatch[1].split(",").map(s => s.trim().replace(/["']/g, "")) : [];

        /* Resolve Laravel group prefix */
        const groupPrefix = findLaravelGroupPrefix(match.index, laravelPrefixes);

        for (const resource of RESOURCE_MAP) {
          if (only && !only.includes(resource.action)) continue;
          if (except.includes(resource.action)) continue;

          const fullPath = normalizePath(groupPrefix + "/" + resourcePath + resource.suffix);
          const context = getContext(content, match.index);
          const controllerInfo = controllerIndex[controllerName] || {};
          const methodInfo = (controllerInfo.methods || {})[resource.action] || {};

          endpoints.push(enrichEndpoint({
            method: resource.method,
            path: fullPath,
            source: "code",
            sourceFile: file.path,
            sourceLine: lineOf(content, match.index),
            confidence: 0.95,
            frameworkHint: "laravel-resource",
            rawContext: context,
            controller: controllerName,
            action: resource.action,
            docblock: methodInfo.docblock || "",
            controllerFilePath: controllerInfo.filePath || "",
            controllerMiddleware: controllerInfo.middleware || []
          }));
        }
      }
      continue;
    }

    /* ── Laravel match ── */
    if (pattern.isMatch) {
      for (const match of content.matchAll(pattern.regex)) {
        const methodsRaw = match[1];
        const methods = methodsRaw.match(/[a-zA-Z]+/g) || ["GET"];
        const routePath = match[pattern.pathGroup];
        const groupPrefix = findLaravelGroupPrefix(match.index, laravelPrefixes);
        const fullPath = normalizePath(groupPrefix + "/" + routePath);
        const context = getContext(content, match.index);
        for (const method of methods) {
          endpoints.push(enrichEndpoint({
            method: method.toUpperCase(),
            path: fullPath,
            source: "code",
            sourceFile: file.path,
            sourceLine: lineOf(content, match.index),
            confidence: 0.92,
            frameworkHint: "laravel-match",
            rawContext: context,
            controller: extractLaravelController(context),
            action: extractLaravelAction(context)
          }));
        }
      }
      continue;
    }

    /* ── NestJS method decorators ── */
    if (pattern.isNest) {
      for (const match of content.matchAll(pattern.regex)) {
        const method = match[1].toUpperCase();
        const decoratorPath = match[2] || "";
        const nestPrefix = getNestPrefix(match.index, nestRanges);
        const fullPath = normalizePath(nestPrefix + "/" + decoratorPath);
        const context = getContext(content, match.index);
        endpoints.push(enrichEndpoint({
          method,
          path: fullPath,
          source: "code",
          sourceFile: file.path,
          sourceLine: lineOf(content, match.index),
          confidence: 0.93,
          frameworkHint: "nestjs",
          rawContext: context,
          controller: extractNestController(content, match.index),
          action: extractNestAction(content, match.index)
        }));
      }
      continue;
    }

    /* ── Standard patterns (Express, Go, FastAPI, etc.) ── */
    for (const match of content.matchAll(pattern.regex)) {
      const methods = getMethods(pattern, match);
      const rawPath = match[pattern.pathGroup];
      if (!rawPath) continue;

      /* Extract middleware from context for Express routes */
      const context = getContext(content, match.index);
      const extractedMiddleware = pattern.name === "express" 
        ? extractMiddlewareFromContext(context)
        : (pattern.middlewareGroup ? extractMiddlewareFromMatch(match[pattern.middlewareGroup]) : []);

      /* Resolve prefix for this router variable */
      const routerVar = extractRouterVarName(content, match.index);
      const prefix    = resolvePrefix(routerVar, prefixMap);
      const groupPrefix = findLaravelGroupPrefix(match.index, laravelPrefixes);

      /* Combine: groupPrefix (Laravel) OR routerVar prefix (Express/Go) */
      const effectivePrefix = prefix || groupPrefix;
      const fullPath = normalizePath(effectivePrefix + "/" + rawPath);

      const controller = extractLaravelController(context);
      const action     = extractLaravelAction(context);

      endpoints.push(enrichEndpoint({
        method: methods[0],
        path: fullPath,
        source: "code",
        sourceFile: file.path,
        sourceLine: lineOf(content, match.index),
        confidence: 0.88,
        frameworkHint: pattern.name,
        rawContext: context,
        controller,
        action,
        extractedMiddleware
      }));

      /* If multiple methods from the same match (FastAPI `methods=[...]`) */
      for (const extra of methods.slice(1)) {
        endpoints.push(enrichEndpoint({
          method: extra,
          path: fullPath,
          source: "code",
          sourceFile: file.path,
          sourceLine: lineOf(content, match.index),
          confidence: 0.85,
          frameworkHint: pattern.name,
          rawContext: context,
          controller, action,
          extractedMiddleware
        }));
      }
    }
  }

  return endpoints;
}

function extractMiddlewareFromContext(context) {
  const middleware = [];
  
  /* Look for common middleware patterns in Express routes */
  const patterns = [
    /\b(requireAuth|auth|authenticate|jwt|passport|verifyToken)\b/gi,
    /\b(body|check|param|query|header)\s*\(/gi,
    /\b([A-Za-z_][\w]*)\s*,\s*(?:async\s+)?\(/gi
  ];
  
  for (const pattern of patterns) {
    const matches = [...context.matchAll(pattern)];
    for (const match of matches) {
      const mw = match[1];
      if (mw && !middleware.includes(mw) && !/^(async|function|req|res|next)$/.test(mw)) {
        middleware.push(mw);
      }
    }
  }
  
  return middleware;
}

function extractMiddlewareFromMatch(middlewareRaw) {
  if (!middlewareRaw) return [];
  
  /* Clean up the middleware string and extract function names */
  const middleware = [];
  
  /* Handle single middleware: requireAuth */
  if (/^[A-Za-z_][\w]*$/.test(middlewareRaw.trim())) {
    middleware.push(middlewareRaw.trim());
  }
  
  /* Handle array of middleware: [auth, validate] */
  const arrayMatch = middlewareRaw.match(/\[([^\]]+)\]/);
  if (arrayMatch) {
    const items = arrayMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
    middleware.push(...items);
  }
  
  /* Handle function calls: body("email").isEmail() */
  const functionCalls = middlewareRaw.match(/([A-Za-z_][\w]*)\s*\(/g);
  if (functionCalls) {
    middleware.push(...functionCalls.map(f => f.replace(/\s*\($/, '')));
  }
  
  return middleware.filter(m => m && m.length > 0);
}

/* ═══════════════════════════════════════════════════════════════
   LARAVEL GROUP PREFIX EXTRACTOR

   Handles:
     Route::group(['prefix' => 'api/v1'], function() {
       Route::get('/users', ...)   ← should get prefix /api/v1
     });

     Route::prefix('api/v1')->group(function() { ... });

     Route::middleware(['auth:api'])->prefix('v1')->group(function() { ... });
═══════════════════════════════════════════════════════════════ */
function extractLaravelGroupPrefixes(content) {
  const groups = [];

  /* Pattern 1: Route::group(['prefix' => 'xxx'], function() { ... }) */
  for (const m of content.matchAll(/Route::group\s*\(\s*\[([^\]]*)\]\s*,\s*function\s*\(\)/g)) {
    const opts = m[1];
    const prefixMatch = opts.match(/['"]prefix['"]\s*=>\s*['"]([^'"]+)['"]/);
    if (!prefixMatch) continue;
    const prefix = normalizePath("/" + prefixMatch[1]);
    const open = content.indexOf("{", m.index + m[0].length);
    if (open === -1) continue;
    let depth = 0; let end = open;
    for (let i = open; i < content.length; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    groups.push({ startIdx: open, endIdx: end, prefix });
  }

  /* Pattern 2: Route::prefix('xxx')->group(function() { ... }) */
  for (const m of content.matchAll(/Route::[^(]*prefix\s*\(\s*['"]([^'"]+)['"]\s*\)[^{]*->group\s*\([^{]*function\s*\(\)/g)) {
    const prefix = normalizePath("/" + m[1]);
    const open = content.indexOf("{", m.index + m[0].length);
    if (open === -1) continue;
    let depth = 0; let end = open;
    for (let i = open; i < content.length; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    groups.push({ startIdx: open, endIdx: end, prefix });
  }

  return groups;
}

function findLaravelGroupPrefix(matchIndex, groups) {
  /* Return the innermost group that contains this match */
  let best = "";
  for (const g of groups) {
    if (matchIndex >= g.startIdx && matchIndex <= g.endIdx) {
      if (g.prefix.length > best.length) best = g.prefix;
    }
  }
  return best;
}

/* ═══════════════════════════════════════════════════════════════
   HELPER: extract controller / action from context strings
═══════════════════════════════════════════════════════════════ */
function extractLaravelController(context) {
  const m = context.match(/["'](\w+Controller)@(\w+)["']/);
  return m ? m[1] : "";
}

function extractLaravelAction(context) {
  const m = context.match(/["']\w+Controller@(\w+)["']/);
  return m ? m[1] : "";
}

function extractNestController(content, matchIndex) {
  /* Look backwards for the class name */
  const before = content.slice(0, matchIndex);
  const m = before.match(/class\s+(\w+)\s*(?:extends|implements|{)/g);
  if (!m || !m.length) return "";
  return m[m.length - 1].replace(/class\s+(\w+).*/,"$1");
}

function extractNestAction(content, matchIndex) {
  /* Look forward from the decorator for the method name */
  const after = content.slice(matchIndex, matchIndex + 300);
  const m = after.match(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+\s*)?{/);
  return m ? m[1] : "";
}

function getMethods(pattern, match) {
  if (pattern.staticMethod) return [pattern.staticMethod];
  if (pattern.methodsGroup && match[pattern.methodsGroup]) {
    const methods = match[pattern.methodsGroup].match(/GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD/gi);
    if (methods && methods.length) return methods.map(m => m.toUpperCase());
  }
  const raw = match[pattern.methodGroup] || "GET";
  if (/request/i.test(raw)) return ["GET"];
  return [raw.toUpperCase().replace("MAPPING", "")];
}

function getContext(content, index) {
  const start = Math.max(0, index - 700);
  const end   = Math.min(content.length, index + 2800);
  return content.slice(start, end);
}

function lineOf(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function normalizePath(input) {
  let out = String(input || "").trim();
  if (!out.startsWith("/")) out = "/" + out;
  /* Convert :param → {param} */
  out = out.replace(/:([A-Za-z_][\w]*)/g, "{$1}");
  /* Convert <type:name> → {name} */
  out = out.replace(/<(?:(?:int|str|uuid|path):)?([A-Za-z_][\w]*)>/g, "{$1}");
  /* Convert {name?} → {name} */
  out = out.replace(/\{([A-Za-z_][\w]*)\?\}/g, "{$1}");
  /* Collapse duplicate slashes */
  out = out.replace(/\/+/g, "/");
  /* Remove trailing slash except root */
  out = out.replace(/\/$/, "") || "/";
  return out;
}

/* ═══════════════════════════════════════════════════════════════
   ENDPOINT ENRICHMENT
═══════════════════════════════════════════════════════════════ */
function enrichEndpoint(ep) {
  const tag       = inferTag(ep.path);
  const pathParams = extractPathParams(ep.path);

  const controllerInfo = ep.controller ? (controllerIndex[ep.controller] || {}) : {};
  const actionInfo     = (ep.action && controllerInfo.methods) ? (controllerInfo.methods[ep.action] || {}) : {};
  const docblock       = ep.docblock || actionInfo.docblock || "";

  /* Combine controller middleware with extracted middleware */
  const allMiddleware = [
    ...(controllerInfo.middleware || ep.controllerMiddleware || []),
    ...(ep.extractedMiddleware || [])
  ];

  const effectiveMiddleware = computeEffectiveMiddleware(allMiddleware, ep.action || "");
  const authRequired = effectiveMiddleware.some(m => /auth|requireAuth|jwt|bearer/i.test(m)) || detectAuth(ep.rawContext);

  const queryParams     = extractQueryParams(ep.rawContext, ep.path);
  const headers         = extractHeaders(ep.rawContext, authRequired);
  const body            = extractBody(ep.rawContext, ep.method, ep.action || "");
  const responses       = extractResponses(ep.rawContext, ep.method);
  const summary         = summarizeEndpoint(ep.method, ep.path, docblock);
  const validationRules = extractValidationRules(ep.rawContext);

  return {
    ...ep,
    summary,
    description: buildDescription(ep.method, ep.path, docblock, ep.controller, ep.action),
    tags: [tag],
    operationId: operationId(ep.method, ep.path),
    deprecated: /@deprecated|deprecated\s*[:=]\s*true/i.test(ep.rawContext),
    authRequired,
    controller: ep.controller || "",
    action: ep.action || "",
    middleware: effectiveMiddleware,
    request: { pathParams, queryParams, headers, body },
    responses,
    validationRules,
    errorCodes: extractErrorCodes(ep.rawContext),
    rawContext: ep.rawContext.trim()
  };
}

function computeEffectiveMiddleware(middlewareDefs, action) {
  const active = [];
  for (const mw of middlewareDefs) {
    if (mw.only && !mw.only.includes(action)) continue;
    if (mw.except && mw.except.includes(action)) continue;
    active.push(typeof mw === "string" ? mw : mw.name);
  }
  return active;
}

function inferTag(apiPath) {
  const parts = apiPath.split("/").filter(Boolean);
  /* Skip purely versioning segments like v1, v2, api */
  for (const p of parts) {
    if (!/^v\d+$|^api$/i.test(p) && !/^\{/.test(p)) return p.replace(/[{}]/g, "");
  }
  return parts[0]?.replace(/[{}]/g, "") || "default";
}

function operationId(method, apiPath) {
  const parts = apiPath.split("/").filter(Boolean).map(p => p.replace(/[{}:]/g, ""));
  const action = {
    GET: parts.some(p => /id$|^\{/.test(p)) ? "get" : "list",
    POST: "create", PUT: "replace", PATCH: "update",
    DELETE: "delete", OPTIONS: "options", HEAD: "head"
  }[method] || method.toLowerCase();
  const rest = parts.map(capitalize).join("");
  return `${action}${rest || "Root"}`;
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function summarizeEndpoint(method, apiPath, docblock) {
  if (docblock) {
    const firstLine = docblock.split(".")[0].replace(/^\s*@\w+.*$/gm, "").replace(/\s+/g, " ").trim();
    if (firstLine.length > 5 && firstLine.length < 120) return firstLine;
  }
  const tag = inferTag(apiPath);
  const action = {
    GET:     apiPath.includes("{") ? "Get" : "List",
    POST:    "Create", PUT: "Replace", PATCH: "Update",
    DELETE:  "Delete", OPTIONS: "Inspect", HEAD: "Check"
  }[method] || "Handle";
  return `${action} ${tag.replace(/[-_]/g, " ")}`;
}

function buildDescription(method, apiPath, docblock, controller, action) {
  const parts = [];
  if (docblock) {
    const clean = docblock.replace(/@\w+.*?(\n|$)/g, "").replace(/\s+/g, " ").trim();
    if (clean) parts.push(clean);
  }
  if (controller && action) parts.push(`Handled by ${controller}@${action}.`);
  if (!parts.length) parts.push(`${method} ${apiPath} endpoint.`);
  return parts.join(" ");
}

/* ═══════════════════════════════════════════════════════════════
   PARAMETER EXTRACTION
═══════════════════════════════════════════════════════════════ */
function extractPathParams(apiPath) {
  return [...apiPath.matchAll(/\{([^}]+)\}/g)].map(m => ({
    name: m[1],
    type: /id|count|page|limit/i.test(m[1]) ? "integer" : "string",
    required: true,
    description: `Path parameter: ${m[1]}.`
  }));
}

function extractQueryParams(code, apiPath) {
  const names = new Set();

  for (const pattern of [
    /req\.query\.([A-Za-z_][\w]*)/g,
    /request\.args\.get\(["']([^"']+)["']/g,
    /@RequestParam(?:\([^)]*["']([^"']+)["'][^)]*\))?\s+\w+\s+([A-Za-z_][\w]*)/g,
    /c\.Query\(["']([^"']+)["']\)/g,
    /\$request->query\(["']([^"']+)["']/g,
    /\$request->input\(["']([^"']+)["']/g,
    /ctx\.query\[["']([^"']+)["']\]/g,
    /request\.GET\.get\(["']([^"']+)["']/g,
    /query\s*\.\s*([A-Za-z_][\w]*)/g
  ]) {
    for (const match of code.matchAll(pattern)) names.add(match[1] || match[2]);
  }

  if (/ArticleFilter|filter\(/i.test(code) && /articles/i.test(apiPath)) {
    ["tag", "author", "favorited", "limit", "offset"].forEach(n => names.add(n));
  }
  if (/[Pp]aginate|paginate/.test(code)) {
    ["limit", "offset"].forEach(n => names.add(n));
  }

  return [...names].filter(Boolean).map(name => ({
    name,
    type: inferType(name, code),
    required: false,
    description: buildQueryDescription(name)
  }));
}

function buildQueryDescription(name) {
  const map = {
    limit: "Number of results to return (default: 20).",
    offset: "Number of results to skip (default: 0).",
    tag: "Filter articles by tag.",
    author: "Filter articles by author username.",
    favorited: "Filter articles favorited by this username.",
    page: "Page number for pagination.",
    q: "Search query string.",
    sort: "Sort field.",
    order: "Sort order: asc or desc.",
    search: "Full-text search string."
  };
  return map[name] || `Query parameter: ${name}.`;
}

function extractHeaders(code, authRequired) {
  const names = new Set();
  for (const pattern of [
    /req\.headers\[['"`]([^'"`]+)['"`]\]/gi,
    /req\.get\(['"`]([^'"`]+)['"`]\)/gi,
    /headers\.get\(['"`]([^'"`]+)['"`]\)/gi,
    /@RequestHeader\(["']([^"']+)["']\)/g,
    /request\.headers\[["']([^"']+)["']\]/g
  ]) {
    for (const match of code.matchAll(pattern)) names.add(match[1]);
  }
  if (authRequired || /authorization|bearer|jwt|passport|login_required|jwt_required/i.test(code)) {
    names.add("Authorization");
  }
  return [...names].map(name => ({
    name,
    required: /authorization/i.test(name),
    format: /authorization/i.test(name) ? "Bearer <token>" : undefined,
    description: /authorization/i.test(name) ? "JWT Bearer token. Format: Token <jwt>." : `Header: ${name}.`
  }));
}

function extractBody(code, method, action) {
  const properties = {};
  const required   = new Set();
  const bodyNames  = new Set();

  /* JS body destructure */
  for (const match of code.matchAll(/req\.body\.([A-Za-z_][\w]*)/g)) bodyNames.add(match[1]);
  for (const match of code.matchAll(/const\s*\{([^}]+)\}\s*=\s*req\.body/g)) {
    match[1].split(",").map(s => s.trim().split(/[=:]/)[0].trim()).filter(Boolean).forEach(v => bodyNames.add(v));
  }
  /* request.body (general) */
  for (const match of code.matchAll(/request\.body\.([A-Za-z_][\w]*)/g)) bodyNames.add(match[1]);
  /* ctx.request.body (Koa) */
  for (const match of code.matchAll(/ctx\.request\.body\.([A-Za-z_][\w]*)/g)) bodyNames.add(match[1]);

  /* Laravel */
  for (const match of code.matchAll(/\$request->input\(["'][\w.]*\.(\w+)["']\)/g)) bodyNames.add(match[1]);
  for (const match of code.matchAll(/\$request->input\(["'](\w+)["']\)/g)) bodyNames.add(match[1]);
  for (const match of code.matchAll(/\$request->get\(["'](\w+)["']\)/g)) bodyNames.add(match[1]);
  for (const match of code.matchAll(/\$request->only\(([^)]+)\)/g)) {
    for (const part of match[1].matchAll(/["'](\w+)["']/g)) bodyNames.add(part[1]);
  }
  for (const match of code.matchAll(/\$request->validated\(\)/g)) {
    /* All validated fields come from rules — harvested below */
  }

  /* Laravel validation rules — most reliable */
  for (const match of code.matchAll(/'([A-Za-z_.]+)'\s*=>\s*'([^']+)'/g)) {
    const field = match[1].split(".").pop();
    const rules = match[2].split("|");
    bodyNames.add(field);
    if (rules.includes("required")) required.add(field);
    properties[field] = {
      type: inferTypeFromRules(field, rules),
      required: rules.includes("required"),
      validationRules: rules,
      description: buildFieldDescription(field, rules),
      example: exampleFor(field)
    };
    if (rules.some(r => /email/i.test(r)))  { properties[field].format = "email"; properties[field].example = "user@example.com"; }
    if (rules.some(r => r.startsWith("max:"))) properties[field].maxLength = parseInt(rules.find(r => r.startsWith("max:")).replace("max:","")) || undefined;
    if (rules.some(r => r.startsWith("min:"))) properties[field].minLength = parseInt(rules.find(r => r.startsWith("min:")).replace("min:","")) || undefined;
  }

  /* Zod schema */
  for (const match of code.matchAll(/([A-Za-z_][\w]*)\s*:\s*z\.(string|number|boolean|array|object)\(\)([^,\n}]*)/g)) {
    bodyNames.add(match[1]);
    if (!/optional\(\)/.test(match[3])) required.add(match[1]);
  }

  /* Python Pydantic / type annotations */
  for (const match of code.matchAll(/^\s*([A-Za-z_][\w]*)\s*:\s*(str|int|float|bool|list|dict)\b/gm)) bodyNames.add(match[1]);

  /* TypeScript interface / class body fields */
  for (const match of code.matchAll(/@(?:IsString|IsNumber|IsEmail|IsOptional|IsBoolean|IsArray|IsNotEmpty)\s*\(\s*\)\s*\n\s*([A-Za-z_][\w]*)\s*[!?]?\s*:/g)) {
    bodyNames.add(match[1]);
  }

  /* Fill remaining names */
  for (const name of bodyNames) {
    if (!properties[name]) {
      properties[name] = {
        type: inferType(name, code),
        required: required.has(name),
        description: `Request body field: ${name}.`,
        example: exampleFor(name)
      };
    }
  }

  const hasBody = ["POST", "PUT", "PATCH"].includes(method) || Object.keys(properties).length > 0;
  return {
    contentType: "application/json",
    required: hasBody && Object.keys(properties).length > 0,
    schema: { type: "object", properties }
  };
}

function inferTypeFromRules(name, rules) {
  if (rules.some(r => /^integer$|^numeric$/.test(r))) return "integer";
  if (rules.some(r => /^boolean$/.test(r)))           return "boolean";
  if (rules.some(r => /^array$/.test(r)))             return "array";
  return inferType(name, "");
}

function buildFieldDescription(field, rules) {
  const parts = [];
  if (rules.includes("required"))                   parts.push("Required.");
  else if (rules.includes("sometimes"))             parts.push("Optional.");
  else if (rules.includes("nullable"))              parts.push("Nullable.");
  if (rules.some(r => r.startsWith("max:")))        parts.push(`Max length: ${rules.find(r => r.startsWith("max:")).replace("max:", "")}.`);
  if (rules.some(r => r.startsWith("min:")))        parts.push(`Min length/value: ${rules.find(r => r.startsWith("min:")).replace("min:", "")}.`);
  if (rules.includes("email"))                      parts.push("Must be valid email.");
  if (rules.some(r => r.startsWith("unique:")))     parts.push("Must be unique.");
  if (rules.includes("alpha_num"))                  parts.push("Alphanumeric only.");
  if (rules.includes("url"))                        parts.push("Must be a URL.");
  if (rules.some(r => r.startsWith("in:")))         parts.push(`Allowed values: ${rules.find(r => r.startsWith("in:")).replace("in:","")}.`);
  return parts.join(" ") || `Field: ${field}.`;
}

function extractValidationRules(code) {
  const rules = {};
  for (const match of code.matchAll(/'([A-Za-z_.]+)'\s*=>\s*'([^']+)'/g)) {
    rules[match[1]] = match[2];
  }
  /* Zod rules */
  for (const match of code.matchAll(/([A-Za-z_][\w]*)\s*:\s*z\.(string|number|boolean|array|object)\(\)([^,\n}]*)/g)) {
    rules[match[1]] = `z.${match[2]}()${match[3].trim()}`;
  }
  return rules;
}

function inferType(name, code) {
  if (/parseInt|Number\(|int\b|Integer|Long|page|limit|count|age|qty|amount|price|total|_id$/i.test(name)) return "integer";
  if (/float|double|decimal/i.test(name)) return "number";
  if (/bool|enabled|active|is[A-Z]/.test(name)) return "boolean";
  if (/array|list|items|ids$|tagList/i.test(name)) return "array";
  return "string";
}

function exampleFor(name) {
  const map = {
    email: "user@example.com", password: "Str0ng!Pass", username: "john_doe",
    name: "Jane Doe", title: "My Amazing Article", body: "Article body content here.",
    description: "A short description.", bio: "I am a software developer.",
    slug: "my-article", image: "https://example.com/avatar.png",
    id: 1, limit: 20, offset: 0, page: 1, tag: "technology",
    tagList: ["tech","science"]
  };
  if (map[name] !== undefined) return map[name];
  if (/id$/i.test(name)) return 123;
  if (/url|image/i.test(name)) return "https://example.com/image.png";
  if (/email/i.test(name)) return "user@example.com";
  if (/name/i.test(name)) return "Jane Doe";
  return "string";
}

/* ═══════════════════════════════════════════════════════════════
   RESPONSE EXTRACTION
═══════════════════════════════════════════════════════════════ */
function extractResponses(code, method) {
  const found = new Map();
  const add = (status, description, schema = null) => {
    const numeric = Number(status);
    if (numeric >= 100 && numeric <= 599) {
      found.set(numeric, { status: numeric, description, schema: schema || defaultSchema(numeric) });
    }
  };

  for (const match of code.matchAll(/res\.status\((\d{3})\)(?:\s*\.\s*json\(([\s\S]*?)\))?/g)) add(match[1], statusDescription(match[1]), inferSchemaFromObject(match[2] || ""));
  for (const match of code.matchAll(/res\.json\(([\s\S]*?)\)/g)) add(200, "Success", inferSchemaFromObject(match[1]));
  for (const match of code.matchAll(/status_code\s*=\s*(\d{3})/g)) add(match[1], statusDescription(match[1]));
  for (const match of code.matchAll(/JSONResponse\([^)]*status_code\s*=\s*(\d{3})/g)) add(match[1], statusDescription(match[1]));
  for (const match of code.matchAll(/c\.JSON\((\d{3})/g)) add(match[1], statusDescription(match[1]));
  for (const match of code.matchAll(/ctx\.status\s*=\s*(\d{3})/g)) add(match[1], statusDescription(match[1]));
  for (const match of code.matchAll(/ResponseEntity\.status\((?:HttpStatus\.)?([A-Z_]+|\d{3})\)/g)) add(httpStatusNumber(match[1]), statusDescription(httpStatusNumber(match[1])));
  for (const match of code.matchAll(/\.sendStatus\((\d{3})\)/g)) add(match[1], statusDescription(match[1]));
  for (const match of code.matchAll(/return\s+(?:new\s+)?Response\s*\(\s*.*?status:\s*(\d{3})/gs)) add(match[1], statusDescription(match[1]));

  if (/respondWithTransformer|respondWithPagination/i.test(code)) add(200, "Success — resource returned.");
  if (/respondSuccess/i.test(code))     add(200, "Success — action completed.");
  if (/respondFailedLogin/i.test(code)) add(422, "Validation error — invalid credentials.");
  if (/FormRequest|ApiRequest/i.test(code)) add(422, "Unprocessable entity — validation failed.");
  if (/auth\.api|jwt_required|login_required|passport\.authenticate|@UseGuards/i.test(code)) add(401, "Unauthorized — authentication required.");
  if (/authorize\(\)|403|forbidden/i.test(code)) add(403, "Forbidden — action not permitted.");
  if (/404|not[_\s]found|findOrFail|throw new NotFoundException/i.test(code)) add(404, "Not found.");

  if (!found.size) add(method === "POST" ? 201 : 200, "Success.");
  if (!found.has(500)) add(500, "Internal server error.");

  return [...found.values()].sort((a, b) => a.status - b.status);
}

function defaultSchema(status) {
  if (status >= 400) return { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } };
  return { type: "object", properties: {} };
}

function statusDescription(status) {
  return ({
    200:"Success", 201:"Created", 204:"No content",
    400:"Bad request", 401:"Unauthorized", 403:"Forbidden",
    404:"Not found", 409:"Conflict", 422:"Unprocessable entity",
    429:"Too many requests", 500:"Internal server error"
  })[Number(status)] || "Response";
}

function httpStatusNumber(status) {
  if (/^\d+$/.test(String(status))) return Number(status);
  return ({OK:200,CREATED:201,NO_CONTENT:204,BAD_REQUEST:400,UNAUTHORIZED:401,
    FORBIDDEN:403,NOT_FOUND:404,CONFLICT:409,INTERNAL_SERVER_ERROR:500})[status] || 200;
}

function inferSchemaFromObject(raw) {
  const properties = {};
  if (!raw) return { type:"object", properties };
  for (const match of raw.matchAll(/([A-Za-z_][\w]*)\s*:/g)) {
    if (!["http","https"].includes(match[1])) properties[match[1]] = { type: inferType(match[1], raw) };
  }
  return { type:"object", properties };
}

function detectAuth(code) {
  return /\bauth\b|jwt|passport|bearer|authorization|login_required|jwt_required|PreAuthorize|Secured|x-api-key|@UseGuards|verifyToken/i.test(code);
}

function extractErrorCodes(code) {
  const errors = new Map();
  for (const match of code.matchAll(/["']([A-Z][A-Z0-9_]{3,})["']/g)) {
    if (/ERR|ERROR|INVALID|NOT_FOUND|UNAUTHORIZED|FORBIDDEN/.test(match[1])) {
      errors.set(match[1], {
        code: match[1],
        message: humanizeConstant(match[1]),
        resolution: "Check the request data, authentication, and referenced resource state."
      });
    }
  }
  return [...errors.values()];
}

function humanizeConstant(code) {
  return code.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/* ═══════════════════════════════════════════════════════════════
   DATA MODEL EXTRACTION
   Scans for Eloquent models, Sequelize models, TypeORM entities,
   Mongoose schemas, Pydantic models, Spring @Entity
═══════════════════════════════════════════════════════════════ */
function extractDataModels(files) {
  const models = [];
  const seen = new Set();

  for (const f of files) {
    const content = f.content;

    /* ── Laravel/PHP Eloquent ── */
    if (f.ext === ".php") {
      const classMatch = content.match(/class\s+(\w+)\s+extends\s+(?:Model|Authenticatable|Pivot)/);
      if (classMatch) {
        const modelName = classMatch[1];
        if (seen.has(modelName)) continue;
        seen.add(modelName);
        const fillableMatch = content.match(/\$fillable\s*=\s*\[([^\]]+)\]/);
        const tableMatch    = content.match(/\$table\s*=\s*['"]([^'"]+)['"]/);
        const fields = [];
        if (fillableMatch) {
          for (const m of fillableMatch[1].matchAll(/["']([^"']+)["']/g)) {
            fields.push({ name: m[1], type: inferType(m[1], ""), nullable: true, description: `Fillable field: ${m[1]}.` });
          }
        }
        /* Extract casts */
        const castsMatch = content.match(/\$casts\s*=\s*\[([^\]]+)\]/);
        if (castsMatch) {
          for (const m of castsMatch[1].matchAll(/["'](\w+)["']\s*=>\s*["'](\w+)["']/g)) {
            const existing = fields.find(f => f.name === m[1]);
            if (existing) existing.type = castType(m[2]);
            else fields.push({ name: m[1], type: castType(m[2]), nullable: true, description: `Cast field.` });
          }
        }
        /* Detect relations */
        const relations = [];
        for (const m of content.matchAll(/public\s+function\s+(\w+)\s*\(\s*\)\s*\{[^}]*\$(this)->(hasMany|hasOne|belongsTo|belongsToMany|morphTo|morphMany)\s*\(\s*(\w+)::class/g)) {
          relations.push(`${m[3]}(${m[4]})`);
        }
        models.push({ name: modelName, table: tableMatch ? tableMatch[1] : toSnakePlural(modelName), fields, relations, source: path.basename(f.path) });
      }
    }

    /* ── TypeScript / TypeORM @Entity ── */
    if ([".ts",".tsx"].includes(f.ext)) {
      if (!/@Entity/.test(content)) continue;
      for (const m of content.matchAll(/@Entity\s*\(\s*(?:["']([^"']+)["'])?\s*\)\s*(?:\n[^\n]*\n)*?(?:export\s+)?class\s+(\w+)/g)) {
        const modelName = m[2];
        if (seen.has(modelName)) continue;
        seen.add(modelName);
        const table = m[1] || toSnakePlural(modelName);
        const fields = [];
        for (const col of content.matchAll(/@Column\s*\(\s*(?:\{[^}]*\})?\s*\)\s*\n?\s*([A-Za-z_][\w]*)\s*[!?]?\s*:\s*([\w<>[\]|]+)/g)) {
          fields.push({ name: col[1], type: tsTypeToJsonType(col[2]), nullable: false, description: `Column: ${col[1]}.` });
        }
        models.push({ name: modelName, table, fields, relations: [], source: path.basename(f.path) });
      }
    }

    /* ── JavaScript Mongoose Schema ── */
    if ([".js",".jsx",".ts",".tsx"].includes(f.ext)) {
      if (!/new Schema|mongoose\.Schema/.test(content)) continue;
      for (const m of content.matchAll(/(?:const|let|var)\s+(\w+Schema)\s*=\s*new(?:\s+mongoose\.)?Schema\s*\(\s*\{([^}]+)\}/g)) {
        const schemaVar = m[1];
        const modelName = schemaVar.replace(/Schema$/,"");
        if (seen.has(modelName)) continue;
        seen.add(modelName);
        const fields = [];
        
        /* Handle both shorthand and full syntax */
        // Full syntax: fieldName: { type: String, required: true }
        for (const col of m[2].matchAll(/([A-Za-z_][\w]*)\s*:\s*\{\s*type:\s*(\w+)/g)) {
          fields.push({ name: col[1], type: mongooseTypeToJson(col[2]), nullable: true, description: `Field: ${col[1]}.` });
        }
        
        // Shorthand syntax: fieldName: String
        for (const col of m[2].matchAll(/([A-Za-z_][\w]*)\s*:\s*(\w+)(?!\s*[,}])/g)) {
          // Skip if already found in full syntax
          if (!fields.some(f => f.name === col[1])) {
            fields.push({ name: col[1], type: mongooseTypeToJson(col[2]), nullable: true, description: `Field: ${col[1]} (shorthand).` });
          }
        }
        
        models.push({ name: modelName, table: toSnakePlural(modelName), fields, relations: [], source: path.basename(f.path) });
      }
    }
  }

  return models;
}

function castType(t) {
  return ({ integer:"integer", boolean:"boolean", float:"number", array:"array",
    object:"object", date:"string", datetime:"string", json:"object" })[t] || "string";
}

function tsTypeToJsonType(t) {
  return ({ number:"integer", string:"string", boolean:"boolean",
    Date:"string", boolean_:"boolean" })[t] || "string";
}

function mongooseTypeToJson(t) {
  return ({ String:"string", Number:"integer", Boolean:"boolean",
    Date:"string", Array:"array", Mixed:"object", ObjectId:"string" })[t] || "string";
}

function toSnakePlural(name) {
  return name.replace(/([A-Z])/g, (_, c, i) => (i?`_${c}`:c).toLowerCase())
    .replace(/y$/, "ies").replace(/(?<!s)$/, "s");
}

/* ═══════════════════════════════════════════════════════════════
   AUTH MATRIX BUILDER
═══════════════════════════════════════════════════════════════ */
function buildAuthMatrix(endpoints) {
  const matrix = {};
  for (const ep of endpoints) {
    const tag = ep.tags[0] || "other";
    if (!matrix[tag]) matrix[tag] = [];
    matrix[tag].push({ method: ep.method, path: ep.path, authRequired: ep.authRequired, middleware: ep.middleware });
  }
  return matrix;
}

/* ═══════════════════════════════════════════════════════════════
   SPEC PARSING (existing OpenAPI / YAML)
═══════════════════════════════════════════════════════════════ */
function parseExistingSpec(file) {
  try {
    if (file.ext === ".json" || (file.name||"").toLowerCase().endsWith(".json")) {
      return endpointsFromSpec(JSON.parse(file.content), file.path);
    }
    return endpointsFromSimpleYaml(file.content, file.path);
  } catch { return []; }
}

function endpointsFromSpec(spec, sourceFile) {
  const endpoints = [];
  for (const [apiPath, methods] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(methods || {})) {
      if (!/^(get|post|put|patch|delete|options|head)$/i.test(method)) continue;
      endpoints.push({
        method: method.toUpperCase(),
        path: normalizePath(apiPath),
        summary: op.summary || summarizeEndpoint(method.toUpperCase(), apiPath, ""),
        description: op.description || "Imported from existing OpenAPI specification.",
        tags: op.tags || [inferTag(apiPath)],
        operationId: op.operationId || operationId(method.toUpperCase(), apiPath),
        deprecated: Boolean(op.deprecated), authRequired: Boolean(op.security),
        controller: "", action: "", middleware: [],
        request: { pathParams: extractPathParams(normalizePath(apiPath)), queryParams: [], headers: [], body: { contentType: "application/json", required: Boolean(op.requestBody), schema: {} } },
        responses: Object.entries(op.responses || {}).map(([status, value]) => ({ status: Number(status), description: value.description || statusDescription(status), schema: value.content?.["application/json"]?.schema || {} })),
        validationRules: {}, errorCodes: [],
        source: "existing_spec", sourceFile, sourceLine: 1, confidence: 1, rawContext: ""
      });
    }
  }
  return endpoints;
}

function endpointsFromSimpleYaml(content, sourceFile) {
  const endpoints = [];
  let inPaths = false, currentPath = null;
  for (const line of content.split(/\r?\n/)) {
    if (/^paths:\s*$/.test(line)) { inPaths = true; continue; }
    if (!inPaths) continue;
    const pathMatch = line.match(/^\s{2}(["']?\/[^:"']+["']?):\s*$/);
    if (pathMatch) currentPath = pathMatch[1].replace(/["']/g, "");
    const methodMatch = line.match(/^\s{4}(get|post|put|patch|delete|options|head):\s*$/i);
    if (currentPath && methodMatch) {
      const method = methodMatch[1].toUpperCase();
      endpoints.push({
        method, path: normalizePath(currentPath),
        summary: summarizeEndpoint(method, currentPath, ""),
        description: "Imported from existing YAML specification.",
        tags: [inferTag(currentPath)], operationId: operationId(method, currentPath),
        deprecated: false, authRequired: false, controller: "", action: "", middleware: [],
        request: { pathParams: extractPathParams(normalizePath(currentPath)), queryParams: [], headers: [], body: { contentType: "application/json", required: false, schema: {} } },
        responses: [{ status: 200, description: "Success", schema: { type:"object", properties:{} } }],
        validationRules: {}, errorCodes: [],
        source: "existing_spec", sourceFile, sourceLine: 1, confidence: 1, rawContext: ""
      });
    }
  }
  return endpoints;
}

/* ═══════════════════════════════════════════════════════════════
   MERGE + DIFF
═══════════════════════════════════════════════════════════════ */
function mergeEndpoints(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = `${item.method} ${item.path}`;
    const existing = byKey.get(key);
    if (!existing || item.confidence > existing.confidence) byKey.set(key, item);
  }
  return [...byKey.values()].sort((a,b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function diffEndpoints(specEndpoints, codeEndpoints) {
  const spec = new Map(specEndpoints.map(e => [`${e.method} ${e.path}`, e]));
  const code = new Map(codeEndpoints.map(e => [`${e.method} ${e.path}`, e]));
  return {
    newInCode: [...code.entries()].filter(([key]) => !spec.has(key)).map(([, e]) => e),
    removedFromSpec: [...spec.entries()].filter(([key]) => !code.has(key)).map(([, e]) => e),
    inSync: [...code.entries()].filter(([key]) => spec.has(key)).map(([, e]) => e),
    changed: [...code.entries()].filter(([key, e]) => spec.has(key) && JSON.stringify(spec.get(key).responses) !== JSON.stringify(e.responses)).map(([key, e]) => ({ code: e, spec: spec.get(key) }))
  };
}

module.exports = { analyzeCodebase, analyzeVirtualFiles, normalizePath };
