import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher, clipboard } from "@vendetta/metro/common";
import { before, after, instead } from "@vendetta/patcher";
import { showToast } from "@vendetta/ui/toasts";
import { createProxy } from "@vendetta/storage";
import Settings from "./Settings";

const { proxy: storage } = createProxy({
    targetUserId: "",
    copySpoofedId: true,
    hideBadges: false,
    customJoinedDiscord: "",
    customJoinedServer: "",
    customFriendsSince: ""
});

export { storage };

// Dynamic store and module resolvers with robust fallbacks
const getUserStore = () => findByStoreName("UserStore") || findByProps("getCurrentUser") || findByProps("getUser");
const getRelationshipStore = () => findByStoreName("RelationshipStore") || findByProps("getSince");
const getGuildMemberStore = () => findByStoreName("GuildMemberStore") || findByProps("getMember");
const getUserProfileStore = () => findByStoreName("UserProfileStore") || findByProps("getUserProfile");
const getSnowflakeUtils = () => findByProps("extractTimestamp");
const getUserUtils = () => findByProps("getUser", "fetchProfile") || findByProps("getUser");
const getProfileActions = () => findByProps("fetchProfile");

export function getCurrentUser(): any {
    const store = getUserStore();
    if (!store) return null;
    if (typeof store.getCurrentUser === "function") {
        const u = store.getCurrentUser();
        if (u) return u;
    }
    if (typeof store.getCurrentUserId === "function") {
        const id = store.getCurrentUserId();
        if (id && typeof store.getUser === "function") {
            const u = store.getUser(id);
            if (u) return u;
        }
    }
    return null;
}

export function getUser(id: string): any {
    const store = getUserStore();
    if (!store) return null;
    if (typeof store.getUser === "function") {
        const u = store.getUser(id);
        if (u) return u;
    }
    if (store._users && store._users[id]) return store._users[id];
    if (store.users && store.users[id]) return store.users[id];
    return null;
}

let unpatches: (() => void)[] = [];
let originalUserProps: Record<string, any> = {};
let hasSpoofed = false;
let isEnforcing = false;

const visualProps = [
    "username",
    "globalName",
    "avatar",
    "avatarDecoration",
    "avatarDecorationData",
    "discriminator",
    "banner",
    "bio",
    "publicFlags",
    "pronouns"
];

let boundGetAvatarURL: any = null;
let boundGetBannerURL: any = null;

function processCopyText(text: string): string {
    if (!hasSpoofed || !storage.copySpoofedId) return text;
    const realUser: any = getCurrentUser();
    const targetId = storage.targetUserId;
    if (realUser && targetId && typeof text === "string" && text.includes(realUser.id)) {
        return text.replaceAll(realUser.id, targetId);
    }
    return text;
}

export function enforceSpoof() {
    if (!hasSpoofed || isEnforcing) return;
    const targetId = storage.targetUserId;
    const realUser: any = getCurrentUser();
    const targetUser: any = getUser(targetId);

    if (realUser && targetUser) {
        let changed = false;
        isEnforcing = true;

        try {
            const UserProfileStore = getUserProfileStore();
            for (const prop of visualProps) {
                if (prop === "publicFlags") {
                    const expectedFlags = storage.hideBadges ? 0 : targetUser.publicFlags;
                    if (realUser.publicFlags !== expectedFlags) {
                        realUser.publicFlags = expectedFlags;
                        changed = true;
                    }
                } else if (prop === "bio") {
                    const targetProfile = UserProfileStore?.getUserProfile?.(targetId);
                    const targetBio = targetProfile?.bio ?? targetUser.bio;
                    if (targetBio !== undefined && realUser.bio !== targetBio) {
                        realUser.bio = targetBio;
                        changed = true;
                    }
                } else {
                    if (realUser[prop] !== targetUser[prop]) {
                        realUser[prop] = targetUser[prop];
                        changed = true;
                    }
                }
            }

            if (boundGetAvatarURL && realUser.getAvatarURL !== boundGetAvatarURL) {
                realUser.getAvatarURL = boundGetAvatarURL;
                changed = true;
            }
            if (boundGetBannerURL && realUser.getBannerURL !== boundGetBannerURL) {
                realUser.getBannerURL = boundGetBannerURL;
                changed = true;
            }
        } finally {
            isEnforcing = false;
        }

        if (changed && FluxDispatcher?.dispatch) {
            setTimeout(() => {
                FluxDispatcher.dispatch({ type: "CURRENT_USER_UPDATE", user: realUser });
                FluxDispatcher.dispatch({ type: "USER_UPDATE", user: realUser });
            }, 0);
        }
    }
}

