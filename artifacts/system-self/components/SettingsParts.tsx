// Settings building blocks: one pattern everywhere. A section is a caps label over a card of kit ListRows; a row that
// expands opens a panel inside the same card; notes are one quiet line.
import { Feather } from "@expo/vector-icons";
import React, { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

/** A bordered group of content with inner padding (used by screens that lay out their own rows). */
export function SettingsCard({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <View style={[s.card, s.padded, { backgroundColor: colors.card, borderColor: colors.border }]}>{children}</View>;
}

export function Separator() {
  const colors = useColors();
  return <View style={[s.separator, { backgroundColor: colors.border }]} />;
}

/** A labelled group of ListRows. The label sits closer to its rows than to the section above. */
export function SettingsSection({ label, footer, children }: { label: string; footer?: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={s.section}>
      <Text style={[type.label, s.sectionLabel, { color: colors.mutedForeground }]} accessibilityRole="header">
        {label}
      </Text>
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>{children}</View>
      {footer ? <Text style={[type.meta, s.footer, { color: colors.subtle }]}>{footer}</Text> : null}
    </View>
  );
}

/** The panel an expanding row opens, inside the section card. */
export function SettingsPanel({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <View style={[s.panel, { borderBottomColor: colors.border }]}>{children}</View>;
}

/** Trailing value + chevron for a row that expands in place. */
export function ExpandTrailing({ value, open }: { value?: string; open: boolean }) {
  const colors = useColors();
  return (
    <View style={s.trailing}>
      {value ? (
        <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      <Feather name={open ? "chevron-up" : "chevron-down"} size={20} color={colors.subtle} />
    </View>
  );
}

/** One quiet line: info in muted text, an error in the foreground with a destructive mark, optional Retry. */
export function SettingsNote({ message, tone = "error", onRetry }: { message: string; tone?: "error" | "info"; onRetry?: () => void }) {
  const colors = useColors();
  return (
    <View style={s.note} accessibilityLiveRegion="polite">
      <View style={s.noteRow}>
        {tone === "error" ? <Feather name="alert-circle" size={16} color={colors.destructive} /> : null}
        <Text style={[type.body, s.flex, { color: tone === "error" ? colors.foreground : colors.mutedForeground }]}>{message}</Text>
      </View>
      {onRetry ? <Button label="Retry" variant="text" onPress={onRetry} /> : null}
    </View>
  );
}

/** A wrap of single-choice chips (times, contexts, seasons): 48dp targets, ripple, the chosen one filled. */
export function ChoiceChips<K extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly { key: K; label: string }[];
  value: K | null;
  onChange: (key: K) => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={s.chips} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <View key={o.key} style={s.chipClip}>
            <Pressable
              onPress={() => onChange(o.key)}
              disabled={disabled}
              android_ripple={{ color: "rgba(168,121,255,0.16)" }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: !!disabled }}
              style={[s.chip, { borderColor: on ? colors.accentFill : colors.border, backgroundColor: on ? colors.accentFill : "transparent" }]}
            >
              <Text style={[type.label, { color: on ? colors.primaryForeground : colors.mutedForeground }]}>{o.label}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, overflow: "hidden" },
  padded: { paddingHorizontal: space.md },
  separator: { height: StyleSheet.hairlineWidth },
  section: { gap: space.sm, marginTop: space.sm },
  sectionLabel: { paddingHorizontal: space.xs },
  footer: { paddingHorizontal: space.xs },
  panel: { padding: space.md, gap: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  trailing: { flexDirection: "row", alignItems: "center", gap: space.sm, maxWidth: "50%" },
  note: { gap: space.xs },
  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  flex: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chipClip: { borderRadius: 4, overflow: "hidden" },
  chip: { minHeight: 48, minWidth: 64, paddingHorizontal: space.md, borderWidth: 1, borderRadius: 4, alignItems: "center", justifyContent: "center" },
});
