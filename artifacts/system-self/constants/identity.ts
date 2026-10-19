// Identity visibility choices, shared by onboarding and settings.
export type IdentitySetting = "anonymous" | "semi-public" | "public";

export const IDENTITY_OPTIONS: {
  value: IdentitySetting;
  label: string;
  description: string;
  icon: "eye-off" | "eye" | "globe";
}[] = [
  {
    value: "anonymous",
    label: "GHOST",
    description: "Codename only. No external affiliation visible. Maximum privacy.",
    icon: "eye-off",
  },
  {
    value: "semi-public",
    label: "OPERATIVE",
    description: "Username visible to your clan only. Rivals see a codename. Recommended.",
    icon: "eye",
  },
  {
    value: "public",
    label: "OPEN",
    description: "Full username visible everywhere. Full accountability.",
    icon: "globe",
  },
];
