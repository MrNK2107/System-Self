import React from "react";
import { Linking, Text } from "react-native";

import { SettingsNote, SettingsSection } from "@/components/SettingsParts";
import { ListRow } from "@/components/ui/ListRow";
import { Screen } from "@/components/ui/Screen";
import { SUPPORT_EMERGENCY, SUPPORT_ENTRIES, SUPPORT_HEADLINE, type SupportEntry } from "@/constants/support";
import { type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

// Plain, warm copy on purpose: this is the one screen where THE SYSTEM does not speak.
export default function SupportScreen() {
  const colors = useColors();
  const [failed, setFailed] = React.useState<string | null>(null);

  const open = async (entry: SupportEntry) => {
    setFailed(null);
    try {
      await Linking.openURL(entry.href);
    } catch {
      setFailed(`Could not open ${entry.label}. Contact them directly: ${entry.detail}`);
    }
  };

  return (
    <Screen title="Need support?" back>
      <Text style={[type.body, { color: colors.foreground }]}>{SUPPORT_HEADLINE}</Text>
      <SettingsSection label="TALK TO SOMEONE">
        {SUPPORT_ENTRIES.map((entry) => (
          <ListRow
            key={entry.id}
            title={entry.label}
            subtitle={`${entry.kind === "call" ? "Call" : "Website"}: ${entry.detail}`}
            chevron
            onPress={() => void open(entry)}
            accessibilityLabel={`${entry.label}, ${entry.kind === "call" ? "call" : "open website"}, ${entry.detail}`}
          />
        ))}
      </SettingsSection>
      {failed ? <SettingsNote message={failed} /> : null}
      <Text style={[type.body, { color: colors.foreground }]}>{SUPPORT_EMERGENCY}</Text>
    </Screen>
  );
}
