import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { type Domain, type ShadowSelf } from "@/context/AppContext";
import { ALL_DOMAINS as DOMAINS, DOMAIN_COLORS } from "@/constants/domains";

const { width: SW } = Dimensions.get("window");

interface Props {
  shadow: ShadowSelf;
  shadowScores: Record<Domain, string | number>;
  shadowRank: string;
  userScores: Record<Domain, number>;
}

export function ShadowSelfCard({ shadow, shadowScores, shadowRank, userScores }: Props) {
  const colors = useColors();
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.8, duration: 1800, useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 1800, useNativeDriver: false }),
      ])
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2200, useNativeDriver: false }),
        Animated.timing(glowAnim, { toValue: 0, duration: 2200, useNativeDriver: false }),
      ])
    ).start();
  }, []);

  const totalGap = DOMAINS.reduce((sum, d) => {
    return sum + ((Number(shadowScores[d]) || 0) - (userScores[d] ?? 0));
  }, 0) / DOMAINS.length;

  const isAhead = totalGap > 0;
  const domainsLosing = DOMAINS.filter(d => (Number(shadowScores[d]) || 0) > (userScores[d] ?? 0));

  return (
    <View style={styles.outer}>
      {/* Animated border glow */}
      <Animated.View
        style={[
          styles.glowBorder,
          { opacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.6] }) },
        ]}
      />

      <View style={[styles.card, { borderColor: "#E0555540" }]}>
        <LinearGradient
          colors={["#E0555508", "#3A0A0A06", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Animated.View
              style={[
                styles.activeDot,
                { opacity: pulseAnim, backgroundColor: "#E05555" },
              ]}
            />
            <View>
              <Text style={styles.codenameLabel}>SHADOW ENTITY</Text>
              <Text style={styles.codename}>{shadow.codename}</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.rankBadge}>
              <Text style={styles.rankText}>{shadowRank}</Text>
            </View>
          </View>
        </View>

        {/* Gap alert */}
        <View style={[
          styles.alertRow,
          {
            backgroundColor: isAhead ? "#E0555512" : "#4B8B6F12",
            borderColor: isAhead ? "#E0555540" : "#4B8B6F40",
          },
        ]}>
          <Feather
            name={isAhead ? "alert-triangle" : "check-circle"}
            size={13}
            color={isAhead ? "#E05555" : "#4B8B6F"}
          />
          <Text style={[styles.alertText, { color: isAhead ? "#E05555" : "#4B8B6F" }]}>
            {isAhead
              ? `${Math.abs(totalGap).toFixed(1)} pts ahead of you. ${domainsLosing.length} domain${domainsLosing.length !== 1 ? "s" : ""} compromised.`
              : `You are ${Math.abs(totalGap).toFixed(1)} pts ahead of your shadow. Stay disciplined.`
            }
          </Text>
        </View>

        {/* Domain comparison bars */}
        <View style={styles.domains}>
          {DOMAINS.map(d => {
            const shadowScore = Number(shadowScores[d]) || 0;
            const userScore = userScores[d] ?? 0;
            const diff = shadowScore - userScore;
            const losing = diff > 0;
            const color = DOMAIN_COLORS[d];

            return (
              <View key={d} style={styles.domainRow}>
                <Text style={[styles.domainLabel, { color }]}>{d}</Text>
                <View style={styles.barSection}>
                  {/* Composite track: user bar + shadow marker */}
                  <View style={styles.trackOuter}>
                    {/* Shadow fill (darker/translucent) */}
                    <View
                      style={[
                        styles.shadowFill,
                        {
                          width: `${Math.min(100, shadowScore)}%`,
                          backgroundColor: "#E05555",
                          opacity: 0.25,
                        },
                      ]}
                    />
                    {/* User fill */}
                    <View
                      style={[
                        styles.userFill,
                        {
                          width: `${Math.min(100, userScore)}%`,
                          backgroundColor: color,
                        },
                      ]}
                    />
                    {/* Shadow marker line */}
                    <View
                      style={[
                        styles.shadowMarker,
                        {
                          left: `${Math.min(100, shadowScore)}%`,
                          backgroundColor: "#E05555",
                        },
                      ]}
                    />
                  </View>
                </View>
                <View style={styles.diffCell}>
                  <Text style={[
                    styles.diffText,
                    { color: losing ? "#E05555" : "#4B8B6F" },
                  ]}>
                    {losing ? `−${diff.toFixed(1)}` : `+${Math.abs(diff).toFixed(1)}`}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Daily gain notice */}
        <View style={styles.footer}>
          <Feather name="clock" size={10} color="#3A3D48" />
          <Text style={styles.footerText}>
            Shadow accumulates {Object.values(shadow.dailyGainRate).reduce((a, b) => a + b, 0).toFixed(1)} pts/day across all domains.
            Log to close the gap.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: "relative",
  },
  glowBorder: {
    position: "absolute",
    top: -2,
    bottom: -2,
    left: -2,
    right: -2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E05555",
  },
  card: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    gap: 14,
    overflow: "hidden",
    backgroundColor: "#0D1018",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  codenameLabel: {
    fontSize: 8,
    letterSpacing: 3,
    color: "#E05555",
    fontWeight: "700" as const,
    marginBottom: 3,
  },
  codename: {
    fontSize: 15,
    fontWeight: "800" as const,
    color: "#D0D2DC",
    letterSpacing: 1,
  },
  headerRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  rankBadge: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderColor: "#E0555540",
    backgroundColor: "#0A0D14",
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: {
    fontSize: 18,
    fontWeight: "900" as const,
    color: "#E05555",
    letterSpacing: 2,
  },
  alertRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
  alertText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600" as const,
  },
  domains: {
    gap: 10,
  },
  domainRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  domainLabel: {
    width: 72,
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 2,
    textAlign: "right",
  },
  barSection: {
    flex: 1,
  },
  trackOuter: {
    height: 5,
    backgroundColor: "#12151E",
    borderRadius: 3,
    overflow: "visible",
    position: "relative",
  },
  shadowFill: {
    position: "absolute",
    left: 0,
    top: 0,
    height: "100%",
    borderRadius: 3,
  },
  userFill: {
    position: "absolute",
    left: 0,
    top: 0,
    height: "100%",
    borderRadius: 3,
  },
  shadowMarker: {
    position: "absolute",
    top: -3,
    width: 2,
    height: 11,
    borderRadius: 1,
    marginLeft: -1,
    opacity: 0.9,
  },
  diffCell: {
    width: 44,
    alignItems: "flex-end",
  },
  diffText: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 0.5,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  footerText: {
    flex: 1,
    fontSize: 10,
    color: "#2A2D38",
    lineHeight: 15,
  },
});
