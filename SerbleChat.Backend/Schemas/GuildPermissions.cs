using Microsoft.EntityFrameworkCore;

namespace SerbleChat.Backend.Schemas;

[Owned]
public record GuildPermissions(
    PermissionState Administrator = PermissionState.Inherit,
    PermissionState ManageGuild = PermissionState.Inherit,
    PermissionState ManageRoles = PermissionState.Inherit,
    PermissionState ManageChannels = PermissionState.Inherit,
    PermissionState KickMembers = PermissionState.Inherit,
    PermissionState BanMembers = PermissionState.Inherit,
    PermissionState CreateInvites = PermissionState.Inherit,
    PermissionState SendMessages = PermissionState.Inherit,
    PermissionState ManageMessages = PermissionState.Inherit,
    PermissionState JoinVoice = PermissionState.Inherit,
    PermissionState Speak = PermissionState.Inherit,
    PermissionState MuteMembers = PermissionState.Inherit,
    PermissionState DeafenMembers = PermissionState.Inherit,
    PermissionState MoveMembers = PermissionState.Inherit,
    PermissionState VideoStream = PermissionState.Inherit
) {
    public static readonly GuildPermissions Default = new() {
        Administrator = PermissionState.Deny,
        ManageGuild = PermissionState.Deny,
        ManageChannels = PermissionState.Deny,
        ManageRoles = PermissionState.Deny,
        KickMembers = PermissionState.Deny,
        BanMembers = PermissionState.Deny,
        CreateInvites = PermissionState.Allow,
        SendMessages = PermissionState.Allow,
        ManageMessages = PermissionState.Deny,
        JoinVoice = PermissionState.Allow,
        Speak = PermissionState.Allow,
        MuteMembers = PermissionState.Deny,
        DeafenMembers = PermissionState.Deny,
        MoveMembers = PermissionState.Deny,
        VideoStream = PermissionState.Allow
    };

    /// <summary>All permissions granted — returned for guild owners.</summary>
    public static readonly GuildPermissions OwnerPermissions = new(
        Administrator: PermissionState.Allow,
        ManageGuild: PermissionState.Allow,
        ManageRoles: PermissionState.Allow,
        ManageChannels: PermissionState.Allow,
        KickMembers: PermissionState.Allow,
        BanMembers: PermissionState.Allow,
        CreateInvites: PermissionState.Allow,
        SendMessages: PermissionState.Allow,
        ManageMessages: PermissionState.Allow,
        JoinVoice: PermissionState.Allow,
        Speak: PermissionState.Allow,
        MuteMembers: PermissionState.Allow,
        DeafenMembers: PermissionState.Allow,
        MoveMembers: PermissionState.Allow,
        VideoStream: PermissionState.Allow
    );

    public GuildPermissions ApplyOverrides(GuildPermissions? overrides) {
        if (overrides == null) return this;
        return new GuildPermissions(
            Administrator:    overrides.Administrator    != PermissionState.Inherit ? overrides.Administrator    : Administrator,
            ManageGuild:      overrides.ManageGuild      != PermissionState.Inherit ? overrides.ManageGuild      : ManageGuild,
            ManageRoles:      overrides.ManageRoles      != PermissionState.Inherit ? overrides.ManageRoles      : ManageRoles,
            ManageChannels:   overrides.ManageChannels   != PermissionState.Inherit ? overrides.ManageChannels   : ManageChannels,
            KickMembers:      overrides.KickMembers      != PermissionState.Inherit ? overrides.KickMembers      : KickMembers,
            BanMembers:       overrides.BanMembers       != PermissionState.Inherit ? overrides.BanMembers       : BanMembers,
            CreateInvites:    overrides.CreateInvites    != PermissionState.Inherit ? overrides.CreateInvites    : CreateInvites,
            SendMessages:     overrides.SendMessages     != PermissionState.Inherit ? overrides.SendMessages     : SendMessages,
            ManageMessages:   overrides.ManageMessages   != PermissionState.Inherit ? overrides.ManageMessages   : ManageMessages,
            JoinVoice:        overrides.JoinVoice        != PermissionState.Inherit ? overrides.JoinVoice        : JoinVoice,
            Speak:            overrides.Speak            != PermissionState.Inherit ? overrides.Speak            : Speak,
            MuteMembers:      overrides.MuteMembers      != PermissionState.Inherit ? overrides.MuteMembers      : MuteMembers,
            DeafenMembers:    overrides.DeafenMembers    != PermissionState.Inherit ? overrides.DeafenMembers    : DeafenMembers,
            MoveMembers:      overrides.MoveMembers      != PermissionState.Inherit ? overrides.MoveMembers      : MoveMembers,
            VideoStream:      overrides.VideoStream      != PermissionState.Inherit ? overrides.VideoStream      : VideoStream
        );
    }
}

public enum PermissionState {
    Allow,
    Deny,
    Inherit
}

public static class PermissionStateExtensions {
    public static bool ToBool(this PermissionState state) {
        return state switch {
            PermissionState.Allow => true,
            PermissionState.Deny  => false,
            _ => false  // Inherit treated as Deny when no further resolution is possible
        };
    }
}