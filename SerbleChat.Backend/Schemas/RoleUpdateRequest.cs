namespace SerbleChat.Backend.Schemas;

public class RoleUpdateRequest {
    public string? Name { get; set; }
    public string? Color { get; set; }
    public bool? DisplaySeparately { get; set; }
    public bool? Mentionable { get; set; }
    public GuildPermissions? Permissions { get; set; }
}
