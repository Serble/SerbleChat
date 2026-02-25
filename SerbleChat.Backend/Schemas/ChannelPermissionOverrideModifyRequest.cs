namespace SerbleChat.Backend.Schemas;

public class ChannelPermissionOverrideModifyRequest {
    public GuildPermissions Permissions { get; set; } = null!;
}
