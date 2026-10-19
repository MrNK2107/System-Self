import React from "react";
import { StyleSheet } from "react-native";
import Svg, { Defs, Path, Pattern, Rect } from "react-native-svg";

interface Props {
  color: string;
  /** Grid cell size in px. */
  size?: number;
  opacity?: number;
}

/** Subtle full-screen grid for the PEAK state. Decorative: never intercepts touches. */
export function GridTexture({ color, size = 32, opacity = 0.06 }: Props) {
  return (
    <Svg
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { opacity }]}
      width="100%"
      height="100%"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <Pattern id="grid" width={size} height={size} patternUnits="userSpaceOnUse">
          <Path d={`M ${size} 0 L 0 0 0 ${size}`} fill="none" stroke={color} strokeWidth={1} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#grid)" />
    </Svg>
  );
}
