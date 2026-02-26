using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Database.Structs;

public class ChannelPermissionOverride {
    [Key]
    public long Id { get; set; }
    
    [ForeignKey(nameof(ChannelNavigation))]
    public long ChannelId { get; set; }
    
    [ForeignKey(nameof(UserNavigation))]
    [StringLength(64)]
    public string? UserId { get; set; }
    
    [ForeignKey(nameof(RoleNavigation))]
    public long? RoleId { get; set; }

    public GuildPermissions Permissions { get; set; } = null!;
    
    // Navigation Properties
    [JsonIgnore]
    public Channel ChannelNavigation { get; set; } = null!;
    [JsonIgnore]
    public ChatUser? UserNavigation { get; set; }
    [JsonIgnore]
    public Role? RoleNavigation { get; set; }
}
