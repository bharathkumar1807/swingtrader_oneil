using Microsoft.EntityFrameworkCore;
using SwingTrader.API.Data;
using SwingTrader.API.Models;
using Telegram.Bot;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;

namespace SwingTrader.API.Services;

// Runs as a background hosted service — polls Telegram for new messages
public class TelegramPollingService : BackgroundService
{
    private readonly TelegramService _telegram;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<TelegramPollingService> _logger;
    private int _offset = 0;

    public TelegramPollingService(
        TelegramService telegram,
        IServiceScopeFactory scopeFactory,
        ILogger<TelegramPollingService> logger)
    {
        _telegram = telegram;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_telegram.IsEnabled)
        {
            _logger.LogWarning("Telegram not configured — polling disabled.");
            return;
        }

        _logger.LogInformation("Telegram polling started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var updates = await _telegram.Client!.GetUpdates(
                    offset: _offset,
                    timeout: 30,
                    cancellationToken: stoppingToken);

                foreach (var update in updates)
                {
                    _offset = update.Id + 1;
                    await HandleUpdateAsync(update, stoppingToken);
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Telegram polling error — retrying in 5s");
                await Task.Delay(5_000, stoppingToken);
            }
        }
    }

    private async Task HandleUpdateAsync(Update update, CancellationToken ct)
    {
        var message = update.Message;
        if (message?.Text == null) return;

        var chatId    = message.Chat.Id;
        var firstName = message.From?.FirstName ?? "";
        var username  = message.From?.Username  ?? "";
        var text      = message.Text.Trim().ToLower();

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        if (text.StartsWith("/start"))
        {
            var exists = await db.BotSubscribers.AnyAsync(s => s.ChatId == chatId, ct);
            if (!exists)
            {
                db.BotSubscribers.Add(new BotSubscriber
                {
                    ChatId    = chatId,
                    FirstName = firstName,
                    Username  = username
                });
                await db.SaveChangesAsync(ct);
                _logger.LogInformation("New subscriber: {Name} ({ChatId})", firstName, chatId);
            }

            var reply = exists
                ? $"👋 Hey <b>{firstName}</b>, you're already subscribed!\nYou'll receive swing trade alerts automatically."
                : $"✅ <b>Welcome {firstName}!</b>\n\nYou're now subscribed to <b>SwingTrader alerts</b>.\n\n" +
                  "You'll receive:\n" +
                  "• 📋 Daily top-5 plan summary at market open\n" +
                  "• 🚀 Breakout alerts when a planned stock hits entry\n\n" +
                  "Commands:\n" +
                  "• /picks — get today's screener picks anytime\n" +
                  "• /stop — unsubscribe\n";

            await _telegram.Client!.SendMessage(chatId, reply, parseMode: ParseMode.Html, cancellationToken: ct);

            // Send today's top picks to new subscribers so they're not left out
            if (!exists)
            {
                var today = DateTime.UtcNow.Date;
                var picks = await db.ScreenerResults
                    .Where(r => r.ScanDate.Date == today)
                    .OrderByDescending(r => r.MinerviniScore)
                    .ThenByDescending(r => r.RsRating)
                    .Take(10)
                    .ToListAsync(ct);

                if (picks.Count > 0)
                {
                    var sb = new System.Text.StringBuilder();
                    sb.AppendLine($"📊 <b>TODAY'S TOP PICKS — {today:ddd dd MMM yyyy}</b>");
                    sb.AppendLine("━━━━━━━━━━━━━━━━━━━━━━");
                    foreach (var p in picks)
                    {
                        var totalScore = p.MinerviniScore + p.CanslimScore;
                        sb.AppendLine();
                        sb.AppendLine($"<b>{p.Symbol}</b>  |  Score <b>{totalScore}/11</b>  |  RS <b>{p.RsRating:F0}</b>");
                        sb.AppendLine($"   Minervini {p.MinerviniScore}/7  ·  CANSLIM {p.CanslimScore}/4  ·  EPS {(p.EpsGrowth >= 0 ? "+" : "")}{p.EpsGrowth:F0}%");
                        if (!string.IsNullOrWhiteSpace(p.Sector))
                            sb.AppendLine($"   📂 {p.Sector}");
                    }
                    await _telegram.Client!.SendMessage(chatId, sb.ToString(), parseMode: ParseMode.Html, cancellationToken: ct);
                }
            }
        }
        else if (text.StartsWith("/picks"))
        {
            var today = DateTime.UtcNow.Date;
            var picks = await db.ScreenerResults
                .Where(r => r.ScanDate.Date == today)
                .OrderByDescending(r => r.MinerviniScore)
                .ThenByDescending(r => r.RsRating)
                .Take(10)
                .ToListAsync(ct);

            if (picks.Count == 0)
            {
                await _telegram.Client!.SendMessage(chatId,
                    "📭 No screener picks for today yet. Check back after 6:30 AM CT.",
                    parseMode: ParseMode.Html, cancellationToken: ct);
            }
            else
            {
                var sb = new System.Text.StringBuilder();
                sb.AppendLine($"📊 <b>TODAY'S TOP PICKS — {today:ddd dd MMM yyyy}</b>");
                sb.AppendLine("━━━━━━━━━━━━━━━━━━━━━━");
                foreach (var p in picks)
                {
                    var totalScore = p.MinerviniScore + p.CanslimScore;
                    sb.AppendLine();
                    sb.AppendLine($"<b>{p.Symbol}</b>  |  Score <b>{totalScore}/11</b>  |  RS <b>{p.RsRating:F0}</b>");
                    sb.AppendLine($"   Minervini {p.MinerviniScore}/7  ·  CANSLIM {p.CanslimScore}/4  ·  EPS {(p.EpsGrowth >= 0 ? "+" : "")}{p.EpsGrowth:F0}%");
                    if (!string.IsNullOrWhiteSpace(p.Sector))
                        sb.AppendLine($"   📂 {p.Sector}");
                }
                await _telegram.Client!.SendMessage(chatId, sb.ToString(), parseMode: ParseMode.Html, cancellationToken: ct);
            }
        }
        else if (text.StartsWith("/stop"))
        {
            var subscriber = await db.BotSubscribers.FindAsync([chatId], ct);
            if (subscriber != null)
            {
                db.BotSubscribers.Remove(subscriber);
                await db.SaveChangesAsync(ct);
                _logger.LogInformation("Unsubscribed: {Name} ({ChatId})", firstName, chatId);
            }

            await _telegram.Client!.SendMessage(
                chatId,
                $"👋 <b>{firstName}</b>, you've been unsubscribed.\nSend /start to resubscribe anytime.",
                parseMode: ParseMode.Html,
                cancellationToken: ct);
        }
    }
}
