using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Schemas;

public class SearchMessagesResponse {
    /// <summary>This page of results, newest first.</summary>
    public List<Message> Messages { get; set; } = [];
    /// <summary>Whether there are older results; ask for them with <c>before</c> set to the last message's ID.</summary>
    public bool HasMore { get; set; }
    /// <summary>How many results there are in all. Only filled in on the first page (no <c>before</c>).</summary>
    public int? TotalCount { get; set; }
}

public static class SearchLimits {
    public const int QueryMaxLength = 200;
    public const int MaxTerms = 10;
    public const int PageMax = 50;
}
