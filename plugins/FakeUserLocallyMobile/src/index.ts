import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher, clipboard } from "@vendetta/metro/common";
import { before, after, instead } from "@vendetta/patcher";
import { showToast } from "@vendetta/ui/toasts";
import { createProxy } from "@vendetta/storage";
import Settings from "./Settings";

declare const vendetta: any;

// Use persistent MMKV storage from Vendetta plugin scope, fallback to createProxy
export const storage: any = (typeof vendetta !== "undefined" && vendetta?.plugin?.storage)
    ? vendetta.plugin.storage
    : createProxy({
        targetUserId: "",
        customAvatarUrl: "",
        copySpoofedId: true,
        hideBadges: false,
        customJoinedDiscord: "",
        customJoinedServer: "",
        customFriendsSince: ""
    }).proxy;

// Set default values if not set yet
storage.targetUserId ??= "";
storage.customAvatarUrl ??= "";
storage.copySpoofedId ??= true;
storage.hideBadges ??= false;
storage.customJoinedDiscord ??= "";
storage.customJoinedServer ??= "";
storage.customFriendsSince ??= "";

// Cache for target user data fetched via REST API
const targetCache: Record<string, any> = {};

// Dynamic store and module resolvers with robust fallbacks
const getUserStore = () => findByStoreName("UserStore") || findByProps("getCurrentUser") || findByProps("getUser");
const getRelationshipStore = () => findByStoreName("RelationshipStore") || findByProps("getSince");
const getGuildMemberStore = () => findByStoreName("GuildMemberStore") || findByProps("getMember");
const getUserProfileStore = () => findByStoreName("UserProfileStore") || findByProps("getUserProfile");
const getSnowflakeUtils = () => findByProps("extractTimestamp");
const getUserUtils = () => findByProps("getUser", "fetchProfile") || findByProps("getUser");
const getProfileActions = () => findByProps("fetchProfile");
const getIconUtils = () => findByProps("getUserAvatarURL") || findByProps("getUserAvatarSource") || findByProps("getAvatarURL");
const getNameUtils = () => findByProps("getName") || findByProps("getGlobalName");
const getHTTP = () => findByProps("get", "post") || findByProps("getAPIBaseURL");

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
    if (store) {
        if (typeof store.getUser === "function") {
            const u = store.getUser(id);
            if (u) return u;
        }
        if (store._users && store._users[id]) return store._users[id];
        if (store.users && store.users[id]) return store.users[id];
    }
    return targetCache[id] || null;
}

export function buildAvatarUrl(user: any): string | null {
    if (storage.customAvatarUrl) {
        return storage.customAvatarUrl;
    }
    if (!user) return null;
    if (user.avatar) {
        const ext = user.avatar.startsWith("a_") ? "gif" : "png";
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=1024`;
    }
    try {
        const discriminator = user.discriminator && user.discriminator !== "0" ? Number(user.discriminator) : 0;
        const index = discriminator ? discriminator % 5 : Number(BigInt(user.id) >> 22n) % 5;
        return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    } catch (_) {
        return `https://cdn.discordapp.com/embed/avatars/0.png`;
    }
}

export function buildBannerUrl(user: any): string | null {
    if (!user) return null;
    if (user.banner) {
        const ext = user.banner.startsWith("a_") ? "gif" : "png";
        return `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.${ext}?size=1024`;
    }
    return null;
}

let unpatches: (() => void)[] = [];
let originalUserProps: Record<string, any> = {};
let hasSpoofed = false;
let isEnforcing = false;

const visualProps = [
    "username",
    "globalName",
    "global_name",
    "avatar",
    "avatarDecoration",
    "avatarDecorationData",
    "discriminator",
    "banner",
    "bio",
    "publicFlags",
    "pronouns"
];

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
                } else if (prop === "global_name" || prop === "globalName") {
                    const targetName = targetUser.globalName || targetUser.global_name || targetUser.username;
                    if (targetName && realUser[prop] !== targetName) {
                        realUser[prop] = targetName;
                        changed = true;
                    }
                } else {
                    if (targetUser[prop] !== undefined && realUser[prop] !== targetUser[prop]) {
                        realUser[prop] = targetUser[prop];
                        changed = true;
                    }
                }
            }

            realUser.getGlobalName = () => {
                const tUser = getUser(targetId);
                return tUser?.globalName || tUser?.global_name || tUser?.username || originalUserProps.globalName;
            };

            realUser.getAvatarURL = (guildId?: string, size?: number, canAnimate?: boolean) => {
                const tUser = getUser(targetId);
                if (tUser || storage.customAvatarUrl) return buildAvatarUrl(tUser);
                return originalUserProps.getAvatarURL ? originalUserProps.getAvatarURL.call(realUser, guildId, size, canAnimate) : null;
            };

            realUser.getBannerURL = (guildId?: string, size?: number, canAnimate?: boolean) => {
                const tUser = getUser(targetId);
                if (tUser) return buildBannerUrl(tUser);
                return originalUserProps.getBannerURL ? originalUserProps.getBannerURL.call(realUser, guildId, size, canAnimate) : null;
            };
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

