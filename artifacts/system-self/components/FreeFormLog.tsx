// Free-form logging section of the log modal: type (or, with PRO, hold the mic and say) what you did, PARSE it into up
// to 3 proposals, then CONFIRM (queued in the outbox with the original text as freeText), EDIT (opens the structured
// form prefilled) or DROP each one. Nothing is logged until a proposal is confirmed.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import type { LogProposalDto } from "@workspace/contracts";
import { ProLock } from "@/components/ProLock";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useBillingStatusQuery } from "@/hooks/usePro";
import { isProStatus } from "@/lib/billing/core";
import { api } from "@/lib/api/client";
import {
  FREEFORM_MAX_CHARS,
  VOICE_MAX_MS,
  VOICE_MIN_MS,
  describeFreeformError,
  isProRequired,
  parseText,
  proposalSummary,
  proposalToLogInput,
  sendVoice,
} from "@/lib/freeform/freeform";

type Phase = "idle" | "parsing" | "recording" | "sending";

export function FreeFormLog({
  onLogged,
  onEdit,
}: {
  /** Every proposal has been confirmed, edited or dropped and at least one was confirmed. */
  onLogged: () => void;
  /** Opens the structured form prefilled with a proposal; `text` is the original text to attach as the note. */
  onEdit: (proposal: LogProposalDto, text: string) => void;
}) {
  const colors = useColors();
  const { addLog } = useApp();
  // PRO as the server last reported it (GET /api/billing/status); unknown until that loads, and then the server decides.
  const billing = useBillingStatusQuery().data;
  const knownPro = billing ? isProStatus(billing) : undefined;
  const confirming = useRef(new Set<LogProposalDto>());
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [proposals, setProposals] = useState<LogProposalDto[]>([]);
  // The proposals still open, kept in step with every update so two confirms finishing back to back both see the
  // other's removal (the "all settled" check below reads it, not a render-time snapshot).
  const openProposals = useRef<LogProposalDto[]>([]);
  useEffect(() => {
    openProposals.current = proposals;
  }, [proposals]);
  /** The text the proposals came from (typed, or the voice transcript): what a confirmed proposal carries as freeText. */
  const [source, setSource] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [needsPro, setNeedsPro] = useState(false);
  const [confirmed, setConfirmed] = useState(0);

  const holding = useRef(false);
  const startedAt = useRef(0);
  const recording = useRef(false);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showProposals = (list: LogProposalDto[], from: string) => {
    setProposals(list);
    setSource(from);
    setConfirmed(0);
    setMessage(list.length === 0 ? "Nothing loggable found. Rephrase it, or use the form below." : null);
  };

  const handleError = (err: unknown) => {
    if (isProRequired(err)) {
      setNeedsPro(true);
      setMessage(null);
    } else {
      setMessage(describeFreeformError(err));
    }
  };

  const runParse = async () => {
    const t = text.trim();
    if (!t || phase !== "idle") return;
    Haptics.selectionAsync();
    setPhase("parsing");
    setMessage(null);
    try {
      showProposals(await parseText(api, t), t);
    } catch (err) {
      handleError(err);
    } finally {
      setPhase("idle");
    }
  };

  const finishRecording = useCallback(async () => {
    if (!recording.current) return;
    recording.current = false;
    if (limitTimer.current) clearTimeout(limitTimer.current);
    limitTimer.current = null;
    const length = Date.now() - startedAt.current;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
    } catch {
      setPhase("idle");
      setMessage("The recording could not be saved. Retry.");
      return;
    }
    if (length < VOICE_MIN_MS || !recorder.uri) {
      setPhase("idle");
      setMessage("Hold the button while you speak.");
      return;
    }
    setPhase("sending");
    try {
      const audio = await (await fetch(recorder.uri)).blob();
      const out = await sendVoice(api, audio);
      setText(out.transcript);
      showProposals(out.proposals, out.transcript);
      if (out.proposals.length === 0) setMessage(`Heard: "${out.transcript}". Nothing loggable in it.`);
    } catch (err) {
      handleError(err);
    } finally {
      setPhase("idle");
    }
  }, [recorder]);

  const startRecording = async () => {
    if (phase !== "idle") return;
    // A free user sees the lock without the microphone ever starting.
    if (knownPro === false || needsPro) {
      setNeedsPro(true);
      setMessage(null);
      return;
    }
    holding.current = true;
    setMessage(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        holding.current = false;
        setMessage("Microphone access is off. Enable it in Settings to use voice.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      // Released while the permission prompt or the recorder was starting: do not record.
      if (!holding.current) {
        await setAudioModeAsync({ allowsRecording: false });
        return;
      }
      recorder.record();
      recording.current = true;
      startedAt.current = Date.now();
      setPhase("recording");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      limitTimer.current = setTimeout(() => void finishRecording(), VOICE_MAX_MS);
    } catch {
      holding.current = false;
      setMessage("The microphone could not be started.");
    }
  };

  const stopRecording = () => {
    holding.current = false;
    void finishRecording();
  };

  useEffect(
    () => () => {
      if (limitTimer.current) clearTimeout(limitTimer.current);
      if (recording.current) {
        recording.current = false;
        void recorder.stop().catch(() => undefined);
      }
    },
    [recorder],
  );

  const settle = (p: LogProposalDto) => {
    const rest = openProposals.current.filter((x) => x !== p);
    openProposals.current = rest;
    setProposals((prev) => prev.filter((x) => x !== p));
    return rest;
  };

  const confirm = async (p: LogProposalDto) => {
    // A second tap while the first is still queueing would log it twice.
    if (confirming.current.has(p)) return;
    confirming.current.add(p);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await addLog(proposalToLogInput(p, source));
    } catch {
      confirming.current.delete(p);
      setMessage("The entry could not be recorded on this device. Sign in again, then retry.");
      return;
    }
    confirming.current.delete(p);
    const rest = settle(p);
    setConfirmed((n) => n + 1);
    if (rest.length === 0) {
      setText("");
      onLogged();
    }
  };

  const edit = (p: LogProposalDto) => {
    settle(p);
    onEdit(p, source);
  };

  const recordingNow = phase === "recording";
  const busy = phase === "parsing" || phase === "sending";

  return (
    <View style={s.section}>
      <Text style={[s.label, { color: colors.mutedForeground }]}>SAY IT</Text>
      <View style={s.row}>
        <TextInput
          style={[s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
          placeholder="slept 6 hours and read 30 pages"
          placeholderTextColor={colors.mutedForeground}
          value={text}
          onChangeText={(t) => {
            setText(t);
            setMessage(null);
          }}
          maxLength={FREEFORM_MAX_CHARS}
          accessibilityLabel="Free-form log text"
          returnKeyType="go"
          onSubmitEditing={() => void runParse()}
          editable={phase === "idle"}
        />
        <Pressable
          onPressIn={() => void startRecording()}
          onPressOut={stopRecording}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Hold to record a voice log"
          style={[
            s.mic,
            { borderColor: recordingNow ? "#E05555" : colors.border, backgroundColor: recordingNow ? "#E0555530" : colors.card, opacity: busy ? 0.5 : 1 },
          ]}
        >
          <Feather name="mic" size={16} color={recordingNow ? "#E05555" : colors.mutedForeground} />
        </Pressable>
        <TouchableOpacity
          onPress={() => void runParse()}
          disabled={busy || recordingNow || text.trim() === ""}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Parse the text into log entries"
          style={[s.parse, { backgroundColor: colors.accentFill, opacity: busy || recordingNow || text.trim() === "" ? 0.5 : 1 }]}
        >
          <Text style={[s.parseText, { color: colors.primaryForeground }]}>{phase === "parsing" ? "…" : "PARSE"}</Text>
        </TouchableOpacity>
      </View>
      <Text style={[s.hint, { color: colors.mutedForeground }]}>
        {recordingNow ? "LISTENING. Release to send." : phase === "sending" ? "TRANSCRIBING…" : "Hold the mic to speak (PRO). Nothing is logged until you confirm."}
      </Text>
      {needsPro ? <ProLock label="Voice log" /> : null}
      {message ? <Text style={[s.message, { color: colors.mutedForeground }]}>{message}</Text> : null}

      {proposals.map((p, i) => (
        <View key={`${p.domain}.${p.logType}.${i}`} style={[s.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[s.cardTitle, { color: colors.foreground }]}>{proposalSummary(p)}</Text>
          <Text style={[s.cardSub, { color: colors.mutedForeground }]}>{`${Math.round(p.confidence * 100)}% sure`}</Text>
          <View style={s.actions}>
            <TouchableOpacity
              onPress={() => void confirm(p)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Confirm ${proposalSummary(p)}`}
              style={[s.action, { backgroundColor: colors.accentFill, borderColor: colors.accentFill }]}
            >
              <Text style={[s.actionText, { color: colors.primaryForeground }]}>CONFIRM</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => edit(p)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${proposalSummary(p)}`}
              style={[s.action, { borderColor: colors.border }]}
            >
              <Text style={[s.actionText, { color: colors.foreground }]}>EDIT</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => settle(p)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Drop ${proposalSummary(p)}`}
              style={[s.action, { borderColor: colors.border }]}
            >
              <Text style={[s.actionText, { color: colors.mutedForeground }]}>DROP</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
      {confirmed > 0 && proposals.length > 0 ? (
        <Text style={[s.hint, { color: colors.mutedForeground }]}>{`${confirmed} queued. Confirm or drop the rest.`}</Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  section: { marginBottom: 24, gap: 8 },
  label: { fontSize: 9, fontWeight: "600", letterSpacing: 2 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  mic: { width: 40, height: 40, borderWidth: 1, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  parse: { height: 40, paddingHorizontal: 14, borderRadius: 2, alignItems: "center", justifyContent: "center" },
  parseText: { fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  hint: { fontSize: 10, letterSpacing: 0.6, lineHeight: 15 },
  message: { fontSize: 11, lineHeight: 16 },
  card: { borderWidth: 1, borderRadius: 4, padding: 12, gap: 6 },
  cardTitle: { fontSize: 13, fontWeight: "600" },
  cardSub: { fontSize: 10, letterSpacing: 1 },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
  action: { flex: 1, borderWidth: 1, borderRadius: 2, paddingVertical: 9, alignItems: "center" },
  actionText: { fontSize: 10, fontWeight: "700", letterSpacing: 2 },
});
