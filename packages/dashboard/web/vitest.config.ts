import fs from "node:fs";
import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

const dashboardDir = path.resolve(__dirname);
const dashboardNodeModules = path.resolve(dashboardDir, "node_modules");
const rootNodeModules = path.resolve(dashboardDir, "../../../node_modules");
const resolvePackageEntry = (packageName: string) => {
  const dashboardPackagePath = path.resolve(dashboardNodeModules, packageName);
  return fs.existsSync(dashboardPackagePath)
    ? dashboardPackagePath
    : path.resolve(rootNodeModules, packageName);
};

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "e2e/**"],
    setupFiles: [path.resolve(dashboardDir, "vitest.setup.ts")],
    pool: "forks",
    maxWorkers: 2,
    server: {
      deps: {
        fallbackCJS: true,
        inline: ["zustand", "@tanstack/react-query", "react-native-web"],
      },
    },
  },
  optimizeDeps: {
    include: ["react/jsx-runtime"],
    exclude: ["react-native-reanimated"],
  },
  define: {
    "process.env.JEST_WORKER_ID": "undefined",
    __DEV__: "false",
    global: "globalThis",
  },
  resolve: {
    extensions: [
      ".web.mjs",
      ".web.js",
      ".web.mts",
      ".web.ts",
      ".web.jsx",
      ".web.tsx",
      ".mjs",
      ".js",
      ".mts",
      ".ts",
      ".jsx",
      ".tsx",
      ".json",
    ],
    alias: [
      {
        find: /^@getpaseo\/relay\/e2ee$/,
        replacement: path.resolve(dashboardDir, "../../relay/src/e2ee.ts"),
      },
      {
        find: /^@getpaseo\/relay$/,
        replacement: path.resolve(dashboardDir, "../../relay/src/index.ts"),
      },
      { find: "@", replacement: path.resolve(dashboardDir, "src") },
      {
        find: /^react-native\/Libraries\/Renderer\/shims\/ReactFabric$/,
        replacement: path.resolve(dashboardDir, "test-stubs/react-native-fabric-shim.ts"),
      },
      {
        find: "react-native",
        replacement: path.resolve(rootNodeModules, "react-native-web/dist/index.js"),
      },
      { find: "react", replacement: resolvePackageEntry("react") },
      { find: "react-dom", replacement: resolvePackageEntry("react-dom") },
      {
        find: /^@xterm\/addon-ligatures\/lib\/addon-ligatures\.mjs$/,
        replacement: path.resolve(dashboardDir, "test-stubs/xterm-addon-ligatures.ts"),
      },
      {
        find: /^@xterm\/addon-ligatures$/,
        replacement: path.resolve(dashboardDir, "test-stubs/xterm-addon-ligatures.ts"),
      },
      {
        find: /^react-native-unistyles$/,
        replacement: path.resolve(dashboardDir, "test-stubs/react-native-unistyles.ts"),
      },
      {
        find: /^react-native-svg$/,
        replacement: path.resolve(dashboardDir, "test-stubs/react-native-svg.ts"),
      },
      {
        find: /^react-native-safe-area-context$/,
        replacement: path.resolve(dashboardDir, "test-stubs/react-native-safe-area-context.ts"),
      },
      {
        find: /^@gorhom\/bottom-sheet$/,
        replacement: path.resolve(dashboardDir, "test-stubs/gorhom-bottom-sheet.ts"),
      },
      {
        find: /^react-native-reanimated\/scripts\/validate-worklets-version$/,
        replacement: path.resolve(
          dashboardDir,
          "test-stubs/reanimated-validate-worklets-version.ts",
        ),
      },
      {
        find: /^expo-linking$/,
        replacement: path.resolve(dashboardDir, "test-stubs/expo-linking.ts"),
      },
      {
        find: /^lucide-react-native$/,
        replacement: path.resolve(dashboardDir, "test-stubs/lucide-react-native.ts"),
      },
    ],
  },
});
