import React, { useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp, type Domain } from "@/context/AppContext";

interface LogModalProps {
  visible: boolean;
  onClose: () => void;
}

type LogDomain = Domain;

interface LogConfig {
  domain: LogDomain;
  icon: string;
  color: string;
  types: { key: string; label: string }[];
}

const LOG_CONFIGS: LogConfig[] = [
  {
    domain: "BODY",
    icon: "activity",
    color: "#E05555",
    types: [
      { key: "workout", label: "Workout" },
      { key: "sleep", label: "Sleep" },
      { key: "meal", label: "Meal" },
    ],
  },
  {
    domain: "MIND",
    icon: "book",
    color: "#3A7BD5",
    types: [
      { key: "deep_work", label: "Deep Work" },
      { key: "reading", label: "Reading" },
      { key: "journal", label: "Journal" },
    ],
  },
  {
    domain: "WEALTH",
    icon: "trending-up",
    color: "#4B8B6F",
    types: [
      { key: "income", label: "Income" },
      { key: "expense", label: "Expense" },
      { key: "savings", label: "Savings" },
    ],
  },
  {
    domain: "DISCIPLINE",
    icon: "zap",
    color: "#C4873A",
    types: [
      { key: "quest_complete", label: "Quest Done" },
      { key: "routine", label: "Routine" },
      { key: "habit", label: "Habit" },
    ],
  },
];

export function LogModal({ visible, onClose }: LogModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addLog } = useApp();

  const [selectedDomain, setSelectedDomain] = useState<LogDomain>("BODY");
  const [selectedType, setSelectedType] = useState("workout");
  const [note, setNote] = useState("");
  const [intensity, setIntensity] = useState(3);
  const [submitting, setSubmitting] = useState(false);

  const config = LOG_CONFIGS.find(c => c.domain === selectedDomain)!;

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    await addLog({
      domain: selectedDomain,
      type: selectedType,
      data: { note, intensity },
    });

    setNote("");
    setIntensity(3);
    setSubmitting(false);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>LOG ENTRY</Text>
          <TouchableOpacity onPress={onClose}>
            <Feather name="x" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DOMAIN</Text>
            <View style={styles.domainGrid}>
              {LOG_CONFIGS.map(cfg => (
                <TouchableOpacity
                  key={cfg.domain}
                  style={[
                    styles.domainBtn,
                    {
                      borderColor: selectedDomain === cfg.domain ? cfg.color : colors.border,
                      backgroundColor: selectedDomain === cfg.domain ? cfg.color + "20" : colors.card,
                    }
                  ]}
                  onPress={() => {
                    setSelectedDomain(cfg.domain);
                    setSelectedType(cfg.types[0].key);
                  }}
                  activeOpacity={0.7}
                >
                  <Feather name={cfg.icon as "activity"} size={16} color={selectedDomain === cfg.domain ? cfg.color : colors.mutedForeground} />
                  <Text style={[styles.domainLabel, { color: selectedDomain === cfg.domain ? cfg.color : colors.mutedForeground }]}>
                    {cfg.domain}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>TYPE</Text>
            <View style={styles.typeRow}>
              {config.types.map(type => (
                <TouchableOpacity
                  key={type.key}
                  style={[
                    styles.typeBtn,
                    {
                      borderColor: selectedType === type.key ? config.color : colors.border,
                      backgroundColor: selectedType === type.key ? config.color + "20" : "transparent",
                    }
                  ]}
                  onPress={() => setSelectedType(type.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.typeLabel,
                    { color: selectedType === type.key ? config.color : colors.mutedForeground }
                  ]}>
                    {type.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>INTENSITY</Text>
            <View style={styles.intensityRow}>
              {[1, 2, 3, 4, 5].map(i => (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.intensityBtn,
                    {
                      backgroundColor: intensity >= i ? config.color : colors.muted,
                    }
                  ]}
                  onPress={() => setIntensity(i)}
                  activeOpacity={0.7}
                />
              ))}
              <Text style={[styles.intensityLabel, { color: colors.mutedForeground }]}>
                {intensity}/5
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>NOTE (OPTIONAL)</Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                }
              ]}
              placeholder="What happened. Be specific."
              placeholderTextColor={colors.mutedForeground}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
            />
          </View>
        </ScrollView>

        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: config.color }]}
          onPress={handleSubmit}
          activeOpacity={0.8}
          disabled={submitting}
        >
          <Text style={styles.submitText}>LOG IT</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
    marginTop: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: "700" as const,
    letterSpacing: 3,
  },
  section: {
    marginBottom: 24,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: "600" as const,
    letterSpacing: 2,
  },
  domainGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  domainBtn: {
    flex: 1,
    minWidth: "45%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderRadius: 4,
  },
  domainLabel: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 2,
  },
  typeRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  typeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 2,
  },
  typeLabel: {
    fontSize: 11,
    fontWeight: "600" as const,
  },
  intensityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  intensityBtn: {
    width: 32,
    height: 6,
    borderRadius: 1,
  },
  intensityLabel: {
    fontSize: 11,
    marginLeft: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 12,
    fontSize: 13,
    minHeight: 80,
    textAlignVertical: "top",
  },
  submitBtn: {
    padding: 16,
    alignItems: "center",
    borderRadius: 2,
    marginTop: 8,
  },
  submitText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 3,
  },
});
