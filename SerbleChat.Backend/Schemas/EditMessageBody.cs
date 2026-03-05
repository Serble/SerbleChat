using System.ComponentModel.DataAnnotations;

namespace SerbleChat.Backend.Schemas;

public class EditMessageBody {
    [MaxLength(16384)]
    public string? Content { get; set; }
}
