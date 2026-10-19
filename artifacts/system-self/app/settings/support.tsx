import { Feather } from "@expo/vector-icons";
import React from "react";
import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { AuthNotice, AuthShell } from "@/components/AuthShell";
import { Separator, SettingsCard } from "@/components/SettingsParts";
import { SUPPORT_EMERGENCY, SUPPORT_ENTRIES, SUPPORT_HEADLINE, type SupportEntry } from "@/constants/support";
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
    <AuthShell tag="SUPPORT" title="Need support?" subtitle={SUPPORT_HEADLINE} back>
      <SettingsCard>
        {SUPPORT_ENTRIES.map((entry, i) => (
          <View key={entry.id}>
            {i > 0 ? <Separator /> : null}
            <TouchableOpacity
              style={s.row}
              onPress={() => void open(entry)}
              activeOpacity={0.7}
              accessibilityRole="link"
              accessibilityLabel={`${entry.label}, ${entry.detail}`}
            >
              <Feather name={entry.kind === "call" ? "phone" : "globe"} size={16} color={colors.primary} />
              <View style={s.text}>
                <Text style={[s.label, { color: colors.foreground }]}>{entry.label}</Text>
                <Text style={[s.detail, { color: colors.mutedForeground }]}>{entry.detail}</Text>
              </View>
              <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        ))}
      </SettingsCard>
      {failed ? <AuthNotice message={failed} /> : null}
      <Text style={[s.emergency, { color: colors.foreground }]}>{SUPPORT_EMERGENCY}</Text>
    </AuthShell>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 64 },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 14, fontWeight: "600" as const },
  detail: { fontSize: 13, fontFamily: "monospace" },
  emergency: { fontSize: 14, lineHeight: 21, paddingHorizontal: 4 },
});
