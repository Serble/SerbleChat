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
public class GuildController(IGuildRepo guilds, IChannelRepo channels, IRoleRepo roles, 
    IHubContext<ChatHub> updates) : ControllerBase {

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
            OwnerId = userId,
            CreatedAt = DateTime.UtcNow,
            DefaultPermissions = GuildPermissions.Default
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
        
        GuildPermissions perms = await roles.GetUserPermissionsInGuild(userId, id);
        if (!perms.Administrator.ToBool()) {
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
        
        GuildPermissions perms = await roles.GetUserPermissionsInGuild(userId, id);
        if (!(perms.Administrator.ToBool() || perms.ManageGuild.ToBool())) {
            return Forbid();
        }
        
        if (!string.IsNullOrEmpty(request.Name)) {
            guild.Name = request.Name;
        }

        if (request.DefaultPermissions != null) {
            guild.DefaultPermissions = request.DefaultPermissions;
        }
        
        await guilds.UpdateGuild(guild);
        return Ok();
    }

    [HttpGet("{id:int}/my-permissions")]
    public async Task<ActionResult<GuildPermissions>> GetMyPermissions(int id) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        Guild? guild = await guilds.GetGuild(id);
        if (guild == null) return NotFound("Guild not found");
        GuildPermissions perms = await roles.GetUserPermissionsInGuild(userId, id);
        return Ok(perms);
    }

    [HttpGet("{guildId:int}/members")]
    public async Task<ActionResult<GuildMemberResponse[]>> GetGuildMembers(int guildId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) return Unauthorized();
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) return NotFound("Guild not found");
        if (!await guilds.IsGuildMember(guildId, userId)) return Forbid();
        // Re-use channel-based details but for any channel in this guild
        Channel[]? guildChannels = await guilds.GetGuildChannelsAsChannels(guildId);
        if (guildChannels.Length == 0) {
            // No channels — just return empty member list with no colour info
            return Ok(Array.Empty<GuildMemberResponse>());
        }
        return Ok(await guilds.GetGuildChannelMembersDetails(guildChannels[0].Id));
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
        
        GuildPermissions perms = await roles.GetUserPermissionsInGuild(userId, guildId);
        if (!(perms.Administrator.ToBool() || perms.ManageChannels.ToBool())) {
            return Forbid();
        }
        
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
        
        GuildPermissions perms = await roles.GetUserPermissionsInGuild(userId, guildId);
        if (!(perms.Administrator.ToBool() || perms.ManageChannels.ToBool())) {
            return Forbid();
        }
        
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
        
        GuildPermissions perms = await roles.GetUserPermissionsInGuild(userId, guildId);
        if (!(perms.Administrator.ToBool() || perms.ManageChannels.ToBool())) {
            return Forbid();
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

    /// <summary>
    /// Get members of channel.
    /// This is different from <see cref="ChannelController.GetChannelMembers"/> because
    /// it gets guild member information, not just regular user information.
    /// </summary>
    /// <param name="guildId"></param>
    /// <param name="channelId"></param>
    /// <returns></returns>
    [HttpGet("{guildId:int}/channel/{channelId:int}/members")]
    public async Task<ActionResult<GuildMemberResponse[]>> GetChannelMembers(int guildId, int channelId) {
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
        
        return Ok(await guilds.GetGuildChannelMembersDetails(channelId));
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
        
        GuildPermissions perms = await roles.GetUserPermissionsInGuild(userId, guildId);
        if (!(perms.Administrator.ToBool() || perms.CreateInvites.ToBool())) {
            return Forbid();
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
        
        GuildPermissions perms = await roles.GetUserPermissionsInGuild(userId, invite.GuildId);
        if (!(perms.Administrator.ToBool() || perms.ManageGuild.ToBool())) {
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
        
        GuildPermissions perms = await roles.GetUserPermissionsInGuild(userId, guildId);
        if (!(perms.Administrator.ToBool() || perms.ManageGuild.ToBool())) {
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
    
    // ROLES

    [HttpGet("{guildId:int}/roles")]
    public async Task<ActionResult<Role[]>> GetRoles(int guildId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        return Ok(await roles.GetGuildRoles(guildId));
    }

    [HttpPost("{guildId:int}/roles")]
    public async Task<ActionResult<Role>> CreateRole(int guildId, RoleCreateRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        GuildPermissions perms = await roles.GetUserPermissionsInGuild(userId, guildId);
        if (!(perms.ManageRoles.ToBool() || perms.Administrator.ToBool())) {
            return Forbid();
        }
        
        Role role = new() {
            GuildId = guildId,
            Name = request.Name,
            Permissions = request.Permissions ?? new GuildPermissions(),
            Color = request.Color ?? "",
            DisplaySeparately = request.DisplaySeparately,
            Mentionable = request.Mentionable
        };
        await roles.CreateRole(role);
        await updates.Clients.Group("guild-" + guildId).SendAsync("RolesUpdated", new {
            GuildId = guildId
        });
        return Ok(role);
    }

    [HttpDelete("{guildId:int}/roles/{roleId:int}")]
    public async Task<ActionResult> DeleteRole(int guildId, int roleId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }

        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        Role? role = await roles.GetRole(roleId);
        if (role == null || role.GuildId != guildId) {
            return NotFound("Role not found in this guild");
        }
        
        GuildPermissions perms = await roles.GetUserPermissionsInGuild(userId, guildId);
        if (!(perms.ManageRoles.ToBool() || perms.Administrator.ToBool())) {
            return Forbid();
        }
        
        await roles.DeleteRole(roleId);
        
        await updates.Clients.Group("guild-" + guildId).SendAsync("RolesUpdated", new {
            GuildId = guildId
        });
        return Ok();
    }

    [HttpPatch("{guildId:int}/roles/{roleId:int}")]
    public async Task<ActionResult> UpdateRole(int guildId, int roleId, RoleUpdateRequest request) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        Role? role = await roles.GetRole(roleId);
        if (role == null || role.GuildId != guildId) {
            return NotFound("Role not found in this guild");
        }
        
        GuildPermissions perms = await roles.GetUserPermissionsInGuild(userId, guildId);
        if (!(perms.ManageRoles.ToBool() || perms.Administrator.ToBool())) {
            return Forbid();
        }
        
        if (!string.IsNullOrEmpty(request.Name)) {
            role.Name = request.Name;
        }
        
        if (request.Color != null) {  // can be empty string to reset to default colour
            role.Color = request.Color;
        }
        
        if (request.DisplaySeparately.HasValue) {
            role.DisplaySeparately = request.DisplaySeparately.Value;
        }
        
        if (request.Mentionable.HasValue) {
            role.Mentionable = request.Mentionable.Value;
        }
        
        if (request.Permissions != null) {
            role.Permissions = request.Permissions;
        }
        
        await roles.UpdateRole(role);
        
        await updates.Clients.Group("guild-" + guildId).SendAsync("RolesUpdated", new {
            GuildId = guildId
        });
        return Ok();
    }

    [HttpPost("{guildId:int}/members/{userId}/roles/{roleId:int}")]
    public async Task<ActionResult> AddRoleToUser(int guildId, int roleId, string userId) {
        string? requesterId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (requesterId == null) {
            return Unauthorized();
        }

        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        Role? role = await roles.GetRole(roleId);
        if (role == null || role.GuildId != guildId) {
            return NotFound("Role not found in this guild");
        }
        
        GuildPermissions perms = await roles.GetUserPermissionsInGuild(requesterId, guildId);
        if (!(perms.ManageRoles.ToBool() || perms.Administrator.ToBool())) {
            return Forbid();
        }
        
        await roles.AddUserRole(roleId, userId);
        await updates.Clients.User(userId).SendAsync("RolesUpdated", new {
            GuildId = guildId
        });
        await updates.Clients.Group("guild-" + guildId).SendAsync("UserUpdated", new {
            Id = userId
        });
        return Ok();
    }

    [HttpGet("{guildId:int}/members/{userId}/roles")]
    public async Task<ActionResult<Role[]>> GetUserRoles(int guildId, string userId) {
        string? requesterId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (requesterId == null) {
            return Unauthorized();
        }

        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }
        
        return Ok(await roles.GetUserRolesInGuild(userId, guildId));
    }

    [HttpDelete("{guildId:int}/members/{userId}/roles/{roleId:int}")]
    public async Task<ActionResult> RemoveRoleFromUser(int guildId, int roleId, string userId) {
        string? requesterId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (requesterId == null) {
            return Unauthorized();
        }

        Guild? guild = await guilds.GetGuild(guildId);
        if (guild == null) {
            return NotFound("Guild not found");
        }

        Role? role = await roles.GetRole(roleId);
        if (role == null || role.GuildId != guildId) {
            return NotFound("Role not found in this guild");
        }

        GuildPermissions perms = await roles.GetUserPermissionsInGuild(requesterId, guildId);
        if (!(perms.ManageRoles.ToBool() || perms.Administrator.ToBool())) {
            return Forbid();
        }
        
        await roles.RemoveUserRole(roleId, userId);
        await updates.Clients.User(userId).SendAsync("RolesUpdated", new {
            GuildId = guildId
        });
        await updates.Clients.Group("guild-" + guildId).SendAsync("UserUpdated", new {
            Id = userId
        });
        return Ok();
    }
}
