// The log sheet, one job at a time. It opens on "Say it" (text or voice to proposals, each confirmed on its own card).
// "Log manually" swaps in the structured form: choose a domain (or one of your own stats), its type and fields, and
// submit with that form's own button. The two submit paths are never on screen together. A successful log shows
// THE SYSTEM's line ("+2.5 BODY. Logged.") for a moment, then the sheet closes.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LogProposalDto } from "@workspace/contracts";
import { FORBIDDEN_DISCIPLINE_DELTA, FORBIDDEN_DOMAIN_DELTA, logChanges } from "@workspace/engine";
import { CustomLogSection } from "@/components/CustomLogSection";
import { FreeFormLog } from "@/components/FreeFormLog";
import { ProLock } from "@/components/ProLock";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { IconButton } from "@/components/ui/Screen";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { ALL_DOMAINS, DOMAIN_COLORS, DOMAIN_ICONS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { deviceTimezone, useAuth } from "@/context/AuthContext";
import { getStreakMultiplier, useApp, type Domain } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { usePro } from "@/hooks/usePro";
import { gainsText, logGains, loggedLine, proposalToFormValues, type Gain } from "@/lib/freeform/freeform";
import { FREE_DAYS_BACK, dayOptions } from "@/lib/game/log-date";
import {
  checkLogForm,
  defaultTypeFor,
  initialValues,
  LOG_FIELDS,
  typesFor,
  type FieldSpec,
  type FormValues,
} from "@/lib/game/log-form";

interface LogModalProps {
  visible: boolean;
  onClose: () => void;
}

type Mode = "say" | "manual";

/** How long THE SYSTEM's confirmation stays before the sheet closes. */
const DONE_MS = 1200;

// Display copy for the forbidden-log trade (the server applies it).
const FORBIDDEN_GAIN = `+${FORBIDDEN_DOMAIN_DELTA.toFixed(1)}`;
const FORBIDDEN_PENALTY = `−${Math.abs(FORBIDDEN_DISCIPLINE_DELTA).toFixed(1)}`;

/** A selectable chip: 48dp, ripple, a 1px outline in `tone` with a tinted fill when selected. */
function Chip({
  label,
  selected,
  tone,
  onPress,
  icon,
  meta,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  /** Selected outline and text colour (a domain colour, or the accent). */
  tone: string;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
  meta?: string;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  // Domain colours are #RRGGBB, so an alpha pair makes the tint; the accent falls back to the muted fill.
  const fill = selected ? (/^#[0-9a-f]{6}$/i.test(tone) ? `${tone}1F` : colors.muted) : "transparent";
  return (
    <View style={[s.chipClip, { borderColor: selected ? tone : colors.border, backgroundColor: fill }]}>
      <Pressable
        onPress={onPress}
        android_ripple={{ color: "rgba(168,121,255,0.16)" }}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={accessibilityLabel ?? label}
        style={s.chip}
      >
        {icon ? <Feather name={icon} size={16} color={selected ? tone : colors.mutedForeground} /> : null}
        <Text style={[type.label, { color: selected ? tone : colors.mutedForeground }]}>{label.toUpperCase()}</Text>
        {meta ? <Text style={[type.meta, { color: colors.subtle }]}>{meta}</Text> : null}
      </Pressable>
    </View>
  );
}

function FieldInput({ field, value, tone, onChange }: {
  field: FieldSpec;
  value: string | number | undefined;
  tone: string;
  onChange: (v: string | number) => void;
}) {
  const colors = useColors();
  const label = field.kind === "number" && field.suffix ? `${field.label} (${field.suffix})` : field.label;
  return (
    <View style={s.field}>
      <Text style={[type.label, { color: colors.mutedForeground }]}>{label.toUpperCase()}</Text>
      {field.kind === "scale" && (
        <View style={s.scaleRow}>
          {Array.from({ length: field.max - field.min + 1 }, (_, i) => field.min + i).map((i) => {
            const on = typeof value === "number" && value >= i;
            return (
              <Pressable
                key={i}
                onPress={() => onChange(i)}
                accessibilityRole="button"
                accessibilityLabel={`${field.label} ${i}`}
                accessibilityState={{ selected: value === i }}
                android_ripple={{ color: "rgba(168,121,255,0.16)" }}
                style={s.scaleHit}
              >
                <View style={[s.scaleBar, { backgroundColor: on ? tone : colors.muted }]} />
              </Pressable>
            );
          })}
          <Text style={[type.meta, s.scaleText, { color: colors.mutedForeground }]}>
            {typeof value === "number"
              ? `${value}/${field.max}${value === field.min ? ` ${field.lowLabel}` : value === field.max ? ` ${field.highLabel}` : ""}`
              : ""}
          </Text>
        </View>
      )}
      {field.kind === "choice" && (
        <View style={s.wrapRow}>
          {field.options.map((o) => (
            <Chip key={o.value} label={o.label} selected={value === o.value} tone={tone} onPress={() => onChange(o.value)} />
          ))}
        </View>
      )}
      {(field.kind === "text" || field.kind === "number") && (
        <TextInput
          style={[type.body, s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
          value={value === undefined ? "" : String(value)}
          onChangeText={onChange}
          keyboardType={field.kind === "number" ? (field.decimal ? "decimal-pad" : "number-pad") : "default"}
          maxLength={field.kind === "text" ? field.max : 12}
          placeholderTextColor={colors.subtle}
          accessibilityLabel={field.label}
          selectTextOnFocus
        />
      )}
    </View>
  );
}

export function LogModal({ visible, onClose }: LogModalProps) {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addLog, domainScores } = useApp();
  const streakOf = (d: string) => domainScores.find((x) => x.domain === d)?.streak ?? 0;

  const [mode, setMode] = useState<Mode>("say");
  // No domain is pre-selected: the manual submit stays disabled until one is chosen.
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [customId, setCustomId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isForbidden, setIsForbidden] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Which day the entry is dated: 0 = today. Free users reach 2 days back, PRO users 30 (the server enforces it).
  const [daysBack, setDaysBack] = useState(0);
  const [showOlder, setShowOlder] = useState(false);
  // Proposals still waiting on the Say it page (after an Edit, the sheet goes back to them instead of closing).
  const [openProposals, setOpenProposals] = useState(0);
  // THE SYSTEM's line after a log; while it shows, the sheet takes no input.
  const [done, setDone] = useState<string | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountTz = useAuth().user?.timezone;
  // PRO as the server last reported it; unknown counts as free here, so the chooser never offers a day the server may refuse.
  const pro = usePro();
  const days = dayOptions(new Date(), accountTz, pro, deviceTimezone());

  const resetManual = useCallback(() => {
    setSelectedDomain(null);
    setCustomId(null);
    setSelectedType(null);
    setValues({});
    setNote("");
    setIsForbidden(false);
    setSubmitError(null);
    setDaysBack(0);
    setShowOlder(false);
  }, []);

  // Every opening starts fresh on Say it (reset on open, so the closing slide never shows a changing form).
  useEffect(() => {
    if (!visible) return;
    setMode("say");
    setDone(null);
    setOpenProposals(0);
    resetManual();
  }, [visible, resetManual]);

  useEffect(() => () => {
    if (doneTimer.current) clearTimeout(doneTimer.current);
  }, []);

  /** Shows THE SYSTEM's line, then closes the sheet (or returns to waiting proposals). */
  const finish = (line: string, close = true) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDone(line);
    if (doneTimer.current) clearTimeout(doneTimer.current);
    doneTimer.current = setTimeout(() => {
      setDone(null);
      resetManual();
      if (close) onClose();
      else setMode("say");
    }, DONE_MS);
  };

  const tone = selectedDomain ? DOMAIN_COLORS[selectedDomain] : colors.primary;
  const check = selectedDomain && selectedType ? checkLogForm(selectedDomain, selectedType, values) : null;
  // Preview only: the server applies the real delta. An entry that does not check yet previews its type's defaults.
  const previewData = check?.ok ? check.data : selectedDomain && selectedType ? initialValues(selectedDomain, selectedType) : {};
  const gains: Gain[] =
    selectedDomain && selectedType
      ? logGains([{ domain: selectedDomain, type: selectedType, data: previewData, forbidden: isForbidden }], streakOf)
      : [];
  const streak = selectedDomain ? streakOf(selectedDomain) : 0;
  // The streak line only applies when at least one of the log's changes takes the streak bonus.
  const takesBonus =
    !!selectedDomain && !!selectedType && !isForbidden && logChanges(selectedDomain, selectedType, previewData, false).some((c) => c.bonus);

  const selectType = (domain: Domain, t: string) => {
    setSelectedType(t);
    setValues(initialValues(domain, t));
    setSubmitError(null);
  };

  const chooseDomain = (domain: Domain) => {
    Haptics.selectionAsync();
    setCustomId(null);
    setSelectedDomain(domain);
    selectType(domain, defaultTypeFor(domain).type);
  };

  const chooseCustom = (id: string | null) => {
    setCustomId(id);
    if (id) {
      setSelectedDomain(null);
      setSelectedType(null);
      setIsForbidden(false);
    }
    setSubmitError(null);
  };

  const setValue = (key: string, value: string | number) => {
    setValues((v) => ({ ...v, [key]: value }));
    setSubmitError(null);
  };

  // Edit on a proposal: the manual form opens prefilled, the original text becomes the note.
  const handleEditProposal = (p: LogProposalDto, text: string) => {
    Haptics.selectionAsync();
    Keyboard.dismiss();
    setMode("manual");
    setIsForbidden(false);
    setCustomId(null);
    setSelectedDomain(p.domain);
    setSelectedType(p.logType);
    setValues(proposalToFormValues(p));
    setNote(text.slice(0, 2000));
    setSubmitError(null);
  };

  const handleToggleForbidden = (on: boolean) => {
    Haptics.impactAsync(on ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light);
    setIsForbidden(on);
  };

  const handleSubmit = async () => {
    if (submitting || !selectedDomain || !selectedType || !check) return;
    if (!check.ok) {
      setSubmitError(check.message);
      return;
    }
    if (daysBack > 0 && !days[daysBack]!.offered) {
      setDaysBack(0);
      setSubmitError("That day is no longer in range. Pick another day.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const line = loggedLine(gains);
    try {
      // Queued in the outbox: it is kept on the device and sent when there is a connection.
      await addLog({
        domain: selectedDomain,
        type: selectedType,
        forbidden: isForbidden,
        note,
        data: check.data,
        ...(daysBack > 0 ? { occurredAt: days[daysBack]!.occurredAt } : {}),
      });
    } catch {
      setSubmitError("The entry could not be recorded on this device. Sign in again, then retry.");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    // Proposals still waiting from Say it: go back to them instead of closing.
    finish(line, openProposals === 0);
  };

  const goBack = () => {
    if (done) return;
    if (mode === "manual") {
      setMode("say");
      resetManual();
    } else onClose();
  };

  const gainText = gainsText(gains);
  const submitLabel = !selectedDomain
    ? "Log it"
    : isForbidden
      ? `Log forbidden · ${gainText}`
      : `Log it${gainText ? ` · ${gainText}` : ""}`;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={goBack}>
      <KeyboardAvoidingView
        style={[s.container, { backgroundColor: colors.background, paddingBottom: insets.bottom + space.md }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.header}>
          {mode === "manual" ? <IconButton icon="arrow-left" label="Back to Say it" onPress={goBack} /> : <View style={s.headerGap} />}
          <Text style={[type.title, s.headerTitle, { color: colors.foreground }]} accessibilityRole="header" numberOfLines={1}>
            {mode === "manual" ? "Log manually" : "Say it"}
          </Text>
          <IconButton icon="x" label="Close" onPress={() => (done ? undefined : onClose())} />
        </View>

        <ScrollView
          style={[s.flex, done ? s.dimmed : null]}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          pointerEvents={done ? "none" : "auto"}
        >
          {/* Say it stays mounted under the manual form, so waiting proposals survive an Edit. */}
          <View style={[s.section, mode !== "say" && s.hidden]}>
            <Text style={[type.body, { color: colors.mutedForeground }]}>What did you do? Say it in your own words.</Text>
            <FreeFormLog
              onLogged={(g) => finish(loggedLine(g))}
              onEdit={handleEditProposal}
              onOpenChange={setOpenProposals}
            />
            <Button
              label="Log manually"
              variant="text"
              onPress={() => {
                Haptics.selectionAsync();
                Keyboard.dismiss();
                setMode("manual");
              }}
              style={s.manualLink}
            />
          </View>

          {mode === "manual" ? (
            <View style={s.section}>
              <View style={s.field}>
                <Text style={[type.label, { color: colors.mutedForeground }]}>DOMAIN</Text>
                <View style={s.wrapRow}>
                  {ALL_DOMAINS.map((d) => {
                    const streakDays = streakOf(d);
                    return (
                      <Chip
                        key={d}
                        label={d}
                        icon={DOMAIN_ICONS[d]}
                        selected={selectedDomain === d}
                        tone={DOMAIN_COLORS[d]}
                        meta={streakDays > 0 ? `${streakDays}d` : undefined}
                        accessibilityLabel={streakDays > 0 ? `${d}, ${streakDays} day streak` : d}
                        onPress={() => chooseDomain(d)}
                      />
                    );
                  })}
                </View>
              </View>

              <CustomLogSection
                selectedId={customId}
                onSelect={chooseCustom}
                onLogged={(line) => finish(line, openProposals === 0)}
                onNavigate={onClose}
              />

              {selectedDomain && selectedType ? (
                <>
                  {selectedDomain === "BODY" ? (
                    <View style={[s.rowFrame, { borderColor: colors.border }]}>
                      <ListRow
                        title="Gym tracker"
                        subtitle="Sets, PRs and plan completion"
                        dot={DOMAIN_COLORS.BODY}
                        chevron
                        onPress={() => {
                          onClose();
                          router.push("/gym");
                        }}
                      />
                    </View>
                  ) : null}

                  <View style={s.field}>
                    <Text style={[type.label, { color: colors.mutedForeground }]}>TYPE</Text>
                    <View style={s.wrapRow}>
                      {typesFor(selectedDomain).map((t) => (
                        <Chip
                          key={t.type}
                          label={t.label}
                          selected={selectedType === t.type}
                          tone={tone}
                          onPress={() => selectType(selectedDomain, t.type)}
                        />
                      ))}
                    </View>
                  </View>

                  {(LOG_FIELDS[selectedType] ?? []).map((field) => (
                    <FieldInput
                      key={`${selectedType}.${field.key}`}
                      field={field}
                      value={values[field.key]}
                      tone={tone}
                      onChange={(v) => setValue(field.key, v)}
                    />
                  ))}

                  {/* Day: today by default; yesterday and 2 days back for everyone, older days (to 30) for PRO */}
                  <View style={s.field}>
                    <Text style={[type.label, { color: colors.mutedForeground }]}>DAY</Text>
                    <View style={s.wrapRow}>
                      {days.slice(0, FREE_DAYS_BACK + 1).filter((d) => d.offered).map((d) => (
                        <Chip
                          key={d.date}
                          label={d.label}
                          selected={daysBack === d.daysBack}
                          tone={tone}
                          accessibilityLabel={`Log for ${d.label}`}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setDaysBack(d.daysBack);
                            setSubmitError(null);
                          }}
                        />
                      ))}
                      {pro ? (
                        <Chip
                          label={daysBack > FREE_DAYS_BACK ? days[daysBack]!.label : "Older"}
                          selected={daysBack > FREE_DAYS_BACK}
                          tone={tone}
                          accessibilityLabel="Pick an older day"
                          onPress={() => setShowOlder((o) => !o)}
                        />
                      ) : null}
                    </View>
                    {!pro ? <ProLock label="Older days" /> : null}
                    {pro && showOlder ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.olderRow}>
                        {days.slice(FREE_DAYS_BACK + 1).filter((d) => d.offered).map((d) => (
                          <Chip
                            key={d.date}
                            label={d.label}
                            selected={daysBack === d.daysBack}
                            tone={tone}
                            accessibilityLabel={`Log for ${d.label}`}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setDaysBack(d.daysBack);
                              setShowOlder(false);
                              setSubmitError(null);
                            }}
                          />
                        ))}
                      </ScrollView>
                    ) : null}
                    {daysBack > 0 ? (
                      <Text style={[type.meta, { color: colors.mutedForeground }]}>
                        Dated {days[daysBack]!.label}. Scores, but a day already closed keeps its streak.
                      </Text>
                    ) : null}
                  </View>

                  <View style={s.field}>
                    <Text style={[type.label, { color: colors.mutedForeground }]}>NOTE</Text>
                    <TextInput
                      style={[type.body, s.input, s.note, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                      placeholder={isForbidden ? "What you did. The record is permanent." : "Optional. What happened, specifically."}
                      placeholderTextColor={colors.subtle}
                      value={note}
                      onChangeText={setNote}
                      accessibilityLabel="Note"
                      multiline
                      numberOfLines={3}
                    />
                  </View>

                  {/* Forbidden log: below the fields, a deliberate switch with its trade spelled out. */}
                  <View style={[s.forbidden, { borderColor: isForbidden ? colors.destructive : colors.border }]}>
                    <View style={s.flex}>
                      <Text style={[type.bodyStrong, { color: isForbidden ? colors.destructive : colors.foreground }]}>Forbidden log</Text>
                      <Text style={[type.meta, { color: colors.mutedForeground }]}>
                        {`${FORBIDDEN_GAIN} to ${selectedDomain}, ${FORBIDDEN_PENALTY} DISCIPLINE. The record cannot be deleted.`}
                      </Text>
                    </View>
                    <Switch
                      value={isForbidden}
                      onValueChange={handleToggleForbidden}
                      accessibilityLabel="Forbidden log"
                      trackColor={{ true: colors.destructive, false: colors.muted }}
                      thumbColor={colors.foreground}
                    />
                  </View>

                  {takesBonus && streak > 0 ? (
                    <Text style={[type.meta, { color: colors.mutedForeground }]}>
                      {`${streak}-day ${selectedDomain} streak: ×${getStreakMultiplier(streak).toFixed(1)} on this entry.`}
                    </Text>
                  ) : null}
                </>
              ) : !customId ? (
                <Text style={[type.body, { color: colors.mutedForeground }]}>Choose a domain.</Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        {/* The manual form's own submit, only on that page and never while a custom stat (with its own) is chosen. */}
        {mode === "manual" && !customId && !done ? (
          <View style={[s.footer, { borderTopColor: colors.border }]}>
            {submitError ? <Text style={[type.body, { color: colors.destructive }]}>{submitError}</Text> : null}
            <Button
              label={submitLabel}
              variant={isForbidden ? "destructive" : "filled"}
              onPress={() => void handleSubmit()}
              disabled={!selectedDomain}
              loading={submitting}
              block
            />
          </View>
        ) : null}

        {done ? (
          <View style={s.doneLayer} pointerEvents="none" accessibilityLiveRegion="polite">
            <SystemWindow title="SYSTEM" style={s.doneWindow} solid>
              <Text style={[type.title, s.doneText, { color: colors.foreground }]}>{done}</Text>
            </SystemWindow>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: { height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: space.xs, marginTop: space.sm },
  headerGap: { width: 48 },
  headerTitle: { flex: 1, paddingHorizontal: space.xs },
  content: { paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.xl },
  section: { gap: space.lg },
  hidden: { display: "none" },
  dimmed: { opacity: 0.15 },
  manualLink: { alignSelf: "center" },
  field: { gap: space.sm },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  olderRow: { flexDirection: "row", gap: space.sm },
  chipClip: { borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  chip: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md },
  scaleRow: { flexDirection: "row", alignItems: "center" },
  scaleHit: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  scaleBar: { width: 36, height: 8, borderRadius: 2 },
  scaleText: { marginLeft: space.sm, flex: 1 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 4, paddingHorizontal: space.md, paddingVertical: space.sm },
  note: { minHeight: 96, textAlignVertical: "top", paddingTop: space.sm + 4 },
  rowFrame: { borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  forbidden: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginTop: space.sm,
  },
  footer: { paddingHorizontal: space.md, paddingTop: space.md, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  doneLayer: { ...StyleSheet.absoluteFillObject, justifyContent: "center", paddingHorizontal: space.md },
  doneWindow: { paddingVertical: space.lg },
  doneText: { textAlign: "center" },
});
