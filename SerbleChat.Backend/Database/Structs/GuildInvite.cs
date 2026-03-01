using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace SerbleChat.Backend.Database.Structs;

public class GuildInvite {
    [Key, StringLength(12)]
    public string Id { get; set; } = null!;
    
    [ForeignKey(nameof(GuildNavigation))]
    public long GuildId { get; set; }
    
    // Navigation Properties
    [JsonPropertyName("guild")]
    public Guild GuildNavigation { get; set; } = null!;
}

public class GuildInviteNoGuild(GuildInvite invite) {
    public string Id { get; set; } = invite.Id;
    public long GuildId { get; set; } = invite.GuildId;
}
