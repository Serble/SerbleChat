using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Database.Structs;

public class Role {
    [Key]
    public long Id { get; set; }
    
    [ForeignKey(nameof(GuildNavigation))]
    public long GuildId { get; set; }
    
    /// <summary>
    /// The position of the role in the role hierarchy. Higher numbers mean higher roles.
    /// This is used to determine role permissions and display order.
    /// </summary>
    public int Priority { get; set; }

    /// <summary>
    /// The role colour in hex format, e.g. #FF0000 for red.
    /// Empty string to inherit the default colour.
    /// </summary>
    [StringLength(7)]
    public string Color { get; set; } = "";
    
    [StringLength(64)]
    public string Name { get; set; } = null!;
    
    public bool DisplaySeparately { get; set; }
    
    public bool Mentionable { get; set; }
    
    public GuildPermissions Permissions { get; set; } = null!;
    
    // Navigation Properties
    [JsonIgnore]
    public Guild GuildNavigation { get; set; } = null!;
}
