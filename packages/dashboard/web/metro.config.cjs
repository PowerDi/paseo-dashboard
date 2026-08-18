const { getDefaultConfig } = require("expo/metro-config");
const { resolve } = require("metro-resolver");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);
config.resolver.useWatchman = false;
const relaySrcRoot = path.resolve(projectRoot, "../../relay/src");
const defaultResolveRequest = config.resolver.resolveRequest || resolve;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath;
  if (origin && origin.startsWith(relaySrcRoot) && moduleName.endsWith(".js")) {
    const tsModuleName = moduleName.replace(/\.js$/, ".ts");
    const candidatePath = path.resolve(path.dirname(origin), tsModuleName);
    if (fs.existsSync(candidatePath)) {
      return defaultResolveRequest(context, tsModuleName, platform);
    }
  }
  return defaultResolveRequest(context, moduleName, platform);
};

const dashboardApiUrl = process.env.PASEO_DASHBOARD_API_URL || "http://127.0.0.1:3002";
const dashboardApi = new URL(dashboardApiUrl);

function proxyApiRequest(req, res, next) {
  if (!req.url?.startsWith("/api/")) {
    next();
    return;
  }

  const transport = dashboardApi.protocol === "https:" ? https : http;
  const request = transport.request(
    {
      hostname: dashboardApi.hostname,
      port: dashboardApi.port || (dashboardApi.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        host: dashboardApi.host,
      },
    },
    (upstream) => {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    },
  );

  request.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: "Dashboard API unavailable", detail: error.message }));
  });

  req.pipe(request);
}

const originalEnhanceMiddleware = config.server?.enhanceMiddleware;
config.server = config.server || {};
config.server.enhanceMiddleware = (metroMiddleware, server) => {
  const middleware = originalEnhanceMiddleware
    ? originalEnhanceMiddleware(metroMiddleware, server)
    : metroMiddleware;
  return (req, res, next) => proxyApiRequest(req, res, () => middleware(req, res, next));
};

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: path.join(projectRoot, "node_modules/react"),
  "react-dom": path.join(projectRoot, "node_modules/react-dom"),
};

module.exports = config;
