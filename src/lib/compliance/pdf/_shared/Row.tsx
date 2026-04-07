/**
 * Reusable label/value row for compliance PDF templates.
 *
 * @license GPL-3.0-only
 */

import { Text, View } from "@react-pdf/renderer";
import { styles } from "../styles";

export function Row({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value !== undefined && value !== "" ? String(value) : "—"}</Text>
    </View>
  );
}
