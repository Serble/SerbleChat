namespace SerbleChat.Backend.Schemas;

public class PollVoteBody {
    /// <summary>The caller's full set of choices; replaces their previous vote. Empty removes it.</summary>
    public List<long> OptionIds { get; set; } = [];
}
