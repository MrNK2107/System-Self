// Scout report: one optional tap after a gym session. SKIP sends nothing.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Sheet } from "@/components/arena/parts";
import { Button } from "@/components/ui/Button";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { CROWD_OPTIONS, CROWD_PROMPT, type CrowdLevel } from "@/lib/game/dungeon";

interface Props {
  visible: boolean;
  busy: boolean;
  /** `null` is SKIP. */
  onChoose: (level: CrowdLevel | null) => void;
}

export function CrowdReportSheet({ visible, busy, onChoose }: Props) {
  const colors = useColors();
  return (
    <Sheet visible={visible} title="Scout report" onClose={() => onChoose(null)} dismissable={!busy}>
      <Text style={[type.body, { color: colors.foreground }]}>{CROWD_PROMPT}</Text>
      <View style={s.options}>
        {CROWD_OPTIONS.map((o) => (
          <Button
            key={o.label}
            label={o.label}
            variant={o.level ? "tonal" : "text"}
            block
            disabled={busy}
            onPress={() => onChoose(o.level)}
            accessibilityLabel={o.label}
          />
        ))}
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  options: { gap: space.sm },
});
