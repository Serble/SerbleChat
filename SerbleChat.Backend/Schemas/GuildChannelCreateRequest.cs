namespace SerbleChat.Backend.Schemas;

public class GuildChannelCreateRequest {
    public string Name { get; set; } = null!;
    public bool VoiceCapable { get; set; }
}
