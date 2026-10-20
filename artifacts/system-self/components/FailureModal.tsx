import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { NoticeAction, NoticeFigure, NoticeShell, Typewriter } from "@/components/SystemNoticeModal";
import { space, type } from "@/constants/type";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useSystemAI } from "@/hooks/useSystemAI";
import type { FailureItem } from "@/lib/game/notices";

interface Props {
  visible: boolean;
  /** Quests the server failed (expired) since the last visit; shown together in one modal. */
  failures: FailureItem[];
  onAcknowledge: () => void;
}

const MAX_TITLES = 4;

/** [ QUEST FAILED ]: which quests expired, the DISCIPLINE penalty as a number, and THE SYSTEM's verdict. */
export function FailureModal({ visible, failures, onAcknowledge }: Props) {
  const colors = useColors();
  const { user } = useApp();
  const { generateMessage } = useSystemAI();
  const [verdict, setVerdict] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || failures.length === 0) return;
    setVerdict(null);
    let cancelled = false;
    // POST /api/messages; the fallback string on any failure.
    if (user) {
      void generateMessage("failure_response").then((msg) => {
        if (!cancelled) setVerdict(msg);
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, failures]);

  if (!visible || failures.length === 0) return null;

  const total = failures.reduce((sum, f) => sum + f.penalty, 0);
  const shown = failures.slice(0, MAX_TITLES);
  const hidden = failures.length - shown.length;

  return (
    <NoticeShell
      visible={visible}
      title={failures.length === 1 ? "QUEST FAILED" : `${failures.length} QUESTS FAILED`}
      frameColor={colors.destructive}
      onClose={onAcknowledge}
    >
      <View style={s.list}>
        {shown.map((f, i) => (
          <View key={`${f.title}-${i}`} style={[s.row, { borderBottomColor: colors.border }]}>
            <Text style={[type.body, s.flex, { color: colors.foreground }]} numberOfLines={2}>
              {f.title}
            </Text>
            <Text style={[type.label, { color: colors.mutedForeground }]}>{f.type.toUpperCase()}</Text>
          </View>
        ))}
        {hidden > 0 ? <Text style={[type.meta, { color: colors.mutedForeground }]}>{`+${hidden} more`}</Text> : null}
      </View>
      <NoticeFigure value={`−${total.toFixed(1)}`} unit="DISCIPLINE" color={colors.destructive} />
      {verdict === null ? (
        <Text style={[type.meta, s.center, { color: colors.subtle }]}>The System is writing its verdict.</Text>
      ) : (
        <Typewriter text={verdict} style={[type.title, s.center, { color: colors.foreground }]} />
      )}
      <NoticeAction onPress={onAcknowledge} />
    </NoticeShell>
  );
}

const s = StyleSheet.create({
  list: { gap: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1 },
  center: { textAlign: "center" },
});
