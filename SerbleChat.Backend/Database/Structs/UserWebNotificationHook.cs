using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Lib.Net.Http.WebPush;

namespace SerbleChat.Backend.Database.Structs;

public class UserWebNotificationHook {
    [Key]
    public int Id { get; set; }
    
    [StringLength(64), ForeignKey(nameof(UserNavigation))]
    public string UserId { get; set; } = null!;
    
    [StringLength(1024)]  // some URLs can be long, 1024 should be decent enough
    public string Url { get; set; } = null!;
    
    [StringLength(128)]  // p256dh keys are 87 characters long, but we add some extra padding just in case
    public string P256dh { get; set; } = null!;
    
    [StringLength(64)]  // auth keys are usually around 22, but better safe than sorry
    public string Auth { get; set; } = null!;
    
    [StringLength(255)]  // not super important to store all of this
    public string UserAgent { get; set; } = null!;
    
    public DateTime CreatedAt { get; set; }
    
    // Navigation Properties
    public ChatUser UserNavigation { get; set; } = null!;
    
    public PushSubscription ToPushSubscription() {
        PushSubscription s = new() {
            Endpoint = Url,
            Keys = new Dictionary<string, string>()
        };
        s.Keys["p256dh"] = P256dh;
        s.Keys["auth"] = Auth;
        return s;
    }
}
