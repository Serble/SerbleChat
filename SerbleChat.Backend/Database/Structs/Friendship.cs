using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace SerbleChat.Backend.Database.Structs;

public class Friendship {
    [Key]
    public int Id { get; set; }
    
    public DateTime CreatedAt { get; set; }
    
    /// <summary>
    /// The user that initiated the friend request.
    /// </summary>
    [ForeignKey(nameof(User1Navigation))]
    [StringLength(64)]
    public string User1Id { get; set; } = null!;
    
    /// <summary>
    /// The user that received the friend request.
    /// </summary>
    [ForeignKey(nameof(User2Navigation))]
    [StringLength(64)]
    public string User2Id { get; set; } = null!;
    
    /// <summary>
    /// Whether the friend request is still pending. If false, the users are friends.
    /// If true, the users are not friends and the request is still pending.
    /// </summary>
    public bool Pending { get; set; }
    
    // Navigation Properties
    [JsonIgnore]
    public ChatUser User1Navigation { get; set; } = null!;
    [JsonIgnore]
    public ChatUser User2Navigation { get; set; } = null!;
}