export async function spoofUser() {
    const targetId = storage.targetUserId;
    if (!targetId) {
        showToast("[FakeUserLocallyMobile] Vui lòng nhập Target User ID trong cài đặt");
        return;
    }

    const realUser: any = getCurrentUser();
    if (!realUser) {
        showToast("[FakeUserLocallyMobile] Không tìm thấy User hiện tại");
        return;
    }

    try {
        const UserUtils = getUserUtils();
        if (UserUtils?.getUser) {
            try { await UserUtils.getUser(targetId); } catch (_) {}
        }

        const ProfileActions = getProfileActions();
        if (ProfileActions?.fetchProfile) {
            try { await ProfileActions.fetchProfile(targetId, { guildId: undefined, withMutualGuilds: false }); } catch (_) {}
        }

        const targetUser: any = getUser(targetId);
        if (!targetUser) {
            showToast("[FakeUserLocallyMobile] Lỗi: Không thể lấy dữ liệu mục tiêu. ID có đúng không?");
            return;
        }

        if (!hasSpoofed) {
            for (const prop of visualProps) {
                originalUserProps[prop] = realUser[prop];
            }
            originalUserProps.getAvatarURL = realUser.getAvatarURL;
            originalUserProps.getBannerURL = realUser.getBannerURL;
        }

        const UserProfileStore = getUserProfileStore();
        for (const prop of visualProps) {
            if (prop === "publicFlags") {
                realUser.publicFlags = storage.hideBadges ? 0 : targetUser.publicFlags;
            } else if (prop === "bio") {
                const targetProfile = UserProfileStore?.getUserProfile?.(targetId);
                realUser.bio = targetProfile?.bio ?? targetUser.bio;
            } else {
                realUser[prop] = targetUser[prop];
            }
        }

        if (typeof targetUser.getAvatarURL === "function") {
            boundGetAvatarURL = targetUser.getAvatarURL.bind(targetUser);
            realUser.getAvatarURL = boundGetAvatarURL;
        }
        if (typeof targetUser.getBannerURL === "function") {
            boundGetBannerURL = targetUser.getBannerURL.bind(targetUser);
            realUser.getBannerURL = boundGetBannerURL;
        }

        hasSpoofed = true;
        enforceSpoof();

        if (FluxDispatcher?.dispatch) {
            FluxDispatcher.dispatch({ type: "CURRENT_USER_UPDATE", user: realUser });
            FluxDispatcher.dispatch({ type: "USER_UPDATE", user: realUser });
        }

        showToast("[FakeUserLocallyMobile] Giả mạo người dùng thành công!");
    } catch (e) {
        console.error("[FakeUserLocallyMobile] Lỗi:", e);
        showToast("[FakeUserLocallyMobile] Có lỗi xảy ra trong quá trình giả mạo");
    }
}

export function restoreOriginalUser() {
    if (!hasSpoofed) return;
    try {
        const realUser: any = getCurrentUser();
        if (realUser) {
            for (const prop of Object.keys(originalUserProps)) {
                try { realUser[prop] = originalUserProps[prop]; } catch (_) {}
            }
            try { delete realUser.getAvatarURL; } catch (_) {}
            try { delete realUser.getBannerURL; } catch (_) {}

            if (FluxDispatcher?.dispatch) {
                try { FluxDispatcher.dispatch({ type: "CURRENT_USER_UPDATE", user: realUser }); } catch (_) {}
                try { FluxDispatcher.dispatch({ type: "USER_UPDATE", user: realUser }); } catch (_) {}
            }
        }
    } catch (e) {
        console.error("[FakeUserLocallyMobile] Error restoring original user:", e);
    }
    hasSpoofed = false;
    originalUserProps = {};
    boundGetAvatarURL = null;
    boundGetBannerURL = null;
}

