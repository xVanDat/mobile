import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher, clipboard } from "@vendetta/metro/common";
import { before, after, instead } from "@vendetta/patcher";
import { showToast } from "@vendetta/ui/toasts";
import { createProxy } from "@vendetta/storage";
import Settings from "./Settings";

const { proxy: storage } = createProxy({
    replacedUserId: "",
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
let currentReplacedUserId: string | null = null;
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
    if (!hasSpoofed || !storage.copySpoofedId || !currentReplacedUserId) return text;
    const targetId = storage.targetUserId;
    if (targetId && typeof text === "string" && text.includes(currentReplacedUserId)) {
        return text.replaceAll(currentReplacedUserId, targetId);
    }
    return text;
}

export function enforceSpoof() {
    if (!hasSpoofed || isEnforcing || !currentReplacedUserId) return;
    const targetId = storage.targetUserId;
    const replacedUser: any = getUser(currentReplacedUserId);
    const targetUser: any = getUser(targetId);

    if (replacedUser && targetUser) {
        let changed = false;
        isEnforcing = true;

        try {
            const UserProfileStore = getUserProfileStore();
            for (const prop of visualProps) {
                if (prop === "publicFlags") {
                    const expectedFlags = storage.hideBadges ? 0 : targetUser.publicFlags;
                    if (replacedUser.publicFlags !== expectedFlags) {
                        replacedUser.publicFlags = expectedFlags;
                        changed = true;
                    }
                } else if (prop === "bio") {
                    const targetProfile = UserProfileStore?.getUserProfile?.(targetId);
                    const targetBio = targetProfile?.bio ?? targetUser.bio;
                    if (targetBio !== undefined && replacedUser.bio !== targetBio) {
                        replacedUser.bio = targetBio;
                        changed = true;
                    }
                } else {
                    if (replacedUser[prop] !== targetUser[prop]) {
                        replacedUser[prop] = targetUser[prop];
                        changed = true;
                    }
                }
            }

            if (boundGetAvatarURL && replacedUser.getAvatarURL !== boundGetAvatarURL) {
                replacedUser.getAvatarURL = boundGetAvatarURL;
                changed = true;
            }
            if (boundGetBannerURL && replacedUser.getBannerURL !== boundGetBannerURL) {
                replacedUser.getBannerURL = boundGetBannerURL;
                changed = true;
            }
        } finally {
            isEnforcing = false;
        }

        if (changed && FluxDispatcher?.dispatch) {
            setTimeout(() => {
                FluxDispatcher.dispatch({ type: "USER_UPDATE", user: replacedUser });
            }, 0);
        }
    }
}

export async function spoofUser() {
    const replacedId = storage.replacedUserId;
    const targetId = storage.targetUserId;

    if (!replacedId || !targetId) {
        showToast("[ReplaceUserLocallyMobile] Vui lòng nhập Replaced User ID và Target User ID");
        return;
    }

    try {
        const UserUtils = getUserUtils();
        const ProfileActions = getProfileActions();

        if (UserUtils?.getUser) {
            try { await UserUtils.getUser(replacedId); } catch (_) {}
            try { await UserUtils.getUser(targetId); } catch (_) {}
        }
        if (ProfileActions?.fetchProfile) {
            try { await ProfileActions.fetchProfile(replacedId, { guildId: undefined, withMutualGuilds: false }); } catch (_) {}
            try { await ProfileActions.fetchProfile(targetId, { guildId: undefined, withMutualGuilds: false }); } catch (_) {}
        }

        const replacedUser: any = getUser(replacedId);
        const targetUser: any = getUser(targetId);

        if (!replacedUser || !targetUser) {
            showToast("[ReplaceUserLocallyMobile] Không thể lấy dữ liệu một trong hai User ID.");
            return;
        }

        if (hasSpoofed && currentReplacedUserId && currentReplacedUserId !== replacedId) {
            restoreOriginalUser();
        }

        if (!hasSpoofed) {
            for (const prop of visualProps) {
                originalUserProps[prop] = replacedUser[prop];
            }
            originalUserProps.getAvatarURL = replacedUser.getAvatarURL;
            originalUserProps.getBannerURL = replacedUser.getBannerURL;
        }

        currentReplacedUserId = replacedId;

        const UserProfileStore = getUserProfileStore();
        for (const prop of visualProps) {
            if (prop === "publicFlags") {
                replacedUser.publicFlags = storage.hideBadges ? 0 : targetUser.publicFlags;
            } else if (prop === "bio") {
                const targetProfile = UserProfileStore?.getUserProfile?.(targetId);
                replacedUser.bio = targetProfile?.bio ?? targetUser.bio;
            } else {
                replacedUser[prop] = targetUser[prop];
            }
        }

        if (typeof targetUser.getAvatarURL === "function") {
            boundGetAvatarURL = targetUser.getAvatarURL.bind(targetUser);
            replacedUser.getAvatarURL = boundGetAvatarURL;
        }
        if (typeof targetUser.getBannerURL === "function") {
            boundGetBannerURL = targetUser.getBannerURL.bind(targetUser);
            replacedUser.getBannerURL = boundGetBannerURL;
        }

        hasSpoofed = true;
        enforceSpoof();

        if (FluxDispatcher?.dispatch) {
            FluxDispatcher.dispatch({ type: "USER_UPDATE", user: replacedUser });
        }

        showToast("[ReplaceUserLocallyMobile] Đã thay thế người dùng thành công!");
    } catch (e) {
        console.error("[ReplaceUserLocallyMobile] Lỗi:", e);
        showToast("[ReplaceUserLocallyMobile] Có lỗi xảy ra trong quá trình thay thế");
    }
}

export function restoreOriginalUser() {
    if (!hasSpoofed || !currentReplacedUserId) return;
    try {
        const replacedUser: any = getUser(currentReplacedUserId);
        if (replacedUser) {
            for (const prop of Object.keys(originalUserProps)) {
                try { replacedUser[prop] = originalUserProps[prop]; } catch (_) {}
            }
            try { delete replacedUser.getAvatarURL; } catch (_) {}
            try { delete replacedUser.getBannerURL; } catch (_) {}

            if (FluxDispatcher?.dispatch) {
                try { FluxDispatcher.dispatch({ type: "USER_UPDATE", user: replacedUser }); } catch (_) {}
            }
        }
    } catch (e) {
        console.error("[ReplaceUserLocallyMobile] Error restoring original user:", e);
    }
    hasSpoofed = false;
    currentReplacedUserId = null;
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
                if (hasSpoofed && currentReplacedUserId && id === currentReplacedUserId && storage.customJoinedDiscord) {
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
                if (hasSpoofed && currentReplacedUserId && userId === currentReplacedUserId && member && storage.customJoinedServer) {
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
                if (hasSpoofed && currentReplacedUserId && userId === currentReplacedUserId && storage.customFriendsSince) {
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
                    if (hasSpoofed && currentReplacedUserId && userId === currentReplacedUserId) {
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
                    if (hasSpoofed && currentReplacedUserId && userId === currentReplacedUserId) {
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

    if (storage.replacedUserId && storage.targetUserId) {
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
