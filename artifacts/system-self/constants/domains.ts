import type { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import colors from "@/constants/colors";
import { DOMAINS } from "@/lib/game/mappers";
import type { Domain } from "@/lib/game/types";

/** The five ranked domains, in display order. */
export const ALL_DOMAINS: readonly Domain[] = DOMAINS;

export const DOMAIN_COLORS: Record<Domain, string> = colors.light.domain;

/** Glyphs used beside domain names on bars and cards. */
export const DOMAIN_GLYPHS: Record<Domain, string> = {
  BODY: "◈",
  MIND: "◉",
  WEALTH: "◆",
  SOCIAL: "◎",
  DISCIPLINE: "▲",
};

type FeatherName = ComponentProps<typeof Feather>["name"];

export const DOMAIN_ICONS: Record<Domain, FeatherName> = {
  BODY: "activity",
  MIND: "book",
  WEALTH: "trending-up",
  SOCIAL: "users",
  DISCIPLINE: "zap",
};
