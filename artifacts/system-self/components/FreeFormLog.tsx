// "Say it": the log sheet's first job. Type (or, with PRO, hold the mic and say) what you did, Parse it into up to
// 3 proposals, then Confirm (queued in the outbox with the original text as freeText), Edit (opens the manual form
// prefilled) or Drop each one, or Confirm all. Nothing is logged until a proposal is confirmed.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import type { LogProposalDto } from "@workspace/contracts";
import { ProLock } from "@/components/ProLock";
import { Button } from "@/components/ui/Button";
import { DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
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
  logGains,
  parseText,
  proposalDetail,
  proposalSummary,
  proposalToLogInput,
  sendVoice,
  signedScore,
  type Gain,
  type GainEntry,
} from "@/lib/freeform/freeform";

type Phase = "idle" | "parsing" | "recording" | "sending";

const toEntry = (p: LogProposalDto): GainEntry => ({ domain: p.domain, type: p.logType, data: p.data });

export function FreeFormLog({
  onLogged,
  onEdit,
  onOpenChange,
}: {
  /** Every proposal is settled and at least one was confirmed: the preview gains of the confirmed ones. */
  onLogged: (gains: Gain[]) => void;
  /** Opens the manual form prefilled with a proposal; `text` is the original text to attach as the note. */
  onEdit: (proposal: LogProposalDto, text: string) => void;
  /** How many proposals are still open (the sheet returns here after an Edit is logged while others wait). */
  onOpenChange?: (open: number) => void;
}) {
  const colors = useColors();
  const { addLog, domainScores } = useApp();
  const streakOf = (d: string) => domainScores.find((s) => s.domain === d)?.streak ?? 0;
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
    onOpenChange?.(proposals.length);
  }, [proposals, onOpenChange]);
  /** The confirmed proposals of this parse, for THE SYSTEM's line once all are settled. */
  const confirmedRef = useRef<GainEntry[]>([]);
  /** The text the proposals came from (typed, or the voice transcript): what a confirmed proposal carries as freeText. */
  const [source, setSource] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [needsPro, setNeedsPro] = useState(false);
  const [confirmed, setConfirmed] = useState(0);
  const [confirmingAll, setConfirmingAll] = useState(false);

  const holding = useRef(false);
  const startedAt = useRef(0);
  const recording = useRef(false);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showProposals = (list: LogProposalDto[], from: string) => {
    setProposals(list);
    setSource(from);
    setConfirmed(0);
    confirmedRef.current = [];
    setMessage(list.length === 0 ? "Nothing loggable found. Rephrase it, or log it manually." : null);
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

  /** Queues one proposal; true when it was recorded. The last one settled hands THE SYSTEM's line to the sheet. */
  const confirm = async (p: LogProposalDto): Promise<boolean> => {
    // A second tap while the first is still queueing would log it twice.
    if (confirming.current.has(p)) return false;
    confirming.current.add(p);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await addLog(proposalToLogInput(p, source));
    } catch {
      confirming.current.delete(p);
      setMessage("The entry could not be recorded on this device. Sign in again, then retry.");
      return false;
    }
    confirming.current.delete(p);
    confirmedRef.current = [...confirmedRef.current, toEntry(p)];
    const rest = settle(p);
    setConfirmed((n) => n + 1);
    if (rest.length === 0) {
      setText("");
      onLogged(logGains(confirmedRef.current, streakOf));
    }
    return true;
  };

  const confirmAll = async () => {
    if (confirmingAll) return;
    setConfirmingAll(true);
    for (const p of [...openProposals.current]) {
      if (!(await confirm(p))) break;
    }
    setConfirmingAll(false);
  };

  const edit = (p: LogProposalDto) => {
    settle(p);
    onEdit(p, source);
  };

  const drop = (p: LogProposalDto) => {
    Haptics.selectionAsync();
    const rest = settle(p);
    // Dropping the last open proposal after confirming others still closes the loop with THE SYSTEM's line.
    if (rest.length === 0 && confirmedRef.current.length > 0) {
      setText("");
      onLogged(logGains(confirmedRef.current, streakOf));
    }
  };

  const recordingNow = phase === "recording";
  const busy = phase === "parsing" || phase === "sending";
  const canParse = !busy && !recordingNow && text.trim() !== "";

  return (
    <View style={s.root}>
      <TextInput
        style={[type.body, s.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
        placeholder="slept 7 hours and ran 5km"
        placeholderTextColor={colors.subtle}
        value={text}
        onChangeText={(t) => {
          setText(t);
          setMessage(null);
        }}
        maxLength={FREEFORM_MAX_CHARS}
        accessibilityLabel="What did you do"
        returnKeyType="go"
        onSubmitEditing={() => void runParse()}
        editable={phase === "idle"}
        autoFocus
      />
      <View style={s.row}>
        <View style={[s.micClip, { borderColor: recordingNow ? colors.destructive : colors.border }]}>
          <Pressable
            onPressIn={() => void startRecording()}
            onPressOut={stopRecording}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Hold to record a voice log"
            accessibilityState={{ disabled: busy, busy: recordingNow }}
            android_ripple={{ color: "rgba(168,121,255,0.2)" }}
            style={[s.mic, { backgroundColor: recordingNow ? colors.muted : colors.card, opacity: busy ? 0.45 : 1 }]}
          >
            <Feather name="mic" size={22} color={recordingNow ? colors.destructive : colors.foreground} />
          </Pressable>
        </View>
        <Button
          label={phase === "parsing" ? "Parsing" : "Parse"}
          onPress={() => void runParse()}
          disabled={!canParse}
          loading={phase === "parsing"}
          style={s.parse}
          accessibilityLabel="Parse the text into log entries"
        />
      </View>
      <Text style={[type.meta, { color: recordingNow ? colors.destructive : colors.subtle }]}>
        {recordingNow
          ? "Listening. Release to send."
          : phase === "sending"
            ? "Transcribing."
            : "Hold the mic to speak (PRO). Nothing is logged until you confirm."}
      </Text>
      {needsPro ? <ProLock label="Voice log" /> : null}
      {message ? <Text style={[type.body, { color: colors.mutedForeground }]}>{message}</Text> : null}

      {proposals.length > 0 ? (
        <View style={s.list}>
          {proposals.map((p, i) => {
            const tone = DOMAIN_COLORS[p.domain];
            const gain = logGains([toEntry(p)], streakOf).find((g) => g.label === p.domain);
            return (
              <View key={`${p.domain}.${p.logType}.${i}`} style={[s.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <View style={s.cardHead}>
                  <View style={[s.chip, { borderColor: tone }]}>
                    <Text style={[type.label, { color: tone }]}>{p.domain}</Text>
                  </View>
                  <Text style={[type.meta, s.flex, { color: colors.subtle }]}>{`${Math.round(p.confidence * 100)}% sure`}</Text>
                  {gain ? <Text style={[type.number, { color: colors.foreground }]}>{signedScore(gain.delta)}</Text> : null}
                </View>
                <Text style={[type.bodyStrong, { color: colors.foreground }]}>{proposalDetail(p)}</Text>
                <View style={s.actions}>
                  <Button label="Confirm" onPress={() => void confirm(p)} disabled={confirmingAll} accessibilityLabel={`Confirm ${proposalSummary(p)}`} />
                  <Button label="Edit" variant="text" onPress={() => edit(p)} disabled={confirmingAll} accessibilityLabel={`Edit ${proposalSummary(p)}`} />
                  <Button label="Drop" variant="text" onPress={() => drop(p)} disabled={confirmingAll} accessibilityLabel={`Drop ${proposalSummary(p)}`} />
                </View>
              </View>
            );
          })}
          {proposals.length > 1 ? (
            <Button
              label={`Confirm all ${proposals.length}`}
              onPress={() => void confirmAll()}
              loading={confirmingAll}
              block
            />
          ) : null}
          {confirmed > 0 ? (
            <Text style={[type.meta, { color: colors.mutedForeground }]}>{`${confirmed} logged. Confirm or drop the rest.`}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: space.sm },
  flex: { flex: 1 },
  input: { minHeight: 56, borderWidth: 1, borderRadius: 4, paddingHorizontal: space.md, paddingVertical: space.sm + 4 },
  row: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  micClip: { borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  mic: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  parse: { flex: 1, alignSelf: "stretch" },
  list: { gap: space.md, marginTop: space.md },
  card: { borderWidth: 1, borderRadius: 4, padding: space.md, gap: space.sm },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  chip: { borderWidth: 1, borderRadius: 2, paddingHorizontal: space.sm, paddingVertical: 2 },
  actions: { flexDirection: "row", gap: space.sm, alignItems: "center", marginTop: space.xs },
});
