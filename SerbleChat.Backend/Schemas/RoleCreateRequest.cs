namespace SerbleChat.Backend.Schemas;

public class RoleCreateRequest {
    public string Name { get; set; } = null!;
    public string? Color { get; set; } = "#000000";
    public bool DisplaySeparately { get; set; } = false;
    public bool Mentionable { get; set; } = true;
    public GuildPermissions? Permissions { get; set; } = null;
}
