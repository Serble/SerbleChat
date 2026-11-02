using System.Text.Json;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;
using StackExchange.Redis;

namespace SerbleChat.Backend.Services.Notifications;

/// <summary>
/// A durable job queue in Redis, so queued notifications survive restarts and deploys.
/// </summary>
/// <remarks>
/// Layout: job bodies live in a hash; ready job IDs in one list per lane; jobs waiting to run (retries, socket ack
/// timeouts) in a sorted set scored by due time; claimed jobs in a sorted set scored by lease expiry. A job whose
/// worker died (its lease ran out) goes back on its lane, so a crash means a job runs twice rather than never.
/// Members of the two sorted sets are "lane:id" so a job can be returned to the right lane.
/// <para/>
/// Redis can't block on a list through the multiplexer, so workers wait on an in-process signal that every local
/// enqueue raises, and also poll, which picks up delayed jobs and work queued by other instances.
/// </remarks>
public class NotificationQueue(IConnectionMultiplexer redis, IOptions<NotificationSettings> settings) {
    private const string Prefix = "nq:";
    private static readonly RedisKey JobsKey = Prefix + "jobs";
    private static readonly RedisKey DelayedKey = Prefix + "delayed";
    private static readonly RedisKey LeasedKey = Prefix + "leased";
    private static RedisKey ReadyKey(NotificationLane lane) => Prefix + "ready:" + LaneName(lane);
    private static string LaneName(NotificationLane lane) => lane == NotificationLane.High ? "high" : "normal";

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // KEYS: jobs hash, ready list. ARGV: id1, json1, id2, json2...
    private const string EnqueueLua = """
        local n = 0
        for i = 1, #ARGV, 2 do
            redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
            redis.call('RPUSH', KEYS[2], ARGV[i])
            n = n + 1
        end
        return n
        """;

    // KEYS: jobs hash, delayed zset. ARGV: (member, due, id, json) repeated
    private const string ScheduleLua = """
        for i = 1, #ARGV, 4 do
            redis.call('HSET', KEYS[1], ARGV[i + 2], ARGV[i + 3])
            redis.call('ZADD', KEYS[2], ARGV[i + 1], ARGV[i])
        end
        return 1
        """;

    // KEYS: jobs hash, leased zset, ready lists in preference order. ARGV: now, lease expiry, lane names (same order)
    // Returns {lane, id, json} or nil.
    private const string ClaimLua = """
        for i = 3, #KEYS do
            while true do
                local id = redis.call('LPOP', KEYS[i])
                if not id then break end
                local json = redis.call('HGET', KEYS[1], id)
                if json then
                    local lane = ARGV[i]
                    redis.call('ZADD', KEYS[2], ARGV[2], lane .. ':' .. id)
                    return {lane, id, json}
                end
            end
        end
        return nil
        """;

    // KEYS: jobs hash, leased zset. ARGV: member, id
    private const string CompleteLua = """
        redis.call('ZREM', KEYS[2], ARGV[1])
        redis.call('HDEL', KEYS[1], ARGV[2])
        return 1
        """;

    // KEYS: jobs hash, leased zset, delayed zset. ARGV: old member, new member, due, id, json
    private const string RescheduleLua = """
        redis.call('ZREM', KEYS[2], ARGV[1])
        redis.call('HSET', KEYS[1], ARGV[4], ARGV[5])
        redis.call('ZADD', KEYS[3], ARGV[3], ARGV[2])
        return 1
        """;

    // KEYS: delayed zset, leased zset, ready high, ready normal. ARGV: now, max
    // Moves due delayed jobs and expired leases back onto their lanes. Returns how many moved.
    private const string PromoteLua = """
        local moved = 0
        for k = 1, 2 do
            local due = redis.call('ZRANGEBYSCORE', KEYS[k], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
            for _, member in ipairs(due) do
                redis.call('ZREM', KEYS[k], member)
                local sep = string.find(member, ':', 1, true)
                local lane = string.sub(member, 1, sep - 1)
                local id = string.sub(member, sep + 1)
                if lane == 'high' then
                    redis.call('RPUSH', KEYS[3], id)
                else
                    redis.call('RPUSH', KEYS[4], id)
                end
                moved = moved + 1
            end
        end
        return moved
        """;

    // KEYS: ready high, ready normal, delayed, leased
    private const string DepthLua = """
        return {redis.call('LLEN', KEYS[1]), redis.call('LLEN', KEYS[2]), redis.call('ZCARD', KEYS[3]), redis.call('ZCARD', KEYS[4])}
        """;

    private readonly SemaphoreSlim _signal = new(0, int.MaxValue);
    private IDatabase Db => redis.GetDatabase();
    private TimeSpan Lease => TimeSpan.FromSeconds(settings.Value.JobLeaseSeconds);

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /// <summary>Queues jobs to run as soon as a worker is free.</summary>
    public async Task Enqueue(IReadOnlyCollection<NotificationJob> jobs) {
        if (jobs.Count == 0) return;
        foreach (IGrouping<NotificationLane, NotificationJob> lane in jobs.GroupBy(j => j.Lane)) {
            // keep each script call a sensible size for big fan-outs
            foreach (NotificationJob[] chunk in lane.Chunk(500)) {
                RedisValue[] args = new RedisValue[chunk.Length * 2];
                for (int i = 0; i < chunk.Length; i++) {
                    args[i * 2] = chunk[i].Id;
                    args[i * 2 + 1] = JsonSerializer.Serialize(chunk[i], Json);
                }
                await Db.ScriptEvaluateAsync(EnqueueLua, [JobsKey, ReadyKey(lane.Key)], args);
            }
        }
        _signal.Release(Math.Min(jobs.Count, 1024));
    }

