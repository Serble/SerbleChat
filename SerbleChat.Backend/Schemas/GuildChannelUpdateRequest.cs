namespace SerbleChat.Backend.Schemas;

public class GuildChannelUpdateRequest {
    public string? Name { get; set; }
    public bool? VoiceCapable { get; set; }
}
