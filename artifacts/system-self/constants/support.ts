// Crisis and support resources. This is the one place THE SYSTEM's voice is not used: plain, warm, direct.

export interface SupportEntry {
  id: string;
  label: string;
  /** What the row shows under the label. */
  detail: string;
  /** Opened with Linking: a tel: number or a web URL. */
  href: string;
  kind: "call" | "web";
}

export const SUPPORT_HEADLINE = "If you are struggling, talk to someone now.";
export const SUPPORT_EMERGENCY = "If you are in immediate danger, call your local emergency number.";

export const SUPPORT_ENTRIES: readonly SupportEntry[] = [
  { id: "tele-manas", label: "India Tele-MANAS", detail: "14416", href: "tel:14416", kind: "call" },
  { id: "tele-manas-toll-free", label: "India Tele-MANAS (toll free)", detail: "1-800-891-4416", href: "tel:18008914416", kind: "call" },
  { id: "icall", label: "iCall", detail: "+91 9152987821", href: "tel:+919152987821", kind: "call" },
  { id: "international", label: "International", detail: "findahelpline.com", href: "https://findahelpline.com", kind: "web" },
];
