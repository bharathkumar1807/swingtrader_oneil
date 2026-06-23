using Microsoft.EntityFrameworkCore;
using SwingTrader.API.Data;
using Telegram.Bot;
using Telegram.Bot.Types.Enums;

namespace SwingTrader.API.Services;

public class TelegramService
{
    private readonly TelegramBotClient? _bot;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<TelegramService> _logger;
    public readonly bool IsEnabled;

    public TelegramService(IConfiguration config, IServiceScopeFactory scopeFactory, ILogger<TelegramService> logger)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        var token = config["Telegram:BotToken"];
        IsEnabled = !string.IsNullOrWhiteSpace(token);
        _bot = IsEnabled ? new TelegramBotClient(token!) : null;
    }

    public TelegramBotClient? Client => _bot;

    // Broadcast to every registered subscriber
    public async Task SendMessageAsync(string htmlMessage)
    {
        if (!IsEnabled)
        {
            _logger.LogWarning("Telegram not configured. Skipping alert.");
            return;
        }

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var subscribers = await db.BotSubscribers.Select(s => s.ChatId).ToListAsync();

        if (subscribers.Count == 0)
        {
            _logger.LogWarning("No subscribers. Ask people to send /start to the bot.");
            return;
        }

        foreach (var chatId in subscribers)
        {
            try
            {
                await _bot!.SendMessage(chatId, htmlMessage, parseMode: ParseMode.Html);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send Telegram message to {ChatId}", chatId);
            }
        }
    }
}