export function onLoad() {
    unpatches = [];

    if (clipboard && typeof clipboard.setString === "function") {
        unpatches.push(
            before("setString", clipboard, (args) => {
                if (args[0] && typeof args[0] === "string") {
                    args[0] = processCopyText(args[0]);
                }
            })
        );
    }

    const SnowflakeUtils = getSnowflakeUtils();
    if (SnowflakeUtils && typeof SnowflakeUtils.extractTimestamp === "function") {
        unpatches.push(
            instead("extractTimestamp", SnowflakeUtils, (args, orig) => {
                const [id] = args;
                const realUser: any = getCurrentUser();
                if (hasSpoofed && realUser && id === realUser.id && storage.customJoinedDiscord) {
                    const parsed = new Date(storage.customJoinedDiscord).getTime();
                    if (!isNaN(parsed)) return parsed;
                }
                return orig.apply(SnowflakeUtils, args);
            })
        );
    }

    const GuildMemberStore = getGuildMemberStore();
    if (GuildMemberStore && typeof GuildMemberStore.getMember === "function") {
        unpatches.push(
            after("getMember", GuildMemberStore, (args, member) => {
                const [, userId] = args;
                const realUser: any = getCurrentUser();
                if (hasSpoofed && realUser && userId === realUser.id && member && storage.customJoinedServer) {
                    const parsed = new Date(storage.customJoinedServer);
                    if (!isNaN(parsed.getTime())) {
                        return { ...member, joinedAt: parsed.toISOString() };
                    }
                }
                return member;
            })
        );
    }

    const RelationshipStore = getRelationshipStore();
    if (RelationshipStore && typeof RelationshipStore.getSince === "function") {
        unpatches.push(
            instead("getSince", RelationshipStore, (args, orig) => {
                const [userId] = args;
                const realUser: any = getCurrentUser();
                if (hasSpoofed && realUser && userId === realUser.id && storage.customFriendsSince) {
                    const parsed = new Date(storage.customFriendsSince);
                    if (!isNaN(parsed.getTime())) {
                        return parsed.toISOString();
                    }
                }
                return orig.apply(RelationshipStore, args);
            })
        );
    }

    const UserProfileStore = getUserProfileStore();
    if (UserProfileStore) {
        if (typeof UserProfileStore.getUserProfile === "function") {
            unpatches.push(
                after("getUserProfile", UserProfileStore, (args, profile) => {
                    const [userId] = args;
                    const realUser: any = getCurrentUser();
                    if (hasSpoofed && realUser && userId === realUser.id) {
                        const targetId = storage.targetUserId;
                        const targetProfile = targetId ? UserProfileStore.getUserProfile(targetId) : null;
                        const targetUser: any = targetId ? getUser(targetId) : null;
                        if (profile) {
                            const targetBio = targetProfile?.bio ?? targetUser?.bio;
                            if (targetBio !== undefined) profile.bio = targetBio;
                            if (storage.hideBadges) profile.badges = [];
                            else if (targetProfile?.badges) profile.badges = [...targetProfile.badges];
                        }
                    }
                    return profile;
                })
            );
        }

        if (typeof UserProfileStore.getGuildMemberProfile === "function") {
            unpatches.push(
                after("getGuildMemberProfile", UserProfileStore, (args, profile) => {
                    const [userId] = args;
                    const realUser: any = getCurrentUser();
                    if (hasSpoofed && realUser && userId === realUser.id) {
                        const targetId = storage.targetUserId;
                        const targetProfile = targetId ? UserProfileStore.getUserProfile(targetId) : null;
                        const targetUser: any = targetId ? getUser(targetId) : null;
                        if (profile) {
                            const targetBio = targetProfile?.bio ?? targetUser?.bio;
                            if (targetBio !== undefined) profile.bio = targetBio;
                            if (storage.hideBadges) profile.badges = [];
                            else if (targetProfile?.badges) profile.badges = [...targetProfile.badges];
                        }
                    }
                    return profile;
                })
            );
        }
    }

    const UserStore = getUserStore();
    if (UserStore?.addChangeListener) {
        UserStore.addChangeListener(enforceSpoof);
    }

    if (storage.targetUserId) {
        spoofUser();
    }
}

export function onUnload() {
    unpatches.forEach(u => u?.());
    unpatches = [];

    const UserStore = getUserStore();
    if (UserStore?.removeChangeListener) {
        try { UserStore.removeChangeListener(enforceSpoof); } catch (_) {}
    }

    restoreOriginalUser();
}

export default {
    onLoad,
    onUnload,
    settings: Settings,
};
