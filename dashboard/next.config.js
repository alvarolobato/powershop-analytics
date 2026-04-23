const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_PKG_VERSION: (() => {
      const raw = fs.readFileSync(path.join(__dirname, "package.json"), "utf8");
      return JSON.parse(raw).version;
    })(),
    NEXT_PUBLIC_APP_GIT_DESCRIBE: (() => {
      const fromEnv = process.env.APP_GIT_DESCRIBE?.trim();
      if (fromEnv) return fromEnv;
      try {
        return execSync("git describe --tags --always --dirty", {
          cwd: __dirname,
          encoding: "utf8",
        }).trim();
      } catch {
        return "";
      }
    })(),
  },
};

module.exports = nextConfig;
