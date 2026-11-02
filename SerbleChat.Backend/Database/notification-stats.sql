-- Notification delivery statistics, from the NotificationDeliveries table (one row per delivery attempt chain).
-- Run against the chat database. Rows are kept for Notifications:StatsRetentionDays (30 by default).
--
-- Enum values:
--   Transport: 0 Socket (in-app), 1 WebPush (browser), 2 UnifiedPush (Android app), 3 Ntfy (plain ntfy topic)
--   Outcome:   0 Delivered, 1 Failed, 2 Expired, 3 SubscriptionGone, 4 Acked (socket), 5 NotAcked (socket, pushed instead)
--   Purpose:   0 Message, 1 ReadSync
--
-- Timings, all in ms from when the message was created:
--   QueueMs        until the first send attempt (database, queueing, waiting for a worker)
--   AcceptedMs     until the push service accepted it (or a client acknowledged it, for Socket)
--   DeviceShownMs  until the notification was on screen, by the device's clock (Android app and browsers)
--   DeviceAckMs    until the device's acknowledgement reached us (upper bound; includes the phone getting network back)
-- PushServiceMs is how long the push service itself took to answer the last attempt.


-- 1. Health at a glance, last 24 hours: volume and failure rate per transport
SELECT CASE Transport WHEN 0 THEN 'socket' WHEN 1 THEN 'webpush' WHEN 2 THEN 'unifiedpush' ELSE 'ntfy' END AS transport,
       COUNT(*)                                                         AS deliveries,
       ROUND(100 * AVG(Outcome IN (0, 4)), 2)                           AS ok_pct,
       ROUND(100 * AVG(Outcome = 1), 2)                                 AS failed_pct,
       ROUND(100 * AVG(Outcome = 2), 2)                                 AS expired_pct,
       ROUND(100 * AVG(Outcome = 3), 2)                                 AS gone_pct,
       ROUND(100 * AVG(Outcome = 5), 2)                                 AS socket_dead_pct,
       ROUND(100 * AVG(Attempts > 1), 2)                                AS needed_retry_pct
FROM NotificationDeliveries
WHERE CreatedAt > UTC_TIMESTAMP() - INTERVAL 1 DAY AND Purpose = 0
GROUP BY Transport;


-- 2. Which push services we talk to most, and how they behave
SELECT Host,
       COUNT(*)                                   AS deliveries,
       COUNT(DISTINCT UserId)                     AS users,
       ROUND(100 * AVG(Outcome = 0), 2)           AS delivered_pct,
       ROUND(AVG(PushServiceMs))                  AS avg_service_ms,
       MAX(PushServiceMs)                         AS max_service_ms,
       SUM(StatusCode = 429)                      AS rate_limited_final,
       SUM(Attempts > 1)                          AS retried
FROM NotificationDeliveries
WHERE CreatedAt > UTC_TIMESTAMP() - INTERVAL 7 DAY AND Transport <> 0
GROUP BY Host
ORDER BY deliveries DESC
LIMIT 25;


-- 3. Delivery time percentiles per transport (MySQL 8 has no PERCENTILE_CONT, so rank and pick).
--    Swap AcceptedMs for DeviceShownMs to see time-to-screen where clients report it.
WITH d AS (
    SELECT Transport, AcceptedMs AS ms,
           PERCENT_RANK() OVER (PARTITION BY Transport ORDER BY AcceptedMs) AS pr
    FROM NotificationDeliveries
    WHERE CreatedAt > UTC_TIMESTAMP() - INTERVAL 1 DAY AND Purpose = 0 AND AcceptedMs IS NOT NULL
)
SELECT CASE Transport WHEN 0 THEN 'socket' WHEN 1 THEN 'webpush' WHEN 2 THEN 'unifiedpush' ELSE 'ntfy' END AS transport,
       COUNT(*)                     AS n,
       MIN(CASE WHEN pr >= 0.50 THEN ms END) AS p50_ms,
       MIN(CASE WHEN pr >= 0.90 THEN ms END) AS p90_ms,
       MIN(CASE WHEN pr >= 0.99 THEN ms END) AS p99_ms,
       MAX(ms)                      AS max_ms
