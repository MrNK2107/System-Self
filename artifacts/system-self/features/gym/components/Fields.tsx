// Form pieces for the gym screens, built locally because the kit (components/ui) has no inputs yet:
// a 48dp text field and a number stepper (48dp minus / plus around an editable figure in type.number).
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

interface TextFieldProps extends Omit<TextInputProps, "style"> {
  label: string;
}

/** Labelled 48dp text input with a hairline frame that turns accent on focus. */
export function TextField({ label, onFocus, onBlur, ...input }: TextFieldProps) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View style={s.field}>
      <Text style={[type.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        placeholderTextColor={colors.subtle}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          type.body,
          s.input,
          { color: colors.foreground, backgroundColor: colors.card, borderColor: focused ? colors.primary : colors.border },
        ]}
      />
    </View>
  );
}

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Amount one tap of minus / plus moves the value. */
  step?: number;
  /** Allow typing a decimal (weights). */
  decimal?: boolean;
  onChange: (n: number) => void;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const show = (n: number) => String(Math.round(n * 100) / 100);

/** Number stepper: label above, 48dp minus / plus either side of a typeable figure. */
export function NumberStepper({ label, value, min, max, step = 1, decimal, onChange }: StepperProps) {
  const colors = useColors();
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]);

  const commit = () => {
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n) || text.trim() === "") return setText(show(value));
    const next = clamp(decimal ? Math.round(n * 100) / 100 : Math.round(n), min, max);
    setText(show(next));
    if (next !== value) onChange(next);
  };

  const button = (icon: "minus" | "plus", next: number, disabled: boolean) => (
    <View style={[s.stepClip, { borderColor: colors.border, opacity: disabled ? 0.45 : 1 }]}>
      <Pressable
        onPress={() => onChange(clamp(Math.round(next * 100) / 100, min, max))}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label} ${icon === "minus" ? "down" : "up"}`}
        android_ripple={{ color: "rgba(168,121,255,0.16)" }}
        style={s.stepBtn}
      >
        <Feather name={icon} size={20} color={colors.foreground} />
      </Pressable>
    </View>
  );

  return (
    <View style={s.stepper}>
      <Text style={[type.label, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={s.stepRow}>
        {button("minus", value - step, value <= min)}
        <TextInput
          value={text}
          onChangeText={setText}
          onEndEditing={commit}
          onBlur={commit}
          keyboardType={decimal ? "decimal-pad" : "number-pad"}
          selectTextOnFocus
          accessibilityLabel={label}
          style={[type.number, s.stepValue, { color: colors.foreground }]}
        />
        {button("plus", value + step, value >= max)}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  field: { gap: space.sm },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 4, paddingHorizontal: space.md },
  stepper: { flex: 1, gap: space.sm },
  stepRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  stepClip: { borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  stepBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  stepValue: { flex: 1, minWidth: 48, minHeight: 48, textAlign: "center", padding: 0 },
});
