// Shadow Monarch palette (design direction of 2026-10-20, .impeccable/surfaces/app.md).
// Every text colour here is >= 4.5:1 on `background` and on `card`; `border` is for lines only.
const colors = {
  light: {
    text: "#F1ECF7",
    tint: "#A879FF",

    background: "#07060B",
    foreground: "#F1ECF7",

    /** Solid surface for rows and sheets. */
    card: "#120F1A",
    cardForeground: "#F1ECF7",

    /** Frosted System window fill and frame (see components/ui/SystemWindow). */
    panel: "rgba(38,28,64,0.55)",
    frame: "rgba(176,140,255,0.55)",

    /** Navigation bar and app bar surface. */
    surface: "#0E0C15",

    primary: "#A879FF",
    primaryForeground: "#0B0812",

    secondary: "#1A1524",
    secondaryForeground: "#C9C1D6",

    /** Fill for inactive chips, tracks and pressed rows. */
    muted: "#1C1726",
    mutedForeground: "#B5ACC4",

    accent: "#A879FF",
    accentForeground: "#0B0812",

    destructive: "#F0606B",
    destructiveForeground: "#140608",

    warn: "#F2B544",
    success: "#3DD68C",

    /** Tertiary text (timestamps, hints). Still >= 4.5:1. */
    subtle: "#8E85A0",

    border: "#2A2340",
    input: "#2A2340",

    rank: {
      E: "#8A93A6",
      D: "#4F8FE0",
      C: "#2FA36B",
      B: "#D4A62A",
      A: "#E8604C",
      S: "#E8D5A3",
    },

    domain: {
      BODY: "#E8604C",
      MIND: "#4F8FE0",
      WEALTH: "#2FA36B",
      SOCIAL: "#D4A62A",
      DISCIPLINE: "#C77DDB",
    },
  },

  radius: 4,
};

export default colors;
