import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Text, View } from "react-native";

import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

const CHAR_MS = 28;
const LINE_PAUSE_MS = 360;

/**
 * THE SYSTEM's lines, typed out one after another. Lines already typed stay at full contrast; the caret is a
 * plain block in the accent. Reduce-motion users (and screen readers) get the full text at once.
 */
export function SystemLines({ lines, onDone }: { lines: readonly string[]; onDone?: () => void }) {
  const colors = useColors();
  const [line, setLine] = useState(0);
  const [chars, setChars] = useState(0);
  const [instant, setInstant] = useState(false);
  const key = lines.join("\n");

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => live && on && setInstant(true))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // A new set of lines starts typing from the top.
  useEffect(() => {
    setLine(0);
    setChars(0);
  }, [key]);

  const done = instant || line >= lines.length;

  useEffect(() => {
    if (done) {
      onDone?.();
      return;
    }
    const current = lines[line] ?? "";
    const t =
      chars < current.length
        ? setTimeout(() => setChars((c) => c + 1), CHAR_MS)
        : setTimeout(() => {
            setLine((l) => l + 1);
            setChars(0);
          }, LINE_PAUSE_MS);
    return () => clearTimeout(t);
    // onDone is a callback prop; re-running on its identity would retype nothing new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, line, chars, key]);

  return (
    <View style={{ gap: space.sm }} accessible accessibilityLabel={lines.join(" ")} accessibilityLiveRegion="polite">
      {lines.map((text, i) => {
        // Untyped text is laid out but transparent, so the window holds its final size while typing.
        const typed = done || i < line ? text.length : i === line ? chars : 0;
        const typing = !done && i === line;
        return (
          <Text key={i} style={[type.title, { color: colors.foreground }]}>
            {text.slice(0, typed)}
            {typing ? <Text style={{ color: colors.primary }}>{"▍"}</Text> : null}
            <Text style={{ color: "transparent" }}>{text.slice(typed)}</Text>
          </Text>
        );
      })}
    </View>
  );
}
