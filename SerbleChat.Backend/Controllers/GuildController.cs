using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.SocketHubs;

namespace SerbleChat.Backend.Controllers;

[ApiController]
[Route("guild")]
[Authorize]
public class GuildController(IGuildRepo guilds, IChannelRepo channels, IHubContext<ChatHub> updates) : ControllerBase {

    [HttpGet]
    public async Task<ActionResult<Guild[]>> GetMyGuilds() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        return await guilds.GetGuildsForUser(userId);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Guild>> GetGuildById(int id) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        Guild? guild = await guilds.GetGuild(id);
        if (guild == null) return NotFound("Guild not found");
        return Ok(guild);
    }

    [HttpPost]
    public async Task<ActionResult<Guild>> CreateGuild(GuildCreateRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        if (string.IsNullOrEmpty(request.Name)) {
            return BadRequest("Guild name cannot be empty");
        }

        Guild guild = new() {
            Name = request.Name,
            OwnerId = userId
        };
        await guilds.CreateGuild(guild);

        // Add creator as a member so they can access channels
        await guilds.AddGuildMember(guild.Id, userId);

        // now make an example channel
        Channel channel = new() {
            CreatedAt = DateTime.UtcNow,
            Name = "Fluffy Unicorn Discussion",
            Type = ChannelType.Guild,
            GuildId = guild.Id,
            VoiceCapable = false
        };
        await channels.CreateChannel(channel);
        
        GuildChannel guildChannel = new() {
            GuildId = guild.Id,
            Index = 0,
            ChannelId = channel.Id,
        };
        await guilds.CreateGuildChannel(guildChannel);
        
        return Ok(guild);
    }

    [HttpDelete("{id:int}")]
    public async Task<ActionResult> DeleteGuild(int id) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(id);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        if (guild.OwnerId != userId) {
            return Forbid();
        }
        
        await guilds.DeleteGuild(id);
        return Ok();
    }

    [HttpPatch("{id:int}")]
    public async Task<ActionResult> UpdateGuild(int id, GuildUpdateRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(id);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        if (guild.OwnerId != userId) {
            return Forbid();
        }
        
        if (!string.IsNullOrEmpty(request.Name)) {
            guild.Name = request.Name;
        }
        
        await guilds.UpdateGuild(guild);
        return Ok();
    }

    // CHANNEL ENDPOINTS

    [HttpGet("{guildId:int}/channel")]
    public async Task<ActionResult<Channel[]>> GetChannels(int guildId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        return await guilds.GetGuildChannelsAsChannels(guildId);
    }

    [HttpPost("{guildId:int}/channel")]
    public async Task<ActionResult<Channel>> CreateChannel(int guildId, GuildChannelCreateRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        // TODO: Permissions
        
        Channel channel = new() {
            CreatedAt = DateTime.UtcNow,
            Name = request.Name,
            Type = ChannelType.Guild,
            GuildId = guild.Id,
            VoiceCapable = request.VoiceCapable
        };
        await channels.CreateChannel(channel);

        int channelCount = (await guilds.GetGuildChannels(guild.Id)).Length;
        GuildChannel guildChannel = new() {
            GuildId = guild.Id,
            Index = channelCount,
            ChannelId = channel.Id,
        };
        await guilds.CreateGuildChannel(guildChannel);
        
        string[] memberIds = (await guilds.GetGuildChannelMembers(guildChannel.ChannelId)).Select(m => m.Id)
            .ToArray();
        await updates.Clients.Users(memberIds).SendAsync("NewChannel", channel);
        
        return Ok(channel);
    }

    [HttpDelete("{guildId:int}/channel/{channelId:int}")]
    public async Task<ActionResult> DeleteChannel(int guildId, int channelId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        GuildChannel? guildChannel = await guilds.GetGuildChannel(channelId);
        if (guildChannel == null || guildChannel.GuildId != guildId) {
            return NotFound("Channel not found in this guild");
        }
        
        // TODO: Permissions
        
        await channels.DeleteChannel(channelId);
        await guilds.DeleteGuildChannel(channelId);
        
        await updates.Clients.Group($"channel-{channelId}").SendAsync("ChannelDeleted", new {
            ChannelId = channelId
        });
        
        return Ok();
    }

    [HttpPatch("{guildId:int}/channel/{channelId:int}")]
    public async Task<ActionResult> UpdateChannel(int guildId, int channelId, GuildChannelUpdateRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        GuildChannel? guildChannel = await guilds.GetGuildChannel(channelId);
        if (guildChannel == null || guildChannel.GuildId != guildId) {
            return NotFound("Channel not found in this guild");
        }

        Channel channel = guildChannel.ChannelNavigation;
        if (!string.IsNullOrEmpty(request.Name)) {
            channel.Name = request.Name;
        }

        if (request.VoiceCapable.HasValue) {
            channel.VoiceCapable = request.VoiceCapable.Value;
        }
        
        await channels.UpdateChannel(channel);
        return Ok();
    }
    
    // INVITES

    [HttpPost("{guildId:int}/invite")]
    public async Task<ActionResult<GuildInvite>> CreateInvite(int guildId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        GuildInvite invite = new() {
            GuildId = guildId,
        };
        await guilds.CreateInvite(invite);
        return Ok(invite);
    }
    
    [HttpDelete("invite/{inviteId:int}")]
    public async Task<ActionResult> DeleteInvite(int inviteId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        GuildInvite? invite = await guilds.GetInvite(inviteId);
        if (invite == null) {
            return NotFound("Invite not found");
        }
        
        Guild? guild = await guilds.GetGuild(invite.GuildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        if (guild.OwnerId != userId) {
            return Forbid();
        }
        
        await guilds.DeleteInvite(inviteId);
        return Ok();
    }
    
    [HttpGet("{guildId:int}/invite")]
    public async Task<ActionResult<GuildInvite[]>> GetInvites(int guildId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        if (guild.OwnerId != userId) {
            return Forbid();
        }
        
        GuildInvite[] invites = await guilds.GetGuildInvites(guildId);
        return Ok(invites);
    }

    [HttpPost("invite/{inviteId:int}/accept")]
    public async Task<ActionResult<Guild>> AcceptInvite(int inviteId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        GuildInvite? invite = await guilds.GetInvite(inviteId);
        if (invite == null) {
            return NotFound("Invite not found");
        }
        
        Guild? guild = await guilds.GetGuild(invite.GuildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        if (await guilds.IsGuildMember(invite.GuildId, userId)) {
            return BadRequest("Already a member of this guild");
        }
        
        await guilds.AddGuildMember(guild.Id, userId);
        return Ok(guild);
    }
}
