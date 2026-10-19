/**
 * Public identity codenames. A user's public codename (`USER // WORD-N`) is what other players see when the
 * identity setting hides the username; a rival assignment gets its own `RIVAL // WORD-N`.
 * Migration 0017 backfills existing profiles from this list (hard-coded, sorted as here): the list may only be appended to.
 */
export const CODENAME_WORDS = [
  "ANCHOR", "ARROW", "ASH", "ATLAS", "AXIS", "BEACON", "BLADE", "BOLT", "BRAVE", "BRIAR",
  "CAIRN", "CEDAR", "CINDER", "CLIFF", "COMET", "CORAL", "CRAG", "CREST", "DAWN", "DRIFT",
  "DUNE", "DUSK", "EBB", "EMBER", "FALCON", "FERN", "FINCH", "FJORD", "FLARE", "FLINT",
  "FORGE", "FROST", "GALE", "GLACIER", "GRANITE", "GROVE", "HARBOR", "HAWK", "HELM", "HERON",
  "HOLLOW", "IRON", "IVY", "JADE", "JUNIPER", "KESTREL", "KINDLE", "LANTERN", "LARK", "LEDGE",
  "LUMEN", "LYNX", "MARSH", "MERIDIAN", "MESA", "MIST", "MOSS", "NEBULA", "NOMAD", "NORTH",
  "OAK", "ONYX", "ORBIT", "OTTER", "OWL", "PEAK", "PEBBLE", "PIKE", "PINE", "PIVOT",
  "PRISM", "QUARRY", "QUARTZ", "QUILL", "RAVEN", "REEF", "RIDGE", "RIVER", "ROOK", "RUNE",
  "SABLE", "SAGE", "SCOUT", "SEDGE", "SHALE", "SIGNAL", "SLATE", "SPARK", "SPIRE", "SPRUCE",
  "STEEL", "STONE", "STORM", "SUMMIT", "SWIFT", "TALON", "TEMPEST", "THISTLE", "THORN", "TIDE",
  "TIMBER", "TORCH", "TRAIL", "TUNDRA", "VALE", "VANGUARD", "VAULT", "VERGE", "VIPER", "VISTA",
  "WARDEN", "WILLOW", "WIND", "WOLF", "WREN", "YARROW", "ZENITH", "ZEPHYR",
] as const;

export const USER_CODENAME_PREFIX = "USER";
export const RIVAL_CODENAME_PREFIX = "RIVAL";
export const USER_CODENAME_RE = /^USER \/\/ [A-Z]+(?:-[A-Z]+)?-[1-9]$/;

/** Attempts (0-based) from which a codename gets a second word, so uniqueness retries cannot exhaust the namespace. */
export const CODENAME_SINGLE_WORD_ATTEMPTS = 12;

function build(prefix: string, rng: () => number, attempt: number): string {
  const pick = (n: number) => Math.min(n - 1, Math.floor(rng() * n));
  const word = CODENAME_WORDS[pick(CODENAME_WORDS.length)]!;
  const second = attempt >= CODENAME_SINGLE_WORD_ATTEMPTS ? `-${CODENAME_WORDS[pick(CODENAME_WORDS.length)]!}` : "";
  return `${prefix} // ${word}${second}-${pick(9) + 1}`;
}

/** `USER // <WORD>-<1..9>`; pass the retry attempt number after a uniqueness collision. */
export function generateUserCodename(rng: () => number = Math.random, attempt = 0): string {
  return build(USER_CODENAME_PREFIX, rng, attempt);
}

/** `RIVAL // <WORD>-<1..9>`. */
export function generateRivalCodename(rng: () => number = Math.random, attempt = 0): string {
  return build(RIVAL_CODENAME_PREFIX, rng, attempt);
}
