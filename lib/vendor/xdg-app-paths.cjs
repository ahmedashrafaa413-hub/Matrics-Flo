"use strict";

// The upstream package derives its default application name from
// process.argv[0]. Next.js intentionally leaves that value undefined while it
// collects route metadata, which makes Workflow's webhook route fail at build
// time. This small compatible implementation uses an explicit stable name.
const os = require("node:os");
const path = require("node:path");

function createPaths(options = {}) {
  const name =
    typeof options === "string"
      ? options
      : options.name || process.env.VERCEL_PROJECT_ID || "metricsflo";
  const isolated =
    typeof options === "object" && typeof options.isolated === "boolean"
      ? options.isolated
      : true;

  const appendName = (base, localOptions = {}) => {
    const useName =
      typeof localOptions.isolated === "boolean"
        ? localOptions.isolated
        : isolated;
    return path.join(base, useName ? name : "");
  };

  const fn = (nextOptions = {}) => createPaths(nextOptions);
  fn.$name = () => name;
  fn.$isolated = () => isolated;
  fn.cache = (value) =>
    appendName(
      process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
      value
    );
  fn.config = (value) =>
    appendName(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      value
    );
  fn.data = (value) =>
    appendName(
      process.env.XDG_DATA_HOME ||
        path.join(os.homedir(), ".local", "share"),
      value
    );
  fn.state = (value) =>
    appendName(
      process.env.XDG_STATE_HOME ||
        path.join(os.homedir(), ".local", "state"),
      value
    );
  fn.runtime = (value) => {
    const base = process.env.XDG_RUNTIME_DIR;
    return base ? appendName(base, value) : undefined;
  };
  fn.configDirs = (value) => [
    fn.config(value),
    ...(process.env.XDG_CONFIG_DIRS || "/etc/xdg")
      .split(path.delimiter)
      .map((directory) => appendName(directory, value))
  ];
  fn.dataDirs = (value) => [
    fn.data(value),
    ...(process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share")
      .split(path.delimiter)
      .map((directory) => appendName(directory, value))
  ];

  return fn;
}

module.exports = createPaths({ name: "metricsflo" });