FROM d
GROUP BY Transport;


-- 4. Where the time goes, per host: waiting to be sent vs the push service vs getting to the screen
SELECT Host,
       COUNT(*)                                          AS n,
       ROUND(AVG(QueueMs))                               AS avg_queue_ms,
       ROUND(AVG(PushServiceMs))                         AS avg_service_ms,
       ROUND(AVG(AcceptedMs))                            AS avg_accepted_ms,
       ROUND(AVG(DeviceShownMs))                         AS avg_shown_ms,
       ROUND(AVG(DeviceShownMs - AcceptedMs))            AS avg_service_to_screen_ms,
       ROUND(100 * AVG(DeviceShownMs IS NOT NULL), 1)    AS shown_reported_pct
FROM NotificationDeliveries
WHERE CreatedAt > UTC_TIMESTAMP() - INTERVAL 1 DAY AND Outcome = 0 AND Purpose = 0
GROUP BY Host
ORDER BY n DESC
LIMIT 25;


-- 5. Priority lanes: are DMs and mentions (high) staying fast when guilds are busy?
SELECT HighPriority, COUNT(*) AS n, ROUND(AVG(QueueMs)) AS avg_queue_ms, MAX(QueueMs) AS max_queue_ms
FROM NotificationDeliveries
WHERE CreatedAt > UTC_TIMESTAMP() - INTERVAL 1 DAY AND Transport <> 0 AND Purpose = 0
GROUP BY HighPriority;


-- 6. Hourly trend for the last 2 days (spot outages and slow periods)
SELECT DATE_FORMAT(CreatedAt, '%Y-%m-%d %H:00') AS hour,
       COUNT(*)                                  AS deliveries,
       ROUND(100 * AVG(Outcome IN (1, 2)), 2)    AS failed_pct,
       ROUND(AVG(AcceptedMs))                    AS avg_accepted_ms
FROM NotificationDeliveries
WHERE CreatedAt > UTC_TIMESTAMP() - INTERVAL 2 DAY AND Transport <> 0 AND Purpose = 0
GROUP BY hour
ORDER BY hour;


-- 7. Most common errors this week
SELECT Host, StatusCode, LEFT(Error, 120) AS error, COUNT(*) AS n
FROM NotificationDeliveries
WHERE CreatedAt > UTC_TIMESTAMP() - INTERVAL 7 DAY AND Outcome IN (1, 2, 3, 5)
GROUP BY Host, StatusCode, LEFT(Error, 120)
ORDER BY n DESC
LIMIT 25;


-- 8. Users whose notifications keep failing (support: "I'm not getting notifications")
SELECT UserId,
       COUNT(*)                                 AS deliveries,
       SUM(Outcome IN (1, 2))                   AS failed,
       GROUP_CONCAT(DISTINCT Host)              AS hosts
FROM NotificationDeliveries
WHERE CreatedAt > UTC_TIMESTAMP() - INTERVAL 7 DAY AND Transport <> 0
GROUP BY UserId
HAVING failed > 0
ORDER BY failed DESC
LIMIT 25;


-- 9. Dead connections: how often a connected client didn't acknowledge an in-app notification, so it was pushed
SELECT DATE(CreatedAt) AS day, COUNT(*) AS socket_notifications,
       SUM(Outcome = 5) AS not_acked, ROUND(100 * AVG(Outcome = 5), 2) AS not_acked_pct,
       ROUND(AVG(CASE WHEN Outcome = 4 THEN AcceptedMs END)) AS avg_ack_ms
FROM NotificationDeliveries
WHERE Transport = 0 AND CreatedAt > UTC_TIMESTAMP() - INTERVAL 7 DAY
GROUP BY day
ORDER BY day;
