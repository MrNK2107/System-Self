import React from "react";
import type { PublicProfile } from "@workspace/contracts";
import { ListRow } from "@/components/ui/ListRow";
import { useColors } from "@/hooks/useColors";

const TRAJECTORY_WORDS: Record<string, string> = { up: "Rising", stable: "Steady", down: "Falling" };

/** One player as the server projected them: handle (username or codename), rank, trajectory. The dot is the rank colour. */
export function PlayerRow({ player, onPress }: { player: PublicProfile; onPress: () => void }) {
  const colors = useColors();
  const rankTone = (colors.rank as Record<string, string>)[player.rank] ?? colors.mutedForeground;
  const sub = [`Rank ${player.rank}`, TRAJECTORY_WORDS[player.trajectory] ?? player.trajectory, player.shadowActive ? "Shadow active" : null].filter(Boolean).join(" · ");
  return <ListRow title={player.handle} subtitle={sub} dot={rankTone} chevron onPress={onPress} accessibilityLabel={`${player.handle}, ${sub}`} />;
}
