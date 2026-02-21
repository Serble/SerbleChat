using System.ComponentModel.DataAnnotations;

namespace SerbleChat.Backend.Database.Structs;

public class ChatUser {
    [Key]
    [StringLength(64)]
    public string Id { get; set; } = null!;

    [StringLength(255)]
    public string Username { get; set; } = null!;
    
    public DateTime CreatedAt { get; set; }
    
    public string RefreshToken { get; set; } = null!;
    
    public bool IsAdmin { get; set; }
    
    public bool IsBanned { get; set; }
}
