// Hands the exported JSON to the user. Pure orchestration over injected platform calls, so it is testable without a device.

export interface ExportPayload {
  filename: string;
  text: string;
}

export interface ShareExportDeps {
  /** Writes the text to a file in the cache directory and returns its URI. */
  writeFile(filename: string, text: string): Promise<string>;
  canShareFile(): Promise<boolean>;
  /** Opens the system share sheet for the file. */
  shareFile(uri: string): Promise<void>;
  /** The plain text share (Share.share), a fallback for small payloads only. */
  shareText(text: string): Promise<void>;
}

/** Larger than this is not pushed through the text share: share sheets and messaging apps truncate or fail on it. */
export const TEXT_SHARE_LIMIT = 200_000;

export type ShareOutcome = "file" | "text" | "too-large";

export async function shareExport(payload: ExportPayload, deps: ShareExportDeps): Promise<ShareOutcome> {
  try {
    if (await deps.canShareFile()) {
      const uri = await deps.writeFile(payload.filename, payload.text);
      await deps.shareFile(uri);
      return "file";
    }
  } catch {
    // Fall through to the text share (a dismissed sheet is not an error on most platforms).
  }
  if (payload.text.length > TEXT_SHARE_LIMIT) return "too-large";
  await deps.shareText(payload.text);
  return "text";
}
