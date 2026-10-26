import { StyleSheet, Text, View } from "react-native";

export default function UpdateScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Update PraiseLoop</Text>
      <Text style={styles.muted}>
        This version is out of date. Update from the App Store or Google Play to keep reviewing and sharing your posts.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 28, backgroundColor: "#f7f5f0" },
  title: { fontSize: 28, fontWeight: "700", textAlign: "center", color: "#12283a" },
  muted: { fontSize: 16, lineHeight: 23, textAlign: "center", color: "#52616d" }
});
