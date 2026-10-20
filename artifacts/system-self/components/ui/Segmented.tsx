import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

interface SegmentedProps<K extends string> {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
}

/** Material segmented buttons: one choice, 48dp targets, the selected segment filled in the accent. */
export function Segmented<K extends string>({ options, value, onChange }: SegmentedProps<K>) {
  const colors = useColors();
  return (
    <View style={[s.root, { borderColor: colors.border }]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            android_ripple={{ color: "rgba(168,121,255,0.16)" }}
            style={[s.seg, on && { backgroundColor: colors.accentFill }]}
          >
            <Text style={[type.label, { color: on ? colors.primaryForeground : colors.mutedForeground }]}>{o.label.toUpperCase()}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flexDirection: "row", borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  seg: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center" },
});
