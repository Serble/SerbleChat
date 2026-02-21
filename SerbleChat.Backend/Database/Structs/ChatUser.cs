using System.ComponentModel.DataAnnotations;

namespace SerbleChat.Backend.Database.Structs;

public class ChatUser {
    [Key]
    public int Id { get; set; }

    [StringLength(255)]
    public string Username { get; set; } = null!;
    
    public string RefreshToken { get; set; } = null!;
    
    public bool IsAdmin { get; set; }
    
    public bool IsBanned { get; set; }
}