async function fetchUserData(id: string): Promise<any> {
    try {
        const UserUtils = getUserUtils();
        if (UserUtils?.getUser) {
            try { await UserUtils.getUser(id); } catch (_) {}
        }

        const ProfileActions = getProfileActions();
        if (ProfileActions?.fetchProfile) {
            try { await ProfileActions.fetchProfile(id, { guildId: undefined, withMutualGuilds: false }); } catch (_) {}
        }

        let user = getUser(id);
        if (user && (user.avatar || user.globalName || user.global_name)) return user;

        const HTTP = getHTTP();
        if (HTTP?.get) {
            const res = await HTTP.get({ url: `/users/${id}` });
            const body = res?.body || res;
            if (body && body.id) {
                targetCache[id] = {
                    id: body.id,
                    username: body.username,
                    globalName: body.global_name || body.username,
                    global_name: body.global_name || body.username,
                    avatar: body.avatar,
                    avatarDecoration: body.avatar_decoration_data?.asset,
                    avatarDecorationData: body.avatar_decoration_data,
                    discriminator: body.discriminator || "0",
                    banner: body.banner,
                    bio: body.bio || "",
                    publicFlags: body.public_flags || 0,
                    pronouns: body.pronouns || ""
                };
                return targetCache[id];
            }
        }
    } catch (e) {
        console.error("[FakeUserLocallyMobile] Error fetching user data via REST:", e);
    }

    return getUser(id);
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
        showToast("[FakeUserLocallyMobile] Đang tải dữ liệu người dùng...");
        const targetUser: any = await fetchUserData(targetId);

        if (!targetUser && !storage.customAvatarUrl) {
            showToast("[FakeUserLocallyMobile] Lỗi: Không thể lấy dữ liệu mục tiêu. Kiểm tra lại ID!");
            return;
        }

        if (!hasSpoofed) {
            for (const prop of visualProps) {
                originalUserProps[prop] = realUser[prop];
            }
            originalUserProps.getAvatarURL = realUser.getAvatarURL;
            originalUserProps.getBannerURL = realUser.getBannerURL;
            originalUserProps.getGlobalName = realUser.getGlobalName;
        }

        const UserProfileStore = getUserProfileStore();
        if (targetUser) {
            for (const prop of visualProps) {
                if (prop === "publicFlags") {
                    realUser.publicFlags = storage.hideBadges ? 0 : targetUser.publicFlags;
                } else if (prop === "bio") {
                    const targetProfile = UserProfileStore?.getUserProfile?.(targetId);
                    realUser.bio = targetProfile?.bio ?? targetUser.bio;
                } else if (prop === "global_name" || prop === "globalName") {
                    const targetName = targetUser.globalName || targetUser.global_name || targetUser.username;
                    if (targetName) realUser[prop] = targetName;
                } else {
                    if (targetUser[prop] !== undefined) {
                        realUser[prop] = targetUser[prop];
                    }
                }
            }
        }

        realUser.getGlobalName = () => {
            const tUser = getUser(targetId);
            return tUser?.globalName || tUser?.global_name || tUser?.username || originalUserProps.globalName;
        };

        realUser.getAvatarURL = (guildId?: string, size?: number, canAnimate?: boolean) => {
            const tUser = getUser(targetId);
            if (tUser || storage.customAvatarUrl) return buildAvatarUrl(tUser);
            return originalUserProps.getAvatarURL ? originalUserProps.getAvatarURL.call(realUser, guildId, size, canAnimate) : null;
        };

        realUser.getBannerURL = (guildId?: string, size?: number, canAnimate?: boolean) => {
            const tUser = getUser(targetId);
            if (tUser) return buildBannerUrl(tUser);
            return originalUserProps.getBannerURL ? originalUserProps.getBannerURL.call(realUser, guildId, size, canAnimate) : null;
        };

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
            if (originalUserProps.getAvatarURL) realUser.getAvatarURL = originalUserProps.getAvatarURL;
            else try { delete realUser.getAvatarURL; } catch (_) {}

            if (originalUserProps.getBannerURL) realUser.getBannerURL = originalUserProps.getBannerURL;
            else try { delete realUser.getBannerURL; } catch (_) {}

            if (originalUserProps.getGlobalName) realUser.getGlobalName = originalUserProps.getGlobalName;
            else try { delete realUser.getGlobalName; } catch (_) {}

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

    const NameUtils = getNameUtils();
    if (NameUtils) {
        if (typeof NameUtils.getName === "function") {
            unpatches.push(
                instead("getName", NameUtils, (args, orig) => {
                    const [user] = args;
                    const realUser = getCurrentUser();
                    if (hasSpoofed && realUser && user && (user.id === realUser.id || user.id === storage.targetUserId)) {
                        const targetUser = getUser(storage.targetUserId);
                        if (targetUser) {
                            return targetUser.globalName || targetUser.global_name || targetUser.username;
                        }
                    }
                    return orig.apply(NameUtils, args);
                })
            );
        }
        if (typeof NameUtils.getGlobalName === "function") {
            unpatches.push(
                instead("getGlobalName", NameUtils, (args, orig) => {
                    const [user] = args;
                    const realUser = getCurrentUser();
                    if (hasSpoofed && realUser && user && (user.id === realUser.id || user.id === storage.targetUserId)) {
                        const targetUser = getUser(storage.targetUserId);
                        if (targetUser) {
                            return targetUser.globalName || targetUser.global_name || targetUser.username;
                        }
                    }
                    return orig.apply(NameUtils, args);
                })
            );
        }
    }

    const IconUtils = getIconUtils();
    if (IconUtils) {
        if (typeof IconUtils.getUserAvatarURL === "function") {
            unpatches.push(
                instead("getUserAvatarURL", IconUtils, (args, orig) => {
                    const [user] = args;
                    const realUser = getCurrentUser();
                    if (hasSpoofed && realUser && user && (user.id === realUser.id || user.id === storage.targetUserId)) {
                        const targetUser = getUser(storage.targetUserId);
                        if (targetUser || storage.customAvatarUrl) {
                            const url = buildAvatarUrl(targetUser);
                            if (url) return url;
                        }
                    }
                    return orig.apply(IconUtils, args);
                })
            );
        }

        if (typeof IconUtils.getUserAvatarSource === "function") {
            unpatches.push(
                instead("getUserAvatarSource", IconUtils, (args, orig) => {
                    const [user] = args;
                    const realUser = getCurrentUser();
                    if (hasSpoofed && realUser && user && (user.id === realUser.id || user.id === storage.targetUserId)) {
                        const targetUser = getUser(storage.targetUserId);
                        if (targetUser || storage.customAvatarUrl) {
                            const url = buildAvatarUrl(targetUser);
                            if (url) return { uri: url };
                        }
                    }
                    return orig.apply(IconUtils, args);
                })
            );
        }

        if (typeof IconUtils.getUserBannerURL === "function") {
            unpatches.push(
                instead("getUserBannerURL", IconUtils, (args, orig) => {
                    const [user] = args;
                    const realUser = getCurrentUser();
                    if (hasSpoofed && realUser && user && (user.id === realUser.id || user.id === storage.targetUserId)) {
                        const targetUser = getUser(storage.targetUserId);
                        if (targetUser) {
                            const url = buildBannerUrl(targetUser);
                            if (url) return url;
                        }
                    }
                    return orig.apply(IconUtils, args);
                })
            );
        }
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
    if (GuildMemberStore) {
        if (typeof GuildMemberStore.getMember === "function") {
            unpatches.push(
                after("getMember", GuildMemberStore, (args, member) => {
                    const [, userId] = args;
                    const realUser: any = getCurrentUser();
                    if (hasSpoofed && realUser && userId === realUser.id && member) {
                        const targetId = storage.targetUserId;
                        const targetUser = targetId ? getUser(targetId) : null;
                        const targetName = targetUser?.globalName || targetUser?.global_name || targetUser?.username;
                        const res = { ...member, user: realUser };
                        if (targetName) res.nick = targetName;
                        if (storage.customJoinedServer) {
                            const parsed = new Date(storage.customJoinedServer);
                            if (!isNaN(parsed.getTime())) res.joinedAt = parsed.toISOString();
                        }
                        return res;
                    }
                    return member;
                })
            );
        }

        if (typeof GuildMemberStore.getNick === "function") {
            unpatches.push(
                instead("getNick", GuildMemberStore, (args, orig) => {
                    const [, userId] = args;
                    const realUser: any = getCurrentUser();
                    if (hasSpoofed && realUser && userId === realUser.id) {
                        const targetId = storage.targetUserId;
                        const targetUser = targetId ? getUser(targetId) : null;
                        const targetName = targetUser?.globalName || targetUser?.global_name || targetUser?.username;
                        if (targetName) return targetName;
                    }
                    return orig.apply(GuildMemberStore, args);
                })
            );
        }
    }

    const RelationshipStore = getRelationshipStore();
    if (RelationshipStore) {
        if (typeof RelationshipStore.getSince === "function") {
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

        if (typeof RelationshipStore.getNickname === "function") {
            unpatches.push(
                instead("getNickname", RelationshipStore, (args, orig) => {
                    const [userId] = args;
                    const realUser: any = getCurrentUser();
                    if (hasSpoofed && realUser && userId === realUser.id) {
                        const targetId = storage.targetUserId;
                        const targetUser = targetId ? getUser(targetId) : null;
                        const targetName = targetUser?.globalName || targetUser?.global_name || targetUser?.username;
                        if (targetName) return targetName;
                    }
                    return orig.apply(RelationshipStore, args);
                })
            );
        }
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
        setTimeout(() => { spoofUser(); }, 500);
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