    public Task Enqueue(NotificationJob job) => Enqueue([job]);

    /// <summary>Queues jobs to run after a delay.</summary>
    public async Task Schedule(IReadOnlyCollection<NotificationJob> jobs, TimeSpan delay) {
        if (jobs.Count == 0) return;
        long due = NowMs() + (long)delay.TotalMilliseconds;
        foreach (NotificationJob[] chunk in jobs.Chunk(250)) {
            RedisValue[] args = new RedisValue[chunk.Length * 4];
            for (int i = 0; i < chunk.Length; i++) {
                args[i * 4] = Member(chunk[i].Lane, chunk[i].Id);
                args[i * 4 + 1] = due;
                args[i * 4 + 2] = chunk[i].Id;
                args[i * 4 + 3] = JsonSerializer.Serialize(chunk[i], Json);
            }
            await Db.ScriptEvaluateAsync(ScheduleLua, [JobsKey, DelayedKey], args);
        }
    }

    /// <summary>Claims the next job from the given lanes, in order of preference, or null if they're all empty.</summary>
    public async Task<ClaimedJob?> TryClaim(NotificationLane[] lanes) {
        RedisKey[] keys = new RedisKey[2 + lanes.Length];
        RedisValue[] args = new RedisValue[2 + lanes.Length];
        keys[0] = JobsKey;
        keys[1] = LeasedKey;
        long now = NowMs();
        args[0] = now;
        args[1] = now + (long)Lease.TotalMilliseconds;
        for (int i = 0; i < lanes.Length; i++) {
            keys[2 + i] = ReadyKey(lanes[i]);
            args[2 + i] = LaneName(lanes[i]);
        }
        RedisResult result = await Db.ScriptEvaluateAsync(ClaimLua, keys, args);
        if (result.IsNull) return null;
        RedisResult[] parts = (RedisResult[])result!;
        string laneName = (string)parts[0]!;
        string id = (string)parts[1]!;
        string json = (string)parts[2]!;
        NotificationJob? job;
        try {
            job = JsonSerializer.Deserialize<NotificationJob>(json, Json);
        }
        catch (JsonException) {
            job = null;
        }
        if (job == null) {
            // unreadable (e.g. written by a newer version): drop it rather than retry forever
            await Db.ScriptEvaluateAsync(CompleteLua, [JobsKey, LeasedKey], [laneName + ":" + id, id]);
            return null;
        }
        return new ClaimedJob(job, laneName + ":" + id);
    }

    public Task Complete(ClaimedJob claimed) =>
        Db.ScriptEvaluateAsync(CompleteLua, [JobsKey, LeasedKey], [claimed.LeaseMember, claimed.Job.Id]);

    /// <summary>Finishes a claimed job by putting an updated copy of it back to run later (a retry).</summary>
    public Task Reschedule(ClaimedJob claimed, NotificationJob updated, TimeSpan delay) {
        long due = NowMs() + (long)delay.TotalMilliseconds;
        return Db.ScriptEvaluateAsync(RescheduleLua, [JobsKey, LeasedKey, DelayedKey],
            [claimed.LeaseMember, Member(updated.Lane, updated.Id), due, updated.Id, JsonSerializer.Serialize(updated, Json)]);
    }

    /// <summary>Moves due delayed jobs and abandoned claims back onto their lanes, and wakes workers if any moved.</summary>
    public async Task<int> Promote() {
        RedisResult result = await Db.ScriptEvaluateAsync(PromoteLua,
            [DelayedKey, LeasedKey, ReadyKey(NotificationLane.High), ReadyKey(NotificationLane.Normal)],
            [NowMs(), 1000]);
        int moved = (int)result;
        if (moved > 0) _signal.Release(Math.Min(moved, 1024));
        return moved;
    }

    /// <summary>Waits until a job may be available (or the timeout passes).</summary>
    public Task WaitForWork(TimeSpan timeout, CancellationToken token) => _signal.WaitAsync(timeout, token);

    public async Task<QueueDepth> GetDepth() {
        RedisResult[] r = (RedisResult[])(await Db.ScriptEvaluateAsync(DepthLua,
            [ReadyKey(NotificationLane.High), ReadyKey(NotificationLane.Normal), DelayedKey, LeasedKey]))!;
        return new QueueDepth((long)r[0], (long)r[1], (long)r[2], (long)r[3]);
    }

    private static string Member(NotificationLane lane, string id) => LaneName(lane) + ":" + id;
}

public record ClaimedJob(NotificationJob Job, string LeaseMember);

public record QueueDepth(long ReadyHigh, long ReadyNormal, long Delayed, long InFlight);
