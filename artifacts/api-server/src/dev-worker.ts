// Dev worker entry: sets NODE_ENV (cross-platform) before the worker and its env/logger modules load.
process.env.NODE_ENV ??= "development";
await import("./worker");
export {};
