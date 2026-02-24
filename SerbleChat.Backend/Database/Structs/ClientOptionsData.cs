using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SerbleChat.Backend.Database.Structs;

public class ClientOptionsData {
    [Key, StringLength(64), ForeignKey(nameof(UserNavigation))]
    public string UserId { get; set; } = null!;
    
    public string OptionsJson { get; set; } = "{}";
    
    // Navigation Properties
    public ChatUser UserNavigation { get; set; } = null!;
}
