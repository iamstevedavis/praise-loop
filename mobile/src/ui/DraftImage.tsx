import { ActivityIndicator, Image, Pressable, StyleSheet, Text, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";
import { useDraftImage } from "../media/useDraftImage";
import { colors } from "./theme";

type DraftImageProps = {
  imagePath: string;
  style?: StyleProp<ImageStyle>;
  label?: string;
};

// Renders a draft PNG from the app cache. A failed download shows a placeholder
// the owner can tap to retry; an expired session is handled by useDraftImage.
export function DraftImage({ imagePath, style, label = "Post image" }: DraftImageProps) {
  const { state, retry } = useDraftImage(imagePath);

  if (state.status === "ready") {
    return (
      <Image
        source={{ uri: state.uri }}
        style={style}
        accessibilityLabel={label}
        accessibilityIgnoresInvertColors
      />
    );
  }

  const failed = state.status === "error";
  return (
    <Pressable
      accessibilityRole={failed ? "button" : "image"}
      accessibilityLabel={failed ? "Image didn't load. Tap to retry." : label}
      accessibilityState={{ busy: !failed }}
      disabled={!failed}
      onPress={retry}
      style={[style as StyleProp<ViewStyle>, styles.placeholder]}
    >
      {failed ? (
        <>
          <Text style={styles.message}>{"Image didn't load"}</Text>
          <Text style={styles.retry}>Tap to retry</Text>
        </>
      ) : (
        <ActivityIndicator color={colors.muted} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    padding: 4,
    backgroundColor: colors.line
  },
  message: { fontSize: 11, lineHeight: 14, fontWeight: "600", color: colors.muted, textAlign: "center" },
  retry: { fontSize: 11, lineHeight: 14, color: colors.accent, textAlign: "center" }
});
