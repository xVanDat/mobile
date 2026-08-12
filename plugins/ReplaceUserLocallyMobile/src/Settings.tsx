import { React, ReactNative } from "@vendetta/metro/common";
import { useProxy } from "@vendetta/storage";
import { storage, spoofUser, restoreOriginalUser } from "./index";

const { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Switch } = ReactNative;

export default function Settings() {
    useProxy(storage);

    return (
        <ScrollView style={styles.container}>
            <Text style={styles.header}>Cài đặt ReplaceUserLocally Mobile</Text>
            
            <Text style={styles.label}>Replaced User ID (ID người dùng muốn thay thế):</Text>
            <TextInput
                style={styles.input}
                value={storage.replacedUserId}
                onChangeText={(val: string) => { storage.replacedUserId = val.trim(); }}
                placeholder="Nhập User ID bị thay thế..."
                placeholderTextColor="#888"
            />

            <Text style={styles.label}>Target User ID (ID người dùng đích):</Text>
            <TextInput
                style={styles.input}
                value={storage.targetUserId}
                onChangeText={(val: string) => { storage.targetUserId = val.trim(); }}
                placeholder="Nhập User ID mục tiêu..."
                placeholderTextColor="#888"
            />

            <Text style={styles.label}>Custom Avatar URL (Tùy chọn Link ảnh Avatar):</Text>
            <TextInput
                style={styles.input}
                value={storage.customAvatarUrl}
                onChangeText={(val: string) => { storage.customAvatarUrl = val.trim(); }}
                placeholder="https://... (Để trống nếu dùng Avatar gốc từ ID)"
                placeholderTextColor="#888"
            />

            <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Tự động sao chép Target User ID</Text>
                <Switch
                    value={storage.copySpoofedId}
                    onValueChange={(val: boolean) => { storage.copySpoofedId = val; }}
                />
            </View>

            <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Ẩn toàn bộ Badges</Text>
                <Switch
                    value={storage.hideBadges}
                    onValueChange={(val: boolean) => { storage.hideBadges = val; }}
                />
            </View>

            <Text style={styles.label}>Ngày Gia nhập Discord (YYYY-MM-DD):</Text>
            <TextInput
                style={styles.input}
                value={storage.customJoinedDiscord}
                onChangeText={(val: string) => { storage.customJoinedDiscord = val.trim(); }}
                placeholder="2020-01-01"
                placeholderTextColor="#888"
            />

            <Text style={styles.label}>Ngày Gia nhập Server (YYYY-MM-DD):</Text>
            <TextInput
                style={styles.input}
                value={storage.customJoinedServer}
                onChangeText={(val: string) => { storage.customJoinedServer = val.trim(); }}
                placeholder="2021-05-15"
                placeholderTextColor="#888"
            />

            <Text style={styles.label}>Ngày Friends Since (YYYY-MM-DD):</Text>
            <TextInput
                style={styles.input}
                value={storage.customFriendsSince}
                onChangeText={(val: string) => { storage.customFriendsSince = val.trim(); }}
                placeholder="2022-10-10"
                placeholderTextColor="#888"
            />

            <TouchableOpacity style={styles.button} onPress={() => spoofUser()}>
                <Text style={styles.buttonText}>Áp dụng / Spoof User</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.button, styles.restoreButton]} onPress={() => restoreOriginalUser()}>
                <Text style={styles.buttonText}>Khôi phục User gốc</Text>
            </TouchableOpacity>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
    },
    header: {
        fontSize: 18,
        fontWeight: "bold",
        color: "#ffffff",
        marginBottom: 16,
    },
    label: {
        fontSize: 14,
        color: "#cccccc",
        marginTop: 12,
        marginBottom: 6,
    },
    input: {
        backgroundColor: "#1e1e2e",
        color: "#ffffff",
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        fontSize: 14,
        borderWidth: 1,
        borderColor: "#444455",
    },
    switchRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 16,
        marginBottom: 8,
    },
    switchLabel: {
        fontSize: 14,
        color: "#ffffff",
        flex: 1,
    },
    button: {
        backgroundColor: "#5865F2",
        padding: 14,
        borderRadius: 8,
        alignItems: "center",
        marginTop: 20,
    },
    restoreButton: {
        backgroundColor: "#ED4245",
        marginTop: 10,
        marginBottom: 30,
    },
    buttonText: {
        color: "#ffffff",
        fontWeight: "bold",
        fontSize: 15,
    },
});
