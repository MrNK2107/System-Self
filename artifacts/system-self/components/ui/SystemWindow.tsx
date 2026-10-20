import React, { useState, type ReactNode } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

const NOTCH = 10;

/** Octagon outline with 45° notched corners, inset half a pixel so the 1px stroke stays crisp. */
function notchedPath(w: number, h: number, n = NOTCH): string {
  const a = 0.5;
  const r = w - 0.5;
  const b = h - 0.5;
  return `M${a + n},${a} H${r - n} L${r},${a + n} V${b - n} L${r - n},${b} H${a + n} L${a},${b - n} V${a + n} Z`;
}

interface SystemWindowProps {
  /** Header text without brackets, e.g. "STATUS". */
  title?: string;
  children: ReactNode;
  style?: ViewStyle;
  /** Frame colour override (a domain colour for domain-scoped windows). */
  frameColor?: string;
  /** Opaque fill, for windows that float over other content (notices, banners). */
  solid?: boolean;
}

/** The translucent panel composited once over the ink ground, so a floating window reads the same but hides what's behind. */
const SOLID_PANEL = "#1A1430";

/** THE SYSTEM's window: a translucent violet panel with a hairline notched frame and a bracketed header. */
export function SystemWindow({ title, children, style, frameColor, solid }: SystemWindowProps) {
  const colors = useColors();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  };
  const d = size.w > 0 ? notchedPath(size.w, size.h) : null;

  return (
    <View onLayout={onLayout} style={[s.root, title ? s.titled : null, style]}>
      {d ? (
        <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d={d} fill={solid ? SOLID_PANEL : colors.panel} stroke={frameColor ?? colors.frame} strokeWidth={1} />
        </Svg>
      ) : null}
      {title ? (
        // The title is part of the frame: a title bar closed by a hairline rule in the frame colour.
        <View style={[s.titleBar, { borderBottomColor: frameColor ?? colors.frame }]}>
          <Text style={[type.label, s.title, { color: frameColor ?? colors.primary }]} accessibilityRole="header">
            {`[ ${title} ]`}
          </Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  root: { padding: space.md, gap: space.sm },
  titled: { paddingTop: 0 },
  titleBar: {
    marginHorizontal: -space.md,
    marginBottom: space.xs,
    paddingVertical: space.sm + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { textAlign: "center" },
});
