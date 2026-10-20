// Bottom sheet for quest details and quest actions: slides up over a dimmed backdrop, Back closes it.
// The kit (components/ui) has no sheet, so this lives with the Quests screens.
import React, { type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";

interface SheetProps {
  visible: boolean;
  /** Sheet heading (plain words, title size). */
  title?: string;
  /** Dismiss (backdrop tap and Android Back). Ignored while `locked`. */
  onClose: () => void;
  /** A request is in flight: the backdrop does not dismiss. */
  locked?: boolean;
  /** Pinned under the scrolling body: the sheet's one primary action (and its secondary). */
  footer?: ReactNode;
  children: ReactNode;
}

export function Sheet({ visible, title, onClose, locked, footer, children }: SheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={locked ? () => {} : onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={s.fill}>
        <Pressable style={s.backdrop} onPress={locked ? undefined : onClose} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={[s.sheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + space.md }]}>
          <View style={[s.grip, { backgroundColor: colors.border }]} />
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {title ? (
              <Text style={[type.title, { color: colors.foreground }]} accessibilityRole="header">
                {title}
              </Text>
            ) : null}
            {children}
          </ScrollView>
          {footer ? <View style={s.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { maxHeight: "88%", borderTopWidth: 1, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  grip: { width: 32, height: 4, borderRadius: 2, alignSelf: "center", marginTop: space.sm },
  body: { paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.sm, gap: space.sm },
  footer: { paddingHorizontal: space.md, paddingTop: space.sm, gap: space.sm },
});
