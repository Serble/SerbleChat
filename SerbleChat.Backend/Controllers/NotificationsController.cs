using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SerbleChat.Backend.Services;

namespace SerbleChat.Backend.Controllers;

[Route("/notifications")]
[ApiController]
public class NotificationsController(INotificationService notifications) : ControllerBase {

    /// <summary>
    /// A device showed a pushed notification. Used only to measure end-to-end delivery time. Anonymous because the
    /// browser's service worker has no login token; the delivery ID is random and only travels inside the
    /// end-to-end encrypted push, so it can't be guessed.
    /// </summary>
    [AllowAnonymous]
    /// <param name="shownAt">When the notification appeared, Unix milliseconds by the device's clock.</param>
    [HttpPost("ack/{deliveryId}")]
    public async Task<ActionResult> Ack(string deliveryId, [FromQuery] long? shownAt) {
        await notifications.AckDeviceDelivery(deliveryId, shownAt);
        return NoContent();
    }
}
