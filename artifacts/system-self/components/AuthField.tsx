import { Feather } from "@expo/vector-icons";
import React, { forwardRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { fonts, space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

interface AuthFieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  error?: string | null;
  hint?: string;
  /** Adds a show / hide toggle and hides the text. */
  secret?: boolean;
  /** Tabular figures for codes and years. */
  mono?: boolean;
}

/**
 * Labelled text input: 52dp frame (taller when multiline), primary frame while focused, destructive frame and
 * message on error. The error replaces the hint, so the field always says what to do next.
 */
export const AuthField = forwardRef<TextInput, AuthFieldProps>(function AuthField(
  { label, error, hint, secret, mono, onFocus, onBlur, multiline, ...input },
  ref,
) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const borderColor = error ? colors.destructive : focused ? colors.primary : colors.border;

  return (
    <View style={s.wrap}>
      <Text style={[type.label, { color: error ? colors.destructive : colors.mutedForeground }]}>{label}</Text>
      <View style={[s.frame, multiline && s.frameMulti, { borderColor, backgroundColor: colors.card }]}>
        <TextInput
          ref={ref}
          {...input}
          multiline={multiline}
          style={[type.body, s.input, multiline && s.inputMulti, { color: colors.foreground }, mono && s.mono]}
          placeholderTextColor={colors.subtle}
          selectionColor={colors.primary}
          cursorColor={colors.primary}
          secureTextEntry={secret && !revealed}
          autoCapitalize={input.autoCapitalize ?? "none"}
          autoCorrect={false}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
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
          <Pressable
            onPress={() => setRevealed((r) => !r)}
            android_ripple={{ color: "rgba(168,121,255,0.2)", borderless: true, radius: 24 }}
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
            style={s.toggle}
          >
            <Feather name={revealed ? "eye-off" : "eye"} size={20} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View style={s.msgRow} accessibilityLiveRegion="polite">
          <Feather name="alert-circle" size={14} color={colors.destructive} />
          <Text style={[type.meta, s.msg, { color: colors.destructive }]}>{error}</Text>
        </View>
      ) : hint ? (
        <Text style={[type.meta, { color: colors.mutedForeground }]}>{hint}</Text>
      ) : null}
    </View>
  );
});

const s = StyleSheet.create({
  wrap: { gap: space.sm },
  frame: { flexDirection: "row", alignItems: "center", minHeight: 52, borderWidth: 1, borderRadius: 4, paddingLeft: space.md, paddingRight: space.xs },
  frameMulti: { alignItems: "flex-start", minHeight: 104 },
  input: { flex: 1, paddingVertical: space.sm + 4, paddingRight: space.sm + 4 },
  inputMulti: { minHeight: 96, textAlignVertical: "top" },
  mono: { fontFamily: fonts.display, fontVariant: ["tabular-nums"] },
  toggle: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  msgRow: { flexDirection: "row", alignItems: "center", gap: space.xs + 2 },
  msg: { flex: 1 },
});
