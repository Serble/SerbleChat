using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Database.Structs;

public class Guild {
    [Key]
    public long Id { get; set; }
    
    [StringLength(64)]
    public string Name { get; set; } = null!;
    
    public DateTime CreatedAt { get; set; }

    [ForeignKey(nameof(OwnerNavigation))]
    [StringLength(64)]
    public string OwnerId { get; set; } = null!;
    
    public GuildPermissions DefaultPermissions { get; set; } = null!;
    
    // Navigation Properties
    [JsonIgnore]
    public ChatUser OwnerNavigation { get; set; } = null!;
}