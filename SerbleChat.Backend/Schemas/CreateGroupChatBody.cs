namespace SerbleChat.Backend.Schemas;

public class CreateGroupChatBody {
    public string Name { get; set; } = null!;
    public List<string> Users { get; set; } = null!;
}