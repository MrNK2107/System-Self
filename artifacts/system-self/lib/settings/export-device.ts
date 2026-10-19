// Device wiring for shareExport: expo-file-system (cache dir) and expo-sharing, both bundled in Expo Go for SDK 54.
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Share } from "react-native";

import { shareExport, type ExportPayload, type ShareOutcome } from "./export-share";

export function shareExportOnDevice(payload: ExportPayload): Promise<ShareOutcome> {
  return shareExport(payload, {
    async writeFile(filename, text) {
      const file = new File(Paths.cache, filename);
      file.create({ overwrite: true });
      file.write(text);
      return file.uri;
    },
    canShareFile: () => Sharing.isAvailableAsync(),
    async shareFile(uri) {
      await Sharing.shareAsync(uri, { mimeType: "application/json", UTI: "public.json", dialogTitle: "Export my data" });
    },
    async shareText(text) {
      await Share.share({ message: text, title: "SYSTEM // SELF data export" });
    },
  });
}
