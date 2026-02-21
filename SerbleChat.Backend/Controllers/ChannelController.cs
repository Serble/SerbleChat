using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SerbleChat.Backend.Database.Repos;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Controllers;

// POST /channel/dm/{userId}
// GET /channel/dm/{userId}
// GET /channel/dm

// POST /channel/group
// GET /channel/group/{groupId}
// GET /channel/group

// POST /channel/{channelId}

[ApiController]
[Route("channel")]
[Authorize]
public class ChannelController(IChannelRepo channels, IDmChannelRepo dms) : ControllerBase {

    [HttpGet("dm/{otherId}")]
    public async Task<ActionResult<Channel>> GetDmChannel(string otherId) {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        DmChannel? dmChannel = await dms.GetDmChannel(userId, otherId);
        if (dmChannel == null) {
            // create a new one
            Channel channel = new() {
                CreatedAt = DateTime.UtcNow,
                Name = "DM Channel",
                VoiceCapable = true
            };
            await channels.CreateChannel(channel);
            dmChannel = new DmChannel {
                User1Id = userId,
                User2Id = otherId,
                ChannelId = channel.Id
            };
            await dms.CreateDmChannel(dmChannel);
        }
        
        return Ok(dmChannel.ChannelNavigation);
    }
    
    [HttpGet("dm")]
    public async Task<ActionResult<IEnumerable<DmChannel>>> GetDmChannels() {
        string? userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (userId == null) {
            return Unauthorized();
        }
        
        List<DmChannel> dmChannels = await dms.GetDmChannels(userId);
        return Ok(dmChannels);
    }
}
