import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Polygon } from "react-native-svg";

import colors from "@/constants/colors";
import { fonts } from "@/constants/type";

type Rank = keyof typeof colors.light.rank;

/** Hexagon with notched points around the rank letter, in the rank's colour. The one hero figure on Status. */
export function RankEmblem({ rank, size = 160 }: { rank: string; size?: number }) {
  const tone = colors.light.rank[(rank in colors.light.rank ? rank : "E") as Rank];
  const c = size / 2;
  const hex = (r: number) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      return `${c + r * Math.cos(a)},${c + r * Math.sin(a)}`;
    }).join(" ");

  return (
    <View style={{ width: size, height: size }} accessibilityRole="image" accessibilityLabel={`Rank ${rank}`}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Polygon points={hex(c - 2)} fill="rgba(38,28,64,0.55)" stroke={tone} strokeWidth={1.5} />
        <Polygon points={hex(c - 12)} fill="none" stroke={tone} strokeOpacity={0.35} strokeWidth={1} />
      </Svg>
      <View style={s.center}>
        <Text style={[s.letter, { color: "#F1ECF7", fontSize: size * 0.5, lineHeight: size * 0.6, textShadowColor: tone }]}>{rank}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  letter: { fontFamily: fonts.displayBold, textShadowRadius: 18, textShadowOffset: { width: 0, height: 0 } },
});
