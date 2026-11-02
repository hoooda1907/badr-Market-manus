import { CameraView, useCameraPermissions } from "expo-camera";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

const GREEN = "#079455";

export function BarcodeScanner({ visible, onClose, onScanned }: { visible: boolean; onClose: () => void; onScanned: (barcode: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const close = () => { setLocked(false); onClose(); };
  const scan = ({ data }: { data: string }) => {
    if (locked || !data) return;
    setLocked(true);
    onScanned(data.trim());
    close();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>مسح الباركود</Text>
          <Pressable onPress={close} style={styles.close}><Text style={styles.closeText}>إغلاق</Text></Pressable>
        </View>
        {!permission?.granted ? (
          <View style={styles.permission}>
            <Text style={styles.permissionText}>اسمح باستخدام الكاميرا لمسح باركود المنتج.</Text>
            <Pressable onPress={requestPermission} style={styles.allow}><Text style={styles.allowText}>السماح بالكاميرا</Text></Pressable>
          </View>
        ) : (
          <View style={styles.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "qr"] }}
              onBarcodeScanned={locked ? undefined : scan}
            />
            <View pointerEvents="none" style={styles.frame} />
            <Text style={styles.hint}>وجّه الكاميرا إلى باركود الصنف</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#101813" },
  header: { height: 68, paddingHorizontal: 18, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff" },
  title: { color: "#173525", fontSize: 18, fontWeight: "800" },
  close: { backgroundColor: "#eef6f0", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  closeText: { color: GREEN, fontWeight: "700" },
  permission: { flex: 1, justifyContent: "center", alignItems: "center", padding: 28, gap: 18 },
  permissionText: { color: "#fff", textAlign: "center", fontSize: 17, lineHeight: 26 },
  allow: { backgroundColor: GREEN, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 12 },
  allowText: { color: "#fff", fontWeight: "800" },
  cameraWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: { width: 280, height: 180, borderWidth: 3, borderColor: "#27df85", borderRadius: 20, backgroundColor: "transparent" },
  hint: { position: "absolute", bottom: 48, color: "#fff", backgroundColor: "#0009", padding: 12, borderRadius: 10, overflow: "hidden" },
});
