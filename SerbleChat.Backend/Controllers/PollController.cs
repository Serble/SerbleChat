using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.Services;
using SerbleChat.Backend.SocketHubs;

namespace SerbleChat.Backend.Controllers;

/// <summary>
/// Polls live on messages: creating one posts a message, and deleting the message deletes the poll.
/// Votes are public and every change is broadcast to the channel as <c>PollUpdated</c>.
/// </summary>
[ApiController]
[Route("channel/{channelId:long}")]
[Authorize]
public class PollController(IChannelRepo channels, IGuildRepo guilds, IPollRepo polls,
    IHubContext<ChatHub> updates, IMessageSender sender) : ControllerBase {

    [HttpPost("poll")]
    public async Task<ActionResult<Message>> CreatePoll(long channelId, [FromBody] CreatePollBody body) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        Channel? channel = await channels.GetChannel(channelId);
        if (channel == null) {
            return NotFound("Channel not found");
        }

        // Needs both Send Messages and Create Polls in guild channels
        if (!await channels.UserHasAccessToChannel(userId, channel, true, guildPermission: p => p.CreatePolls)) {
            return Forbid();
        }

        string question = body.Question?.Trim() ?? "";
        if (question.Length == 0 || question.Length > PollLimits.QuestionMaxLength) {
            return BadRequest($"Question must be 1 to {PollLimits.QuestionMaxLength} characters");
        }

        List<string> options = (body.Options ?? []).Select(o => o?.Trim() ?? "").ToList();
        if (options.Count < PollLimits.MinOptions || options.Count > PollLimits.MaxOptions) {
            return BadRequest($"A poll needs {PollLimits.MinOptions} to {PollLimits.MaxOptions} options");
        }
        if (options.Any(o => o.Length == 0 || o.Length > PollLimits.OptionMaxLength)) {
            return BadRequest($"Options must be 1 to {PollLimits.OptionMaxLength} characters");
        }

        DateTime now = DateTime.UtcNow;
        DateTime? expiresAt = null;
        if (body.DurationSeconds != null) {
            TimeSpan duration = TimeSpan.FromSeconds(body.DurationSeconds.Value);
            if (duration < PollLimits.MinDuration || duration > PollLimits.MaxDuration) {
                return BadRequest("Duration must be between 1 minute and 30 days");
            }
            expiresAt = now + duration;
        }

        Message msg = new() {
            AuthorId = userId,
            ChannelId = channel.Id,
            // Shown by push notifications and anything that doesn't understand polls
            Content = "📊 Poll: " + question,
            CreatedAt = now
        };
        Poll poll = new() {
            ChannelId = channel.Id,
            AuthorId = userId,
            Question = question,
            AllowMultiple = body.AllowMultiple,
            CreatedAt = now,
            ExpiresAt = expiresAt,
            Options = options.Select((text, i) => new PollOption { Index = i, Text = text }).ToList()
        };
        await polls.CreatePoll(msg, poll);

        msg.Poll = PollResponse.FromPoll(poll);
        await sender.Deliver(channel, msg, parseMentions: false);
        return Ok(msg);
    }

    /// <summary>Polls in this channel that are still taking votes, newest first.</summary>
    [HttpGet("polls/active")]
    public async Task<ActionResult<IEnumerable<PollResponse>>> GetActivePolls(long channelId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        Channel? channel = await channels.GetChannel(channelId);
        if (channel == null) {
            return NotFound("Channel not found");
        }
        if (!await channels.UserHasAccessToChannel(userId, channel, false)) {
            return Forbid();
        }

        List<Poll> active = await polls.GetActivePolls(channelId, DateTime.UtcNow);
        return Ok(active.Select(PollResponse.FromPoll));
    }

    /// <summary>Set the caller's choices, replacing any earlier vote. An empty list removes it.</summary>
    [HttpPut("poll/{pollId:long}/vote")]
    public async Task<ActionResult<PollResponse>> Vote(long channelId, long pollId, [FromBody] PollVoteBody body) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        Channel? channel = await channels.GetChannel(channelId);
        if (channel == null) {
            return NotFound("Channel not found");
        }
        // Anyone who can read the channel can vote, so polls work in read-only channels too
        if (!await channels.UserHasAccessToChannel(userId, channel, false)) {
            return Forbid();
        }

        Poll? poll = await polls.GetPoll(pollId);
        if (poll == null || poll.ChannelId != channelId) {
            return NotFound("Poll not found");
        }
        if (poll.IsEnded(DateTime.UtcNow)) {
            return BadRequest("This poll has ended");
        }

        List<long> optionIds = (body.OptionIds ?? []).Distinct().ToList();
        if (!poll.AllowMultiple && optionIds.Count > 1) {
            return BadRequest("This poll only allows one choice");
        }
        HashSet<long> validIds = poll.Options.Select(o => o.Id).ToHashSet();
        if (optionIds.Any(id => !validIds.Contains(id))) {
            return BadRequest("Unknown option");
        }

        try {
            await polls.SetVotes(pollId, userId, optionIds);
        }
        catch (DbUpdateException) {
            // Two votes from the same user raced; the other one won
            return Conflict("Vote changed at the same time, try again");
        }

        return Ok(await BroadcastPoll(pollId));
    }

    /// <summary>End voting now. The poll's author can always do this; in guilds so can message managers.</summary>
    [HttpPost("poll/{pollId:long}/close")]
    public async Task<ActionResult<PollResponse>> ClosePoll(long channelId, long pollId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        Poll? poll = await polls.GetPoll(pollId);
        if (poll == null || poll.ChannelId != channelId) {
            return NotFound("Poll not found");
        }

        if (poll.AuthorId != userId) {
            GuildChannel? guildChannel = await guilds.GetGuildChannel(channelId);
            if (guildChannel == null) {
                return Forbid();  // outside guilds only the author can end it
            }
            GuildPermissions perms = await guilds.GetUserPermissions(userId, guildChannel.GuildId, channelId);
            if (!perms.HasPerm(p => p.ManageMessages)) {
                return Forbid();
            }
        }

        if (!poll.IsEnded(DateTime.UtcNow)) {
            await polls.ClosePoll(pollId, DateTime.UtcNow);
        }

        return Ok(await BroadcastPoll(pollId));
    }

    private async Task<PollResponse?> BroadcastPoll(long pollId) {
        Poll? poll = await polls.GetPoll(pollId);
        if (poll == null) {
            return null;  // deleted meanwhile; DeleteMessage covers it
        }
        PollResponse response = PollResponse.FromPoll(poll);
        await updates.Clients.Group($"channel-{poll.ChannelId}").SendAsync("PollUpdated", response);
        return response;
    }
}
