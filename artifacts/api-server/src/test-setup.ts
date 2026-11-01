// Loaded via `tsx --import` before every test file: keeps logs silent and env deterministic.
process.env.NODE_ENV ??= "test";
// No OpenStreetMap calls from tests: the places service skips Overpass when this is "off".
process.env.OVERPASS_URL ??= "off";
