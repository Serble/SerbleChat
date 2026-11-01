namespace SerbleChat.Backend.Schemas;

public class UsersInVoiceResponse {
    public List<string> Users { get; set; } = null!;

    // Mute/deafen state of each user in Users. A separate list (not a dictionary)
    // so the camelCase dictionary key policy doesn't mangle user IDs, and so older
    // clients that only read Users keep working.
    public List<VoiceStateResponse> States { get; set; } = null!;
}

public class VoiceStateResponse {
    public string UserId { get; set; } = null!;
    public bool Muted { get; set; }
    public bool Deafened { get; set; }
}
