namespace SerbleChat.Backend.Schemas;

public enum CrossAppCodeOutcome {
    /// <summary>A code for the target app is in <see cref="CrossAppCodeResult.Code"/>.</summary>
    Issued,
    /// <summary>The user has to approve the pair on the Serble website first.</summary>
    ConsentRequired,
    /// <summary>The target refuses this app, or the user may not use one of the apps.</summary>
    Denied,
    /// <summary>The user's Serble grant to this app is gone: they need to sign in again.</summary>
    ReauthRequired,
    /// <summary>Serble couldn't be reached or answered unexpectedly. Worth retrying later.</summary>
    Failed
}

public record CrossAppCodeResult(CrossAppCodeOutcome Outcome, string? Code = null, string? ConsentUrl = null,
    string? Error = null);
