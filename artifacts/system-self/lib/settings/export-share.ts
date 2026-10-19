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
  let uri: string | null = null;
  try {
    if (await deps.canShareFile()) uri = await deps.writeFile(payload.filename, payload.text);
  } catch {
    // The file route is unavailable (module missing, cache not writable): use the text share instead.
    uri = null;
  }
  if (uri !== null) {
    // The sheet is open from here on: a failure is the caller's to report, not a reason to share the text as well.
    await deps.shareFile(uri);
    return "file";
  }
  if (payload.text.length > TEXT_SHARE_LIMIT) return "too-large";
  await deps.shareText(payload.text);
  return "text";
}
