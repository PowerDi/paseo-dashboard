const pkg = require("./package.json");

module.exports = {
  expo: {
    name: "Paseo Dashboard",
    slug: "paseo-dashboard",
    version: pkg.version,
    scheme: "paseo-dashboard",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    web: { output: "single", favicon: "./assets/images/favicon.png" },
    plugins: ["expo-router"],
  },
};
