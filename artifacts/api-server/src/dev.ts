// Dev entry: sets NODE_ENV (cross-platform) before the app and its env/logger modules load.
process.env.NODE_ENV ??= "development";
await import("./index");
export {};
