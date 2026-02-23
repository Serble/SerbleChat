namespace SerbleChat.Backend.Schemas;

public class ChannelPermissionOverrideCreateRequest {
    public string? UserId { get; set; }
    public int? RoleId { get; set; }
    public GuildPermissions Permissions { get; set; } = GuildPermissions.Inherit;
}
