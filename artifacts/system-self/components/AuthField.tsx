import { Feather } from "@expo/vector-icons";
import React, { forwardRef, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
} from "react-native";

import { useColors } from "@/hooks/useColors";

interface AuthFieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  error?: string | null;
  hint?: string;
  /** Adds a SHOW / HIDE toggle and hides the text. */
  secret?: boolean;
  /** Monospace text for codes and years. */
  mono?: boolean;
}

export const AuthField = forwardRef<TextInput, AuthFieldProps>(function AuthField(
  { label, error, hint, secret, mono, onFocus, onBlur, ...input },
  ref,
) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const borderColor = error ? colors.destructive : focused ? colors.primary : colors.border;

  return (
    <View style={s.wrap}>
      <Text style={[s.label, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[s.inputWrap, { borderColor, backgroundColor: colors.card }]}>
        <TextInput
          ref={ref}
          {...input}
          style={[s.input, { color: colors.foreground }, mono && s.mono]}
          placeholderTextColor={colors.mutedForeground}
          secureTextEntry={secret && !revealed}
          autoCapitalize={input.autoCapitalize ?? "none"}
          autoCorrect={false}
          accessibilityLabel={label}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
        />
        {secret ? (
          <TouchableOpacity
            onPress={() => setRevealed((r) => !r)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
          >
            <Text style={[s.toggle, { color: colors.mutedForeground }]}>{revealed ? "HIDE" : "SHOW"}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {error ? (
        <View style={s.msgRow}>
          <Feather name="alert-circle" size={12} color={colors.destructive} />
          <Text style={[s.msg, { color: colors.destructive }]}>{error}</Text>
        </View>
      ) : hint ? (
        <Text style={[s.msg, { color: colors.mutedForeground }]}>{hint}</Text>
      ) : null}
    </View>
  );
});

const s = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 9, letterSpacing: 2.5, fontWeight: "700" as const },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input: { flex: 1, fontSize: 16, letterSpacing: 0.5, padding: 0 },
  mono: { fontFamily: "monospace", letterSpacing: 2 },
  toggle: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 2 },
  msgRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  msg: { fontSize: 12, lineHeight: 17 },
});
