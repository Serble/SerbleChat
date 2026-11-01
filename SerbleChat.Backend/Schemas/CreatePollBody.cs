namespace SerbleChat.Backend.Schemas;

public class CreatePollBody {
    public string Question { get; set; } = null!;
    public List<string> Options { get; set; } = [];
    public bool AllowMultiple { get; set; }

    /// <summary>How long voting stays open, in seconds. Null means until someone ends it.</summary>
    public long? DurationSeconds { get; set; }
}
